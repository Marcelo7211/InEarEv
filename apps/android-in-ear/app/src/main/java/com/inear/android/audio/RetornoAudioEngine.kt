package com.inear.android.audio

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.json.JSONObject
import com.inear.android.net.InEarRepository

private const val UDP_CONTROL_PORT = 9877
private const val SAMPLE_RATE = 48_000

/** Margem acima do tecto configurado do sink antes de drenar (só RAM + eventual flush). */
private const val CATCHUP_ABOVE_QUEUE_HEADROOM_MS = 18

/** Nunca deixar o «PCM recebido à frente do relógio» ultrapassar isto (ms), qualquer que seja o perfil. */
private const val PLAYOUT_BACKLOG_ABSOLUTE_MAX_MS = 160.0

data class RetornoStats(
    val transport: String = "off",
    val connected: Boolean = false,
    val playing: Boolean = false,
    val lastError: String? = null,
    val framesReceived: Long = 0,
    val sequenceGaps: Int = 0,
    val queuedFrames: Int = 0,
    val queuedAudioMs: Int = 0,
    val halQueuedMs: Int = 0,
    val estimatedLatencyMs: Int = 0,
)

/**
 * Retorno só por PCM INE1 (UDP → WebSocket). WebRTC foi removido do arranque: em LAN o RTP
 * competia com o PCM e gerava chiado; o caminho estável é o mesmo wireframe do servidor.
 *
 * **Rede interna / LAN:** prefere sempre **UDP** (controlo :9877, PCM :9876) — o cliente tenta-o
 * primeiro; evita filas gigantes de TCP no WebSocket. Garante firewall/router a permitir UDP
 * entre o telemóvel e o host do servidor.
 */
class RetornoAudioEngine(
    @Suppress("UNUSED_PARAMETER") private val appContext: android.content.Context,
    private val scope: CoroutineScope,
    @Suppress("UNUSED_PARAMETER")
    private val repository: InEarRepository = InEarRepository(),
    private val httpClient: OkHttpClient = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .build(),
) {
    private val sink = PcmAudioTrackSink(SAMPLE_RATE)
    private val _stats = MutableStateFlow(RetornoStats())
    val stats: StateFlow<RetornoStats> = _stats.asStateFlow()

    private var job: Job? = null
    private var udpSocket: DatagramSocket? = null
    private var ws: WebSocket? = null
    private var recvThread: Thread? = null

    @Volatile
    private var running = false

    @Volatile
    private var lastSeq: Int? = null

    /**
     * Início da janela «PCM recebido vs tempo real» (bursts TCP / WS).
     * Usa [System.nanoTime] para não subestimar o atraso quando muitos frames chegam no mesmo ms.
     */
    private var playoutSessionStartNs: Long = 0L

    private var totalReceivedMediaMs: Double = 0.0

    /** Se (PCM acumulado − tempo real) > isto, drena playout (ms). */
    private var playoutCatchupBacklogMs: Double = 200.0

    /** Perfil passado a [start] — usado para limiar da fila HAL (TCP 2,4 GHz). */
    private var retornoLatencyProfile: String = "stable"

    private fun resetPlayoutDebt() {
        playoutSessionStartNs = 0L
        totalReceivedMediaMs = 0.0
    }

    fun start(apiBase: String, token: String, latency: String) {
        job?.cancel()
        job = scope.launch(Dispatchers.IO) {
            stopInternal()
            retornoLatencyProfile = latency
            playoutCatchupBacklogMs =
                when (latency) {
                    "mid200" -> 140.0
                    "pro" -> 42.0
                    "low" -> 72.0
                    "wifi24" -> 95.0
                    else -> 160.0
                }
            resetPlayoutDebt()
            running = true
            lastSeq = null
            _stats.value = RetornoStats(transport = "starting", connected = false, playing = false)
            try {
                val host = URL(apiBase.trim().trimEnd('/')).host
                if (connectUdpFirst(host, token, latency)) return@launch
                if (running) connectWebSocketOnly(apiBase, token, latency)
            } catch (e: Exception) {
                _stats.value = RetornoStats(
                    transport = "error",
                    connected = false,
                    playing = false,
                    lastError = e.message,
                )
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        scope.launch(Dispatchers.IO) { stopInternal() }
    }

    private fun stopInternal() {
        running = false
        recvThread?.interrupt()
        recvThread = null
        try {
            udpSocket?.close()
        } catch (_: Exception) {
        }
        udpSocket = null
        try {
            ws?.close(1000, "stop")
        } catch (_: Exception) {
        }
        ws = null
        sink.stop()
        resetPlayoutDebt()
        _stats.value = RetornoStats()
    }

    /** UDP INE1 primeiro (mesma porta que o registo de controlo). */
    private fun connectUdpFirst(host: String, token: String, latency: String): Boolean {
        val socket = DatagramSocket()
        try {
            try {
                /* Em palco interessa mais frescura do que "não perder nada": evita segundos de backlog no kernel. */
                socket.receiveBufferSize = 64 * 1024
            } catch (_: Exception) {
            }
            val reg = """{"t":"reg","token":"$token"}""".toByteArray(StandardCharsets.UTF_8)
            socket.send(
                DatagramPacket(reg, reg.size, InetAddress.getByName(host), UDP_CONTROL_PORT),
            )
            val buf = ByteArray(65536)
            val deadline = System.currentTimeMillis() + 5000
            while (running && System.currentTimeMillis() < deadline) {
                socket.soTimeout = 200
                try {
                    val p = DatagramPacket(buf, buf.size)
                    socket.receive(p)
                    val off = p.offset
                    val len = p.length
                    if (len < Ine1Decoder.HEADER_BYTES) continue
                    var frame = Ine1Decoder.tryDecode(buf, off, len) ?: continue
                    while (true) {
                        try {
                            socket.soTimeout = 1
                            val newer = DatagramPacket(buf, buf.size)
                            socket.receive(newer)
                            val candidate =
                                Ine1Decoder.tryDecode(buf, newer.offset, newer.length) ?: continue
                            frame = candidate
                        } catch (_: SocketTimeoutException) {
                            break
                        }
                    }
                    sink.start(latency)
                    udpSocket = socket
                    onIne1Frame(frame)
                    _stats.value = RetornoStats(
                        transport = "udp",
                        connected = true,
                        playing = true,
                        lastError = null,
                        queuedFrames = sink.queuedFrames(),
                        queuedAudioMs = sink.queuedAudioMsApprox(),
                        halQueuedMs = sink.halQueuedMsApprox(),
                        estimatedLatencyMs = sink.queuedAudioMsApprox() + sink.halQueuedMsApprox(),
                    )
                    val rcv = socket
                    recvThread = thread(name = "inear-udp") {
                        val localBuf = ByteArray(65536)
                        while (running && !Thread.currentThread().isInterrupted) {
                            try {
                                rcv.soTimeout = 5000
                                val pkt = DatagramPacket(localBuf, localBuf.size)
                                rcv.receive(pkt)
                                var latest =
                                    Ine1Decoder.tryDecode(localBuf, pkt.offset, pkt.length) ?: continue
                                while (true) {
                                    try {
                                        rcv.soTimeout = 1
                                        val newer = DatagramPacket(localBuf, localBuf.size)
                                        rcv.receive(newer)
                                        val candidate =
                                            Ine1Decoder.tryDecode(localBuf, newer.offset, newer.length)
                                                ?: continue
                                        latest = candidate
                                    } catch (_: SocketTimeoutException) {
                                        break
                                    }
                                }
                                onIne1Frame(latest)
                            } catch (_: SocketTimeoutException) {
                                continue
                            } catch (_: Exception) {
                                break
                            }
                        }
                    }
                    return true
                } catch (_: SocketTimeoutException) {
                    continue
                }
            }
        } catch (_: Exception) {
            /* ignore */
        } finally {
            if (udpSocket !== socket) {
                try {
                    socket.close()
                } catch (_: Exception) {
                }
            }
        }
        return false
    }

    private fun connectWebSocketOnly(apiBase: String, token: String, latency: String) {
        val u = URL(apiBase.trim().trimEnd('/'))
        val wsScheme = if (u.protocol == "https") "wss" else "ws"
        val port = when (u.port) {
            -1 -> 3847
            else -> u.port
        }
        val lat = when (latency) {
            "mid200" -> "stable"
            "pro" -> "pro"
            "low" -> "low"
            "wifi24" -> "wifi24"
            else -> "stable"
        }
        val wsUrl =
            "$wsScheme://${u.host}:$port/api/stream/audio?token=" +
                java.net.URLEncoder.encode(token, Charsets.UTF_8.name()) +
                "&latency=" + java.net.URLEncoder.encode(lat, Charsets.UTF_8.name())
        sink.start(lat)
        val req = Request.Builder().url(wsUrl).build()
        ws = httpClient.newWebSocket(
            req,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    if (!running) {
                        try {
                            webSocket.close(1000, "stop")
                        } catch (_: Exception) {
                        }
                        return
                    }
                    _stats.value = RetornoStats(
                        transport = "ws",
                        connected = true,
                        playing = true,
                        lastError = null,
                        queuedFrames = sink.queuedFrames(),
                        queuedAudioMs = sink.queuedAudioMsApprox(),
                        halQueuedMs = sink.halQueuedMsApprox(),
                        estimatedLatencyMs = sink.queuedAudioMsApprox() + sink.halQueuedMsApprox(),
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (!running) return
                    try {
                        val j = JSONObject(text)
                        if (j.optString("t") != "hello") return
                        val hz = j.optInt("sampleRateHz", SAMPLE_RATE)
                        val bs = j.optInt("blockSamples", 0)
                        if (hz > 0 && hz != SAMPLE_RATE) {
                            android.util.Log.d(
                                "inear-retorno",
                                "hello sampleRateHz=$hz (client assume $SAMPLE_RATE)",
                            )
                        }
                        if (bs > 0) {
                            android.util.Log.d("inear-retorno", "hello blockSamples=$bs")
                        }
                    } catch (_: Exception) {
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    if (!running) return
                    val arr = bytes.toByteArray()
                    val frame = Ine1Decoder.tryDecode(arr, 0, arr.size) ?: return
                    onIne1Frame(frame)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    _stats.value = _stats.value.copy(
                        connected = false,
                        playing = false,
                        lastError = t.message,
                    )
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    try {
                        webSocket.close(1000, null)
                    } catch (_: Exception) {
                    }
                }
            },
        )
    }

    private fun onIne1Frame(frame: Ine1Decoder.Frame) {
        var gapAdd = 0
        val prev = lastSeq
        if (prev != null) {
            val mask = 0x7fff_ffffL
            fun u31(x: Int): Long = x.toLong() and mask
            val expected = ((u31(prev) + 1L) and mask).toInt()
            if (frame.sequence != expected) {
                val ahead = ((u31(frame.sequence) - u31(expected) + (mask + 1L)) and mask).toInt()
                val behind = ((u31(expected) - u31(frame.sequence) + (mask + 1L)) and mask).toInt()
                if (behind in 1..200) {
                    return
                }
                gapAdd = ahead.coerceIn(0, 10_000)
            }
        }
        lastSeq = frame.sequence

        if (playoutSessionStartNs == 0L) {
            playoutSessionStartNs = System.nanoTime()
            totalReceivedMediaMs = 0.0
        }
        val frameMs = frame.samplesPerChannel * 1000.0 / SAMPLE_RATE
        totalReceivedMediaMs += frameMs
        val wallMs = (System.nanoTime() - playoutSessionStartNs) / 1_000_000.0
        val backlogMs = totalReceivedMediaMs - wallMs
        if (backlogMs > playoutCatchupBacklogMs || backlogMs > PLAYOUT_BACKLOG_ABSOLUTE_MAX_MS) {
            sink.drainPlayoutBuffer()
            resetPlayoutDebt()
        }

        val cap = sink.maxConfiguredPlayoutQueueMs()
        if (sink.queuedAudioMsApprox() > cap + CATCHUP_ABOVE_QUEUE_HEADROOM_MS) {
            sink.drainPlayoutBuffer()
            resetPlayoutDebt()
        }

        /* Fila no AudioTrack (HAL): com WS a taxa média pode parecer «em dia» mas o DSP leva segundos. */
        val halCapMs =
            when (retornoLatencyProfile) {
                "mid200" -> 120
                "pro" -> 48
                "low" -> 72
                "wifi24" -> 95
                else -> 130
            }
        if (totalReceivedMediaMs > 50.0 && sink.halQueuedMsApprox() > halCapMs) {
            sink.drainPlayoutBuffer()
            resetPlayoutDebt()
        }

        if (gapAdd in 1..3) {
            val silent = ShortArray(frame.samplesPerChannel * gapAdd * 2)
            sink.writeInterleavedS16(silent, silent.size)
        } else if (gapAdd > 3) {
            sink.drainPlayoutBuffer()
            resetPlayoutDebt()
        }

        sink.writeInterleavedS16(frame.pcmInterleavedS16, frame.pcmInterleavedS16.size)

        _stats.update { s ->
            val queuedAudioMs = sink.queuedAudioMsApprox()
            val halQueuedMs = sink.halQueuedMsApprox()
            s.copy(
                framesReceived = s.framesReceived + 1,
                queuedFrames = sink.queuedFrames(),
                queuedAudioMs = queuedAudioMs,
                halQueuedMs = halQueuedMs,
                estimatedLatencyMs = queuedAudioMs + halQueuedMs,
                sequenceGaps = if (gapAdd > 0) s.sequenceGaps + gapAdd else s.sequenceGaps,
            )
        }
    }

    fun setMasterGain(g: Float) {
        sink.setMaster(g)
    }
}
