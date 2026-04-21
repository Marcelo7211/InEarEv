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
import com.inear.android.net.InEarRepository

private const val UDP_CONTROL_PORT = 9877
private const val SAMPLE_RATE = 48_000

data class RetornoStats(
    val transport: String = "off",
    val connected: Boolean = false,
    val playing: Boolean = false,
    val lastError: String? = null,
    val framesReceived: Long = 0,
    val sequenceGaps: Int = 0,
    val queuedFrames: Int = 0,
)

/**
 * Retorno só por PCM INE1 (UDP → WebSocket). WebRTC foi removido do arranque: em LAN o RTP
 * competia com o PCM e gerava chiado; o caminho estável é o mesmo wireframe do servidor.
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

    fun start(apiBase: String, token: String, latency: String) {
        job?.cancel()
        job = scope.launch(Dispatchers.IO) {
            stopInternal()
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
        _stats.value = RetornoStats()
    }

    /** UDP INE1 primeiro (mesma porta que o registo de controlo). */
    private fun connectUdpFirst(host: String, token: String, latency: String): Boolean {
        val socket = DatagramSocket()
        try {
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
                    val frame = Ine1Decoder.tryDecode(buf, off, len) ?: continue
                    sink.start(latency)
                    udpSocket = socket
                    onIne1Frame(frame)
                    _stats.value = RetornoStats(
                        transport = "udp",
                        connected = true,
                        playing = true,
                        lastError = null,
                        queuedFrames = sink.queuedFrames(),
                    )
                    val rcv = socket
                    recvThread = thread(name = "inear-udp") {
                        val localBuf = ByteArray(65536)
                        while (running && !Thread.currentThread().isInterrupted) {
                            try {
                                rcv.soTimeout = 5000
                                val pkt = DatagramPacket(localBuf, localBuf.size)
                                rcv.receive(pkt)
                                val f = Ine1Decoder.tryDecode(localBuf, pkt.offset, pkt.length) ?: continue
                                onIne1Frame(f)
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
        val lat = if (latency == "low") "low" else "stable"
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
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {}

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
        lastSeq = frame.sequence
        if (prev != null) {
            val expected = (prev + 1) and 0x7fff_ffff
            if (frame.sequence != expected) {
                gapAdd = (frame.sequence - prev - 1).coerceIn(0, 10_000)
            }
        }
        sink.writeInterleavedS16(frame.pcmInterleavedS16, frame.pcmInterleavedS16.size)
        _stats.update { s ->
            s.copy(
                framesReceived = s.framesReceived + 1,
                queuedFrames = sink.queuedFrames(),
                sequenceGaps = if (gapAdd > 0) s.sequenceGaps + gapAdd else s.sequenceGaps,
            )
        }
    }

    fun setMasterGain(g: Float) {
        sink.setMaster(g)
    }
}
