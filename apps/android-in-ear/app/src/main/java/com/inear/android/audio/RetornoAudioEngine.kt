package com.inear.android.audio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaRecorder
import com.inear.android.net.InEarRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
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
    val rttMs: Double? = null,
    val jitterMs: Double? = null,
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
    private var statsJob: Job? = null
    private var audioDeviceModule: JavaAudioDeviceModule? = null
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
        statsJob?.cancel()
        statsJob = null
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
                buildRtcConfig(retornoLatencyProfile),
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
                    mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "false"))
                    mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "false"))
                    mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "false"))
                    mandatory.add(MediaConstraints.KeyValuePair("googHighpassFilter", "false"))
                },
            )
        setLocalDescriptionBlocking(pc, offer)
        iceGatheringDone.await(1200, TimeUnit.MILLISECONDS)
        val localSdp = pc.localDescription?.description ?: offer.description
        val answer = repository.createWebRtcAnswer(apiBase, token, localSdp, retornoLatencyProfile)
        if (!running) return
        if (answer.sdp.isBlank()) {
            error("Servidor WebRTC respondeu SDP vazia")
        }
        setRemoteDescriptionBlocking(
            pc,
            SessionDescription(SessionDescription.Type.ANSWER, answer.sdp),
        )
        startRtcStatsPolling(pc)
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
                rttMs = current.rttMs,
                jitterMs = current.jitterMs,
            )
        }
    }

    private fun targetLatencyMs(latency: String): Int =
        when (latency) {
            "provocal" -> 18
            "pro" -> 24
            "low" -> 80
            "wifi24" -> 180
            "mid200" -> 200
            else -> 120
        }

    private fun configureAudioRouteForRetorno() {
        if (previousAudioMode == null) previousAudioMode = audioManager.mode
        if (previousSpeakerphone == null) previousSpeakerphone = audioManager.isSpeakerphoneOn
        if (previousMicMute == null) previousMicMute = audioManager.isMicrophoneMute
        val hasExternalOutput = hasExternalAudioOutput()
        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = !hasExternalOutput
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = false }
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
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = false }
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

    private fun hasExternalAudioOutput(): Boolean {
        val devices = runCatching { audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS) }.getOrNull()
            ?: return false
        return devices.any { device ->
            when (device.type) {
                AudioDeviceInfo.TYPE_WIRED_HEADSET,
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                AudioDeviceInfo.TYPE_USB_HEADSET,
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                AudioDeviceInfo.TYPE_USB_DEVICE,
                AudioDeviceInfo.TYPE_USB_ACCESSORY,
                -> true

                else -> false
            }
        }
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
            audioDeviceModule?.release()
            audioDeviceModule =
                JavaAudioDeviceModule
                    .builder(appContext)
                    .setAudioSource(MediaRecorder.AudioSource.UNPROCESSED)
                    .setUseHardwareAcousticEchoCanceler(false)
                    .setUseHardwareNoiseSuppressor(false)
                    .createAudioDeviceModule()
            val created =
                PeerConnectionFactory.builder()
                    .setAudioDeviceModule(audioDeviceModule)
                    .createPeerConnectionFactory()
            peerConnectionFactory = created
            return created
        }
    }

    private fun buildRtcConfig(latency: String): PeerConnection.RTCConfiguration {
        val cfg = PeerConnection.RTCConfiguration(emptyList())
        cfg.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        cfg.bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
        cfg.rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
        cfg.tcpCandidatePolicy = PeerConnection.TcpCandidatePolicy.DISABLED
        cfg.continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_ONCE
        cfg.audioJitterBufferFastAccelerate = true
        cfg.audioJitterBufferMaxPackets = maxJitterPacketsForLatency(latency)
        return cfg
    }

    private fun maxJitterPacketsForLatency(latency: String): Int =
        when (latency) {
            "provocal" -> 3
            "pro" -> 4
            "low" -> 5
            "wifi24" -> 12
            "mid200" -> 14
            else -> 8
        }

    private fun tuneAudioSdpForLatency(sdp: String, latency: String): String {
        if (sdp.isBlank()) return sdp
        val desiredPtime =
            when (latency) {
                "provocal" -> 3
                "pro" -> 5
                "low" -> 10
                "wifi24" -> 20
                "mid200" -> 20
                else -> 10
            }
        val lines = sdp.replace("\r\n", "\n").split('\n').toMutableList()
        val opusPayload = lines.firstNotNullOfOrNull { line ->
            Regex("""^a=rtpmap:(\d+)\s+opus/48000/2$""", RegexOption.IGNORE_CASE)
                .find(line.trim())
                ?.groupValues
                ?.getOrNull(1)
        } ?: return sdp
        val mediaIndex = lines.indexOfFirst { it.startsWith("m=audio ") }
        if (mediaIndex == -1) return sdp
        val mediaEndExclusive =
            lines
                .subList(mediaIndex + 1, lines.size)
                .indexOfFirst { it.startsWith("m=") }
                .let { nextMediaOffset ->
                    if (nextMediaOffset == -1) lines.size else mediaIndex + 1 + nextMediaOffset
                }
        val section = lines.subList(mediaIndex, mediaEndExclusive).toMutableList()
        val fmtpIndex = section.indexOfFirst { it.startsWith("a=fmtp:$opusPayload ") }
        val tunedFmtp = buildOpusFmtpLine(opusPayload, section.getOrNull(fmtpIndex), desiredPtime, latency)
        if (fmtpIndex >= 0) {
            section[fmtpIndex] = tunedFmtp
        } else {
            section.add(tunedFmtp)
        }
        upsertSdpLine(section, "a=ptime:", "a=ptime:$desiredPtime")
        upsertSdpLine(section, "a=maxptime:", "a=maxptime:$desiredPtime")
        lines.subList(mediaIndex, mediaEndExclusive).clear()
        lines.addAll(mediaIndex, section)
        return lines.joinToString("\r\n").trimEnd() + "\r\n"
    }

    private fun buildOpusFmtpLine(
        opusPayload: String,
        currentLine: String?,
        desiredPtime: Int,
        latency: String,
    ): String {
        val params = linkedMapOf<String, String>()
        currentLine
            ?.substringAfter(' ', "")
            ?.split(';')
            ?.map { it.trim() }
            ?.filter { it.contains('=') }
            ?.forEach { kv ->
                val parts = kv.split('=', limit = 2)
                params[parts[0].trim()] = parts[1].trim()
            }
        params["minptime"] = desiredPtime.toString()
        val aggressive = latency == "pro" || latency == "provocal"
        params["stereo"] = "1"
        params["sprop-stereo"] = "1"
        params["maxplaybackrate"] = SAMPLE_RATE.toString()
        params["useinbandfec"] = if (aggressive) "0" else "1"
        params["usedtx"] = "0"
        params["cbr"] = if (aggressive) "0" else params["cbr"] ?: "0"
        params["maxaveragebitrate"] =
            when (latency) {
                "provocal" -> "128000"
                "pro" -> "160000"
                else -> params["maxaveragebitrate"] ?: "128000"
            }
        params["x-google-min-bitrate"] =
            when (latency) {
                "provocal" -> "96"
                "pro" -> "128"
                else -> "96"
            }
        params["x-google-start-bitrate"] =
            when (latency) {
                "provocal" -> "128"
                "pro" -> "160"
                else -> "128"
            }
        params["x-google-max-bitrate"] =
            when (latency) {
                "provocal" -> "160"
                "pro" -> "192"
                else -> "160"
            }
        return "a=fmtp:$opusPayload " + params.entries.joinToString(";") { "${it.key}=${it.value}" }
    }

    private fun upsertSdpLine(lines: MutableList<String>, prefix: String, replacement: String) {
        val idx = lines.indexOfFirst { it.startsWith(prefix) }
        if (idx >= 0) lines[idx] = replacement else lines.add(replacement)
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

    private fun startRtcStatsPolling(pc: PeerConnection) {
        statsJob?.cancel()
        statsJob =
            scope.launch(Dispatchers.IO) {
                while (running && peerConnection === pc) {
                    try {
                        pc.getStats { report ->
                            var rttMs: Double? = null
                            var jitterMs: Double? = null
                            for (stat in report.statsMap.values) {
                                if (stat.type == "candidate-pair") {
                                    val nominated = stat.members["nominated"] as? Boolean
                                    val state = stat.members["state"] as? String
                                    val rtt = stat.members["currentRoundTripTime"] as? Double
                                    if (nominated == true && state == "succeeded" && rtt != null) {
                                        rttMs = rtt * 1000.0
                                    }
                                } else if (stat.type == "inbound-rtp") {
                                    val kind = stat.members["kind"] as? String
                                    val jitter = stat.members["jitter"] as? Double
                                    if (kind == "audio" && jitter != null) {
                                        jitterMs = jitter * 1000.0
                                    }
                                }
                            }
                            _stats.update { current ->
                                current.copy(
                                    rttMs = rttMs ?: current.rttMs,
                                    jitterMs = jitterMs ?: current.jitterMs,
                                )
                            }
                        }
                    } catch (_: Exception) {
                    }
                    delay(1000)
                }
            }
    }
}
