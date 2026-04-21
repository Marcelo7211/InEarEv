package com.inear.android.audio

import android.media.AudioManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
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
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import org.webrtc.AudioTrack
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
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

class RetornoAudioEngine(
    private val appContext: android.content.Context,
    private val scope: CoroutineScope,
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
    private var pc: PeerConnection? = null
    private var audioManager: AudioManager? = null
    private var prevMode: Int? = null
    private var prevSpeaker: Boolean? = null

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
                if (tryWebRtc(apiBase, token, latency)) return@launch
                val host = URL(apiBase.trim().trimEnd('/')).host
                if (tryUdp(host, token, latency)) return@launch
                tryWebSocket(apiBase, token, latency)
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
        try {
            pc?.close()
        } catch (_: Exception) {
        }
        pc = null
        restoreAudioRoute()
        sink.stop()
        _stats.value = RetornoStats()
    }

    private suspend fun tryWebRtc(apiBase: String, token: String, latency: String): Boolean {
        if (!ensureWebRtcFactory(appContext)) return false
        val pcFactory = sharedPcFactory ?: return false
        val rtcConfig = PeerConnection.RTCConfiguration(emptyList()).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        var gotAudioTrack = false
        val peer = pcFactory.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onSignalingChange(newState: PeerConnection.SignalingState) {}
                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                    if (newState == PeerConnection.IceConnectionState.FAILED) {
                        _stats.update { it.copy(lastError = "webrtc ice failed", connected = false) }
                    }
                }
                override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {}
                override fun onIceCandidate(candidate: org.webrtc.IceCandidate) {}
                override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>) {}
                override fun onAddStream(stream: org.webrtc.MediaStream) {}
                override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
                override fun onDataChannel(dc: org.webrtc.DataChannel) {}
                override fun onRenegotiationNeeded() {}
                override fun onAddTrack(receiver: org.webrtc.RtpReceiver, streams: Array<out org.webrtc.MediaStream>) {
                    val track = receiver.track()
                    if (track is AudioTrack) {
                        track.setEnabled(true)
                        forceSpeakerRoute()
                        gotAudioTrack = true
                        _stats.update { it.copy(transport = "webrtc", connected = true, playing = true, lastError = null) }
                    }
                }
                override fun onTrack(transceiver: RtpTransceiver) {
                    val tr = transceiver.receiver.track()
                    if (tr is AudioTrack) {
                        tr.setEnabled(true)
                        forceSpeakerRoute()
                        gotAudioTrack = true
                        _stats.update { it.copy(transport = "webrtc", connected = true, playing = true, lastError = null) }
                    }
                }
            },
        ) ?: return false
        pc = peer
        val transInit = RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY)
        peer.addTransceiver(org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, transInit)
        val offer = createOffer(peer)
        setLocal(peer, offer)
        // LAN: espera breve para coletar candidates host no SDP.
        kotlinx.coroutines.delay(500)
        val localSdp = peer.localDescription?.description ?: offer.description
        val ans = repository.createWebRtcAnswer(apiBase, token, localSdp)
        if (ans.sdp.isBlank()) {
            peer.close()
            pc = null
            return false
        }
        setRemote(peer, SessionDescription(SessionDescription.Type.ANSWER, ans.sdp))
        forceSpeakerRoute()
        _stats.value = RetornoStats(transport = "webrtc", connected = true, playing = true, queuedFrames = 0)
        // Se não houver track em breve, deixa fallback atuar.
        kotlinx.coroutines.delay(1200)
        if (!gotAudioTrack) {
            try {
                peer.close()
            } catch (_: Exception) {}
            pc = null
            restoreAudioRoute()
            _stats.update { it.copy(connected = false, playing = false, lastError = "webrtc sem track de audio") }
            return false
        }
        return true
    }

    private fun tryUdp(host: String, token: String, latency: String): Boolean {
        val socket = DatagramSocket()
        udpSocket = socket
        val reg = """{"t":"reg","token":"$token"}""".toByteArray(StandardCharsets.UTF_8)
        socket.send(
            DatagramPacket(reg, reg.size, InetAddress.getByName(host), UDP_CONTROL_PORT),
        )
        val buf = ByteArray(65536)
        val deadline = System.currentTimeMillis() + 2800
        var gotIne1 = false
        while (running && System.currentTimeMillis() < deadline && !gotIne1) {
            socket.soTimeout = 400
            try {
                val p = DatagramPacket(buf, buf.size)
                socket.receive(p)
                if (p.length >= Ine1Decoder.HEADER_BYTES) {
                    val frame = Ine1Decoder.tryDecode(buf, 0, p.length)
                    if (frame != null) {
                        gotIne1 = true
                        sink.start(latency)
                        onIne1Frame(frame)
                    }
                }
            } catch (_: SocketTimeoutException) {
                continue
            }
        }
        if (!gotIne1) {
            try {
                socket.close()
            } catch (_: Exception) {
            }
            udpSocket = null
            return false
        }
        val rcv = socket
        _stats.value = RetornoStats(
            transport = "udp",
            connected = true,
            playing = true,
            lastError = null,
            queuedFrames = sink.queuedFrames(),
        )
        recvThread = thread(name = "inear-udp") {
            val localBuf = ByteArray(65536)
            while (running && !Thread.currentThread().isInterrupted) {
                try {
                    rcv.soTimeout = 5000
                    val pkt = DatagramPacket(localBuf, localBuf.size)
                    rcv.receive(pkt)
                    val frame = Ine1Decoder.tryDecode(localBuf, 0, pkt.length) ?: continue
                    onIne1Frame(frame)
                } catch (_: SocketTimeoutException) {
                    continue
                } catch (_: Exception) {
                    break
                }
            }
        }
        return true
    }

    private fun onIne1Frame(frame: Ine1Decoder.Frame) {
        val prev = lastSeq
        lastSeq = frame.sequence
        if (prev != null) {
            val expected = (prev + 1) and 0x7fff_ffff
            if (frame.sequence != expected) {
                val delta = (frame.sequence - prev - 1).coerceIn(0, 10_000)
                if (delta > 0) {
                    _stats.update { s -> s.copy(sequenceGaps = s.sequenceGaps + delta) }
                }
            }
        }
        sink.writeInterleavedS16(frame.pcmInterleavedS16, frame.pcmInterleavedS16.size)
        _stats.update { s -> s.copy(framesReceived = s.framesReceived + 1) }
        _stats.update { s -> s.copy(queuedFrames = sink.queuedFrames()) }
    }

    private fun tryWebSocket(apiBase: String, token: String, latency: String) {
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
                    _stats.value = RetornoStats(
                        transport = "ws",
                        connected = true,
                        playing = true,
                        lastError = null,
                        queuedFrames = sink.queuedFrames(),
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    // servidor envia hello JSON — taxa fixa MVP 48 kHz
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
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
                    webSocket.close(1000, null)
                }
            },
        )
    }

    fun setMasterGain(g: Float) {
        sink.setMaster(g)
    }

    private fun forceSpeakerRoute() {
        val mgr = (audioManager ?: appContext.getSystemService(AudioManager::class.java))
        if (mgr != null) {
            if (audioManager == null) {
                audioManager = mgr
                prevMode = mgr.mode
                prevSpeaker = mgr.isSpeakerphoneOn
            }
            try {
                mgr.mode = AudioManager.MODE_IN_COMMUNICATION
                mgr.isSpeakerphoneOn = true
            } catch (_: Exception) {
                /* ignore route failures */
            }
        }
    }

    private fun restoreAudioRoute() {
        val mgr = audioManager ?: return
        try {
            if (prevSpeaker != null) mgr.isSpeakerphoneOn = prevSpeaker == true
            if (prevMode != null) mgr.mode = prevMode ?: AudioManager.MODE_NORMAL
        } catch (_: Exception) {
            /* */
        }
        audioManager = null
        prevMode = null
        prevSpeaker = null
    }

    private suspend fun createOffer(peer: PeerConnection): SessionDescription =
        suspendCancellableCoroutine { cont ->
            peer.createOffer(object : SdpObserver {
                override fun onCreateSuccess(desc: SessionDescription?) {
                    if (desc != null) cont.resume(desc) else cont.resumeWithException(IllegalStateException("offer vazio"))
                }
                override fun onCreateFailure(err: String?) { cont.resumeWithException(IllegalStateException(err ?: "offer failure")) }
                override fun onSetSuccess() {}
                override fun onSetFailure(err: String?) {}
            }, MediaConstraints())
        }

    private suspend fun setLocal(peer: PeerConnection, desc: SessionDescription): Unit =
        suspendCancellableCoroutine { cont ->
            peer.setLocalDescription(object : SdpObserver {
                override fun onSetSuccess() { cont.resume(Unit) }
                override fun onSetFailure(err: String?) { cont.resumeWithException(IllegalStateException(err ?: "setLocal failure")) }
                override fun onCreateSuccess(desc: SessionDescription?) {}
                override fun onCreateFailure(err: String?) {}
            }, desc)
        }

    private suspend fun setRemote(peer: PeerConnection, desc: SessionDescription): Unit =
        suspendCancellableCoroutine { cont ->
            peer.setRemoteDescription(object : SdpObserver {
                override fun onSetSuccess() { cont.resume(Unit) }
                override fun onSetFailure(err: String?) { cont.resumeWithException(IllegalStateException(err ?: "setRemote failure")) }
                override fun onCreateSuccess(desc: SessionDescription?) {}
                override fun onCreateFailure(err: String?) {}
            }, desc)
        }

    companion object {
        @Volatile private var factoryReady = false
        @Volatile private var sharedPcFactory: PeerConnectionFactory? = null
        private fun ensureWebRtcFactory(app: android.content.Context): Boolean {
            if (factoryReady && sharedPcFactory != null) return true
            return try {
                val initOptions = PeerConnectionFactory.InitializationOptions.builder(app).createInitializationOptions()
                PeerConnectionFactory.initialize(initOptions)
                val adm = JavaAudioDeviceModule.builder(app).createAudioDeviceModule()
                sharedPcFactory = PeerConnectionFactory.builder()
                    .setAudioDeviceModule(adm)
                    .createPeerConnectionFactory()
                factoryReady = sharedPcFactory != null
                factoryReady
            } catch (_: Exception) {
                false
            }
        }
    }
}
