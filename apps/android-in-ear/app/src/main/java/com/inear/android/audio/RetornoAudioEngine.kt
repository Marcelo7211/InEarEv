package com.inear.android.audio

import android.content.Context
import android.media.AudioManager
import com.inear.android.net.InEarRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.webrtc.AudioTrack
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

private const val SAMPLE_RATE = 48_000

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
 * Retorno Android agora é WebRTC-only. O servidor expõe `/api/webrtc/offer` com áudio Opus
 * recebido via `RTCAudioSource`; o cliente cria uma sessão `recvonly` e deixa o WebRTC gerir
 * jitter buffer, PLC e playout nativo.
 */
class RetornoAudioEngine(
    private val appContext: Context,
    private val scope: CoroutineScope,
    private val repository: InEarRepository = InEarRepository(),
) {
    private val _stats = MutableStateFlow(RetornoStats())
    val stats: StateFlow<RetornoStats> = _stats.asStateFlow()

    private val audioManager =
        appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var job: Job? = null
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var remoteAudioTrack: AudioTrack? = null

    @Volatile
    private var running = false

    private var retornoLatencyProfile: String = "stable"
    private var masterGain: Float = 1f
    private var previousAudioMode: Int? = null
    private var previousSpeakerphone: Boolean? = null
    private var previousMicMute: Boolean? = null

    fun start(apiBase: String, token: String, latency: String) {
        job?.cancel()
        job = scope.launch(Dispatchers.IO) {
            stopInternal()
            retornoLatencyProfile = latency
            running = true
            _stats.value =
                RetornoStats(
                    transport = "starting",
                    connected = false,
                    playing = false,
                    estimatedLatencyMs = targetLatencyMs(latency),
                )
            try {
                connectWebRtcOnly(apiBase, token)
            } catch (e: Exception) {
                stopPeerConnection()
                restoreAudioRoute()
                _stats.value =
                    RetornoStats(
                        transport = "error",
                        connected = false,
                        playing = false,
                        lastError = e.message,
                        estimatedLatencyMs = targetLatencyMs(latency),
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
        stopPeerConnection()
        restoreAudioRoute()
        _stats.value = RetornoStats()
    }

    private fun stopPeerConnection() {
        try {
            remoteAudioTrack?.setEnabled(false)
        } catch (_: Exception) {
        }
        remoteAudioTrack = null
        try {
            peerConnection?.close()
        } catch (_: Exception) {
        }
        peerConnection = null
    }

    private suspend fun connectWebRtcOnly(apiBase: String, token: String) {
        configureAudioRouteForRetorno()
        val iceGatheringDone = CountDownLatch(1)
        val factory = ensurePeerConnectionFactory()
        val pc =
            factory.createPeerConnection(
                PeerConnection.RTCConfiguration(emptyList()),
                createPeerConnectionObserver(iceGatheringDone),
            ) ?: error("Falha ao criar PeerConnection WebRTC")
        peerConnection = pc
        pc.addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )

        val offer =
            createOfferBlocking(
                pc,
                MediaConstraints().apply {
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"))
                    mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
                },
            )
        setLocalDescriptionBlocking(pc, offer)
        iceGatheringDone.await(1200, TimeUnit.MILLISECONDS)
        val localSdp = pc.localDescription?.description ?: offer.description
        val answer = repository.createWebRtcAnswer(apiBase, token, localSdp)
        if (!running) return
        setRemoteDescriptionBlocking(
            pc,
            SessionDescription(SessionDescription.Type.ANSWER, answer.sdp),
        )
        updateStats(
            transport = "webrtc",
            connected = false,
            playing = false,
            clearError = true,
        )
    }

    private fun createPeerConnectionObserver(iceGatheringDone: CountDownLatch): PeerConnection.Observer =
        object : PeerConnection.Observer {
            override fun onSignalingChange(newState: PeerConnection.SignalingState?) = Unit

            override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
                if (!running) return
                when (newState) {
                    PeerConnection.IceConnectionState.CONNECTED,
                    PeerConnection.IceConnectionState.COMPLETED,
                    ->
                        updateStats(
                            transport = "webrtc",
                            connected = true,
                            clearError = true,
                        )

                    PeerConnection.IceConnectionState.DISCONNECTED,
                    PeerConnection.IceConnectionState.CLOSED,
                    ->
                        updateStats(
                            transport = "webrtc",
                            connected = false,
                            playing = false,
                        )

                    PeerConnection.IceConnectionState.FAILED ->
                        updateStats(
                            transport = "error",
                            connected = false,
                            playing = false,
                            lastError = "WebRTC ICE falhou",
                        )

                    else -> Unit
                }
            }

            override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState?) =
                Unit

            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) {
                if (!running) return
                when (newState) {
                    PeerConnection.PeerConnectionState.CONNECTED ->
                        updateStats(
                            transport = "webrtc",
                            connected = true,
                            clearError = true,
                        )

                    PeerConnection.PeerConnectionState.DISCONNECTED,
                    PeerConnection.PeerConnectionState.CLOSED,
                    ->
                        updateStats(
                            transport = "webrtc",
                            connected = false,
                            playing = false,
                        )

                    PeerConnection.PeerConnectionState.FAILED ->
                        updateStats(
                            transport = "error",
                            connected = false,
                            playing = false,
                            lastError = "WebRTC desligou por falha",
                        )

                    else -> Unit
                }
            }

            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit

            override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {
                if (newState == PeerConnection.IceGatheringState.COMPLETE) {
                    iceGatheringDone.countDown()
                }
            }

            override fun onIceCandidate(candidate: org.webrtc.IceCandidate?) = Unit

            override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>?) = Unit

            override fun onSelectedCandidatePairChanged(event: org.webrtc.CandidatePairChangeEvent?) =
                Unit

            override fun onAddStream(stream: MediaStream?) {
                val remoteTrack = stream?.audioTracks?.firstOrNull() ?: return
                attachRemoteAudioTrack(remoteTrack)
            }

            override fun onRemoveStream(stream: MediaStream?) = Unit

            override fun onDataChannel(dataChannel: org.webrtc.DataChannel?) = Unit

            override fun onRenegotiationNeeded() = Unit

            override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {
                val track = receiver?.track()
                if (track is AudioTrack) attachRemoteAudioTrack(track)
            }

            override fun onTrack(transceiver: RtpTransceiver?) {
                val track = transceiver?.receiver?.track()
                if (track is AudioTrack) attachRemoteAudioTrack(track)
            }
        }

    private fun attachRemoteAudioTrack(track: AudioTrack) {
        if (!running) return
        remoteAudioTrack = track
        try {
            track.setEnabled(true)
            track.setVolume(masterGain.toDouble())
        } catch (_: Exception) {
        }
        updateStats(
            transport = "webrtc",
            connected = true,
            playing = true,
            clearError = true,
        )
    }

    private fun updateStats(
        transport: String? = null,
        connected: Boolean? = null,
        playing: Boolean? = null,
        lastError: String? = null,
        clearError: Boolean = false,
    ) {
        _stats.update { current ->
            current.copy(
                transport = transport ?: current.transport,
                connected = connected ?: current.connected,
                playing = playing ?: current.playing,
                lastError =
                    when {
                        clearError -> null
                        lastError != null -> lastError
                        else -> current.lastError
                    },
                estimatedLatencyMs = targetLatencyMs(retornoLatencyProfile),
                queuedFrames = 0,
                queuedAudioMs = 0,
                halQueuedMs = 0,
            )
        }
    }

    private fun targetLatencyMs(latency: String): Int =
        when (latency) {
            "pro" -> 90
            "low" -> 130
            "wifi24" -> 180
            "mid200" -> 200
            else -> 220
        }

    private fun configureAudioRouteForRetorno() {
        if (previousAudioMode == null) previousAudioMode = audioManager.mode
        if (previousSpeakerphone == null) previousSpeakerphone = audioManager.isSpeakerphoneOn
        if (previousMicMute == null) previousMicMute = audioManager.isMicrophoneMute
        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = false
            audioManager.isMicrophoneMute = false
        } catch (_: Exception) {
        }
    }

    private fun restoreAudioRoute() {
        try {
            previousAudioMode?.let { audioManager.mode = it }
        } catch (_: Exception) {
        }
        try {
            previousSpeakerphone?.let { audioManager.isSpeakerphoneOn = it }
        } catch (_: Exception) {
        }
        try {
            previousMicMute?.let { audioManager.isMicrophoneMute = it }
        } catch (_: Exception) {
        }
        previousAudioMode = null
        previousSpeakerphone = null
        previousMicMute = null
    }

    private fun ensurePeerConnectionFactory(): PeerConnectionFactory {
        peerConnectionFactory?.let { return it }
        synchronized(this) {
            peerConnectionFactory?.let { return it }
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(appContext)
                    .setEnableInternalTracer(false)
                    .createInitializationOptions(),
            )
            val audioDeviceModule = JavaAudioDeviceModule.builder(appContext).createAudioDeviceModule()
            val created =
                PeerConnectionFactory.builder()
                    .setAudioDeviceModule(audioDeviceModule)
                    .createPeerConnectionFactory()
            audioDeviceModule.release()
            peerConnectionFactory = created
            return created
        }
    }

    private fun createOfferBlocking(
        pc: PeerConnection,
        constraints: MediaConstraints,
    ): SessionDescription {
        val latch = CountDownLatch(1)
        val result = AtomicReference<SessionDescription?>()
        val error = AtomicReference<String?>()
        pc.createOffer(
            object : SdpObserver {
                override fun onCreateSuccess(desc: SessionDescription?) {
                    result.set(desc)
                    latch.countDown()
                }

                override fun onSetSuccess() = Unit

                override fun onCreateFailure(message: String?) {
                    error.set(message ?: "createOffer falhou")
                    latch.countDown()
                }

                override fun onSetFailure(message: String?) = Unit
            },
            constraints,
        )
        if (!latch.await(8, TimeUnit.SECONDS)) error("Timeout ao criar oferta WebRTC")
        error.get()?.let { error(it) }
        return result.get() ?: error("Oferta WebRTC vazia")
    }

    private fun setLocalDescriptionBlocking(pc: PeerConnection, desc: SessionDescription) {
        setDescriptionBlocking(desc) { observer -> pc.setLocalDescription(observer, desc) }
    }

    private fun setRemoteDescriptionBlocking(pc: PeerConnection, desc: SessionDescription) {
        setDescriptionBlocking(desc) { observer -> pc.setRemoteDescription(observer, desc) }
    }

    private fun setDescriptionBlocking(
        desc: SessionDescription,
        setter: (SdpObserver) -> Unit,
    ) {
        val latch = CountDownLatch(1)
        val error = AtomicReference<String?>()
        setter(
            object : SdpObserver {
                override fun onCreateSuccess(desc: SessionDescription?) = Unit

                override fun onSetSuccess() {
                    latch.countDown()
                }

                override fun onCreateFailure(message: String?) = Unit

                override fun onSetFailure(message: String?) {
                    error.set(message ?: "setDescription falhou")
                    latch.countDown()
                }
            },
        )
        if (!latch.await(8, TimeUnit.SECONDS)) {
            error("Timeout ao aplicar SDP ${desc.type.canonicalForm()}")
        }
        error.get()?.let { error(it) }
    }

    fun setMasterGain(g: Float) {
        masterGain = g
        try {
            remoteAudioTrack?.setVolume(g.toDouble())
        } catch (_: Exception) {
        }
    }
}
