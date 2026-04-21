package com.inear.android.audio

import android.media.AudioManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
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

private enum class RingTransport {
    UDP,
    WS,
    WEBRTC,
}

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
                val host = URL(apiBase.trim().trimEnd('/')).host
                startTransportRace(apiBase, host, token, latency)
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

    private suspend fun startTransportRace(
        apiBase: String,
        host: String,
        token: String,
        latency: String,
    ) {
        val winRef = AtomicReference<RingTransport?>(null)
        val settled = CompletableDeferred<RingTransport>()
        val winLock = Any()

        fun tryWin(t: RingTransport): Boolean {
            synchronized(winLock) {
                if (winRef.get() != null) return false
                winRef.set(t)
                settled.complete(t)
                return true
            }
        }

        fun otherWon(me: RingTransport): Boolean {
            val w = winRef.get()
            return w != null && w != me
        }

        val jUdp = scope.launch(Dispatchers.IO) {
            runUdpRace(host, token, latency, me = RingTransport.UDP, ::tryWin, ::otherWon)
        }
        val jWs = scope.launch(Dispatchers.IO) {
            runWsRace(apiBase, token, latency, me = RingTransport.WS, ::tryWin, ::otherWon)
        }
        val jRtc = scope.launch(Dispatchers.IO) {
            runRtcRace(apiBase, token, latency, me = RingTransport.WEBRTC, winRef, ::tryWin, ::otherWon)
        }

        val picked = withTimeoutOrNull(12_000) { settled.await() }
        jUdp.cancel()
        jWs.cancel()
        jRtc.cancel()
        jUdp.join()
        jWs.join()
        jRtc.join()

        if (picked == null && !settled.isCompleted) {
            running = false
            stopInternal()
            _stats.value = RetornoStats(
                transport = "error",
                connected = false,
                playing = false,
                lastError = "sem transporte (timeout)",
            )
        }
    }

    private suspend fun runUdpRace(
        host: String,
        token: String,
        latency: String,
        me: RingTransport,
        tryWin: (RingTransport) -> Boolean,
        otherWon: (RingTransport) -> Boolean,
    ) {
        if (otherWon(me)) return
        val socket = DatagramSocket()
        try {
            val reg = """{"t":"reg","token":"$token"}""".toByteArray(StandardCharsets.UTF_8)
            socket.send(
                DatagramPacket(reg, reg.size, InetAddress.getByName(host), UDP_CONTROL_PORT),
            )
            val buf = ByteArray(65536)
            val deadline = System.currentTimeMillis() + 5000
            while (running && System.currentTimeMillis() < deadline) {
                if (otherWon(me)) return
                socket.soTimeout = 120
                try {
                    val p = DatagramPacket(buf, buf.size)
                    socket.receive(p)
                    if (otherWon(me)) return
                    if (p.length < Ine1Decoder.HEADER_BYTES) continue
                    val frame = Ine1Decoder.tryDecode(buf, 0, p.length) ?: continue
                    if (!tryWin(me)) {
                        return
                    }
                    udpSocket = socket
                    sink.start(latency)
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
                                val f = Ine1Decoder.tryDecode(localBuf, 0, pkt.length) ?: continue
                                onIne1Frame(f)
                            } catch (_: SocketTimeoutException) {
                                continue
                            } catch (_: Exception) {
                                break
                            }
                        }
                    }
                    return
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
    }

    private suspend fun runWsRace(
        apiBase: String,
        token: String,
        latency: String,
        me: RingTransport,
        tryWin: (RingTransport) -> Boolean,
        otherWon: (RingTransport) -> Boolean,
    ) {
        if (otherWon(me)) return
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
        withTimeoutOrNull(4500L) {
            suspendCancellableCoroutine { cont ->
                val waitDone = AtomicBoolean(false)
                fun endWsWait() {
                    if (waitDone.compareAndSet(false, true) && cont.isActive) {
                        cont.resume(Unit) {}
                    }
                }
                if (otherWon(me)) {
                    endWsWait()
                    return@suspendCancellableCoroutine
                }
                val req = Request.Builder().url(wsUrl).build()
                val call = httpClient.newWebSocket(
                    req,
                    object : WebSocketListener() {
                        override fun onOpen(webSocket: WebSocket, response: Response) {
                            if (otherWon(me) || !running) {
                                try {
                                    webSocket.close(1000, "abort")
                                } catch (_: Exception) {
                                }
                                endWsWait()
                            }
                        }

                        override fun onMessage(webSocket: WebSocket, text: String) {}

                        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                            if (!running || otherWon(me)) {
                                try {
                                    webSocket.close(1000, "abort")
                                } catch (_: Exception) {
                                }
                                endWsWait()
                                return
                            }
                            val arr = bytes.toByteArray()
                            val frame = Ine1Decoder.tryDecode(arr, 0, arr.size) ?: return
                            if (!tryWin(me)) {
                                try {
                                    webSocket.close(1000, "lost-race")
                                } catch (_: Exception) {
                                }
                                endWsWait()
                                return
                            }
                            ws = webSocket
                            sink.start(lat)
                            onIne1Frame(frame)
                            _stats.value = RetornoStats(
                                transport = "ws",
                                connected = true,
                                playing = true,
                                lastError = null,
                                queuedFrames = sink.queuedFrames(),
                            )
                            endWsWait()
                        }

                        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                            endWsWait()
                        }

                        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                            try {
                                webSocket.close(1000, null)
                            } catch (_: Exception) {
                            }
                        }
                    },
                )
                cont.invokeOnCancellation {
                    try {
                        call.cancel()
                    } catch (_: Exception) {
                    }
                }
            }
        }
    }

    private suspend fun runRtcRace(
        apiBase: String,
        token: String,
        @Suppress("UNUSED_PARAMETER") latency: String,
        me: RingTransport,
        winRef: AtomicReference<RingTransport?>,
        tryWin: (RingTransport) -> Boolean,
        otherWon: (RingTransport) -> Boolean,
    ) {
        withTimeoutOrNull(6500L) {
            runRtcRaceInner(apiBase, token, me, winRef, tryWin, otherWon)
        }
    }

    private suspend fun runRtcRaceInner(
        apiBase: String,
        token: String,
        me: RingTransport,
        winRef: AtomicReference<RingTransport?>,
        tryWin: (RingTransport) -> Boolean,
        otherWon: (RingTransport) -> Boolean,
    ) {
        var peer: PeerConnection? = null
        val gotAudioTrack = AtomicBoolean(false)
        try {
            if (otherWon(me)) return
            if (!ensureWebRtcFactory(appContext)) return
            val pcFactory = sharedPcFactory ?: return
            if (otherWon(me)) return
            val rtcConfig = PeerConnection.RTCConfiguration(emptyList()).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            }
            val created = pcFactory.createPeerConnection(
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
                            gotAudioTrack.set(true)
                        }
                    }
                    override fun onTrack(transceiver: RtpTransceiver) {
                        val tr = transceiver.receiver.track()
                        if (tr is AudioTrack) {
                            tr.setEnabled(true)
                            forceSpeakerRoute()
                            gotAudioTrack.set(true)
                        }
                    }
                },
            ) ?: return
            if (otherWon(me)) {
                try {
                    created.close()
                } catch (_: Exception) {
                }
                return
            }
            peer = created
            pc = created
            val transInit = RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY)
            created.addTransceiver(org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO, transInit)
            val offer = createOffer(created)
            setLocal(created, offer)
            if (otherWon(me)) {
                try {
                    created.close()
                } catch (_: Exception) {
                }
                pc = null
                return
            }
            waitIceGatheringCapMs(created, maxWaitMs = 280L)
            val localSdp = created.localDescription?.description ?: offer.description
            val ans = repository.createWebRtcAnswer(apiBase, token, localSdp)
            if (otherWon(me) || ans.sdp.isBlank()) {
                try {
                    created.close()
                } catch (_: Exception) {
                }
                pc = null
                return
            }
            setRemote(created, SessionDescription(SessionDescription.Type.ANSWER, ans.sdp))
            forceSpeakerRoute()
            waitUntilTrueOrTimeout({ gotAudioTrack.get() || otherWon(me) }, maxWaitMs = 900L, pollMs = 12L)
            if (otherWon(me)) {
                try {
                    created.close()
                } catch (_: Exception) {
                }
                pc = null
                restoreAudioRoute()
                return
            }
            if (!gotAudioTrack.get()) {
                try {
                    created.close()
                } catch (_: Exception) {
                }
                pc = null
                restoreAudioRoute()
                return
            }
            if (!tryWin(me)) {
                try {
                    created.close()
                } catch (_: Exception) {
                }
                pc = null
                restoreAudioRoute()
                return
            }
            _stats.update {
                it.copy(transport = "webrtc", connected = true, playing = true, lastError = null, queuedFrames = 0)
            }
        } catch (_: Exception) {
            try {
                peer?.close()
            } catch (_: Exception) {
            }
            if (pc === peer) pc = null
            restoreAudioRoute()
        } finally {
            if (winRef.get() != RingTransport.WEBRTC && peer != null) {
                try {
                    peer.close()
                } catch (_: Exception) {
                }
                if (pc === peer) pc = null
                restoreAudioRoute()
            }
        }
    }

    /** ICE completo ou teto — evita espera fixa longa antes do POST do offer. */
    private suspend fun waitIceGatheringCapMs(peer: PeerConnection, maxWaitMs: Long) {
        val deadline = System.currentTimeMillis() + maxWaitMs
        while (
            peer.iceGatheringState != PeerConnection.IceGatheringState.COMPLETE &&
            System.currentTimeMillis() < deadline &&
            running
        ) {
            delay(12L)
        }
    }

    private suspend fun waitUntilTrueOrTimeout(
        predicate: () -> Boolean,
        maxWaitMs: Long,
        pollMs: Long,
    ) {
        val deadline = System.currentTimeMillis() + maxWaitMs
        while (!predicate() && System.currentTimeMillis() < deadline && running) {
            delay(pollMs)
        }
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
