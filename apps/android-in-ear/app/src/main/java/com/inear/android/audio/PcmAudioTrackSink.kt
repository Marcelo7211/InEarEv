package com.inear.android.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import java.util.ArrayDeque
import kotlin.concurrent.thread
import kotlin.math.roundToInt

/**
 * Playback PCM s16 interleaved estéreo via [AudioTrack] (sem JNI).
 * Para Oboe/NDK no futuro, substituir por motor nativo com menor jitter em alguns dispositivos.
 */
class PcmAudioTrackSink(private val sampleRate: Int = 48_000) {
    private var track: AudioTrack? = null
    private val lock = Any()
  private val frameQueue = ArrayDeque<ShortArray>()
  private var writerThread: Thread? = null
  private var running = false
  private var maxQueuedFrames = 4

    @Volatile
    private var masterGain: Float = 1f

  fun start(latencyProfile: String = "stable") {
        synchronized(lock) {
            if (track != null) return
            val minBuf = AudioTrack.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_OUT_STEREO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBuf <= 0) return
      val lowLatency = latencyProfile == "low"
      val bufBytes = (minBuf * if (lowLatency) 1 else 2).coerceAtLeast(minBuf / 2)
      maxQueuedFrames = if (lowLatency) 1 else 3
            val attr = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val fmt = AudioFormat.Builder()
                .setSampleRate(sampleRate)
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .build()
            val t = AudioTrack.Builder()
                .setAudioAttributes(attr)
                .setAudioFormat(fmt)
                .setBufferSizeInBytes(bufBytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            t.play()
            track = t
      running = true
      writerThread = thread(name = "inear-audio-writer", start = true) {
        writerLoop()
      }
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
    synchronized(lock) {
      if (!running || track == null) return
      frameQueue.addLast(frame)
      while (frameQueue.size > maxQueuedFrames) {
        frameQueue.removeFirst()
      }
      (lock as java.lang.Object).notifyAll()
        }
    }

  fun queuedFrames(): Int = synchronized(lock) { frameQueue.size }

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
            (lock as java.lang.Object).wait(if (maxQueuedFrames <= 1) 6 else 20)
          } catch (_: InterruptedException) {
            return
          }
        }
        if (!running) return
        next = if (frameQueue.isEmpty()) null else frameQueue.removeFirst()
        t = track
      }
      if (next == null || t == null) continue
      var off = 0
      while (off < next.size) {
        val w = t.write(next, off, next.size - off)
        if (w <= 0) break
        off += w
      }
    }
  }
}
