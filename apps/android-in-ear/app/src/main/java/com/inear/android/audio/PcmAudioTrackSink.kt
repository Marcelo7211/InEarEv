package com.inear.android.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import java.util.ArrayDeque
import kotlin.concurrent.thread
import kotlin.math.roundToInt

/**
 * Playback PCM s16 interleaved estéreo via [AudioTrack].
 *
 * - **pro**: fila curta + LOW_LATENCY + buffer >= 2×minBuf (LAN / 5 GHz).
 * - **wifi24**: fila e HAL um pouco maiores + LOW_LATENCY — melhor compromisso em Wi‑Fi 2,4 GHz (jitter).
 * - **low**: um pouco mais de margem.
 * - **stable**: Wi‑Fi fraco ou ligações muito instáveis.
 */
class PcmAudioTrackSink(private val sampleRate: Int = 48_000) {
    private var track: AudioTrack? = null
    private val lock = Any()
    private val frameQueue = ArrayDeque<ShortArray>()
    private var writerThread: Thread? = null
    private var running = false

    private var maxQueuedFramesCap = 8
    private var maxQueuedAudioMs = 80
    private var writerWaitMs = 8L

    @Volatile
    private var masterGain: Float = 1f

    private var queuedShortsTotal = 0

    /** Frames estéreo já entregues ao [AudioTrack.write] (desde o último flush / arranque). */
    private var framesSubmittedToHal: Long = 0L

    private fun maxQueuedShortsForMs(ms: Int): Int =
        ((ms.coerceAtLeast(1).toLong() * sampleRate) / 1000L * 2L).toInt().coerceAtLeast(4)

    /** Tecto de fila em RAM usado pelo motor para calcular quando fazer catch-up. */
    fun maxConfiguredPlayoutQueueMs(): Int = synchronized(lock) { maxQueuedAudioMs }

    fun start(latencyProfile: String = "stable") {
        synchronized(lock) {
            if (track != null) return
            val minBuf = AudioTrack.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_OUT_STEREO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBuf <= 0) return

            val bufBytes: Int
            val useLowLatencyHardware: Boolean
            when (latencyProfile) {
                "provocal" -> {
                    maxQueuedAudioMs = 12
                    maxQueuedFramesCap = 2
                    bufBytes = minBuf
                    useLowLatencyHardware = true
                    writerWaitMs = 1L
                }
                "mid200" -> {
                    maxQueuedAudioMs = 120
                    maxQueuedFramesCap = 8
                    bufBytes = (minBuf * 2).coerceAtLeast(minBuf)
                    useLowLatencyHardware = true
                    writerWaitMs = 4L
                }
                "pro" -> {
                    maxQueuedAudioMs = 16
                    maxQueuedFramesCap = 2
                    bufBytes = minBuf
                    useLowLatencyHardware = true
                    writerWaitMs = 1L
                }
                "low" -> {
                    maxQueuedAudioMs = 64
                    maxQueuedFramesCap = 4
                    bufBytes = minBuf
                    useLowLatencyHardware = true
                    writerWaitMs = 3L
                }
                "wifi24" -> {
                    maxQueuedAudioMs = 96
                    maxQueuedFramesCap = 6
                    /* Buffer HAL o mais pequeno possível: em 2,4 GHz o TCP pode manter taxa média
                     * correcta com segundos no buffer do DSP — o motor usa halQueueMsApprox para drenar. */
                    bufBytes = minBuf
                    useLowLatencyHardware = true
                    writerWaitMs = 3L
                }
                else -> {
                    maxQueuedAudioMs = 220
                    maxQueuedFramesCap = 20
                    bufBytes = (minBuf * 4).coerceAtLeast(minBuf)
                    useLowLatencyHardware = false
                    writerWaitMs = 12L
                }
            }

            val attr = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val fmt = AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .build()
            val tb = AudioTrack.Builder()
                .setAudioAttributes(attr)
                .setAudioFormat(fmt)
                .setBufferSizeInBytes(bufBytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                tb.setPerformanceMode(
                    if (useLowLatencyHardware) {
                        AudioTrack.PERFORMANCE_MODE_LOW_LATENCY
                    } else {
                        AudioTrack.PERFORMANCE_MODE_NONE
                    },
                )
            }
            val t = tb.build()
            t.setVolume(1f)
            try {
                t.play()
            } catch (_: Exception) {
            }
            track = t
            framesSubmittedToHal = 0L
            running = true
            writerThread = thread(name = "inear-audio-writer", start = true) {
                writerLoop()
            }
        }
    }

    /**
     * Esvazia a fila em RAM. Só faz [AudioTrack.flush] se havia áudio suficiente enfileirado —
     * evita martelar o HAL com flush quando a fila já estava vazia.
     */
    fun drainPlayoutBuffer() {
        synchronized(lock) {
            val hadMs = if (queuedShortsTotal <= 0) {
                0
            } else {
                val stereoFrames = queuedShortsTotal / 2
                ((stereoFrames * 1000L) / sampleRate).toInt()
            }
            val tr = track
            val head = tr?.playbackHeadPosition?.toLong()?.and(0x7fff_ffffL) ?: 0L
            val halMs =
                (((framesSubmittedToHal - head).coerceAtLeast(0L) * 1000L) / sampleRate).toInt()
            frameQueue.clear()
            queuedShortsTotal = 0
            /* RAM vazia mas HAL cheio (típico WS 2,4 GHz): flush na mesma. */
            if (tr != null && (hadMs >= 20 || halMs >= 48)) {
                try {
                    tr.pause()
                    tr.flush()
                    tr.play()
                    framesSubmittedToHal = 0L
                } catch (_: Exception) {
                }
            }
            (lock as java.lang.Object).notifyAll()
        }
    }

    fun writeInterleavedS16(pcm: ShortArray, len: Int) {
        val g = masterGain
        val frame: ShortArray = if (g == 1f) {
            if (len == pcm.size) pcm else pcm.copyOf(len)
        } else {
            ShortArray(len) { i ->
                val v = (pcm[i].toInt() * g).roundToInt().coerceIn(-32768, 32767)
                v.toShort()
            }
        }
        val maxShorts = maxQueuedShortsForMs(maxQueuedAudioMs)
        synchronized(lock) {
            if (!running || track == null) return
            frameQueue.addLast(frame)
            queuedShortsTotal += frame.size
            while (frameQueue.size > maxQueuedFramesCap || queuedShortsTotal > maxShorts) {
                val removed = frameQueue.pollFirst() ?: break
                queuedShortsTotal -= removed.size
            }
            (lock as java.lang.Object).notifyAll()
        }
    }

    fun queuedFrames(): Int = synchronized(lock) { frameQueue.size }

    fun queuedAudioMsApprox(): Int {
        synchronized(lock) {
            if (queuedShortsTotal <= 0) return 0
            val stereoFrames = queuedShortsTotal / 2
            return ((stereoFrames * 1000L) / sampleRate).toInt()
        }
    }

    /**
     * Estimativa de áudio ainda por reproduzir dentro do [AudioTrack] (fila HAL + buffer interno),
     * com base em frames escritos vs [AudioTrack.getPlaybackHeadPosition].
     */
    fun halQueuedMsApprox(): Int {
        synchronized(lock) {
            val tr = track ?: return 0
            val head = tr.playbackHeadPosition.toLong() and 0x7fff_ffffL
            val pending = (framesSubmittedToHal - head).coerceAtLeast(0L)
            return ((pending * 1000L) / sampleRate).toInt().coerceAtMost(30_000)
        }
    }

    fun setMaster(g: Float) {
        masterGain = g.coerceIn(0f, 4f)
    }

    fun stop() {
        val t: Thread?
        synchronized(lock) {
            running = false
            (lock as java.lang.Object).notifyAll()
            t = writerThread
            writerThread = null
        }
        try {
            t?.join(250)
        } catch (_: Exception) {
        }
        synchronized(lock) {
            frameQueue.clear()
            queuedShortsTotal = 0
            framesSubmittedToHal = 0L
            try {
                track?.stop()
            } catch (_: Exception) {
            }
            try {
                track?.release()
            } catch (_: Exception) {
            }
            track = null
        }
    }

    private fun writerLoop() {
        while (true) {
            val next: ShortArray?
            val t: AudioTrack?
            synchronized(lock) {
                while (running && frameQueue.isEmpty()) {
                    try {
                        (lock as java.lang.Object).wait(writerWaitMs)
                    } catch (_: InterruptedException) {
                        return
                    }
                }
                if (!running) return
                next = if (frameQueue.isEmpty()) null else frameQueue.removeFirst()
                if (next != null) {
                    queuedShortsTotal -= next.size
                }
                t = track
            }
            if (next == null || t == null) continue
            var off = 0
            var stalls = 0
            while (off < next.size) {
                val w = t.write(next, off, next.size - off)
                when {
                    w > 0 -> {
                        off += w
                        stalls = 0
                        synchronized(lock) {
                            framesSubmittedToHal += (w / 2).toLong()
                        }
                    }
                    w == 0 -> {
                        stalls++
                        if (stalls > 2000) break
                        Thread.sleep(1)
                    }
                    else -> {
                        stalls++
                        if (stalls > 200) break
                        Thread.sleep(2)
                    }
                }
            }
        }
    }
}
