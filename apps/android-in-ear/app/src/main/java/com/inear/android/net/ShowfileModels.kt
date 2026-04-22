package com.inear.android.net

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

val apiJson = Json {
    ignoreUnknownKeys = true
    isLenient = true
    encodeDefaults = true
}

@Serializable
data class Eq3(
    val lowDb: Double = 0.0,
    val midDb: Double = 0.0,
    val highDb: Double = 0.0,
)

@Serializable
data class ChannelStrip(
    val id: String,
    val name: String,
    val icon: String? = null,
    val color: String? = null,
    val gain: Double = 1.0,
    val pan: Double = 0.0,
    val mute: Boolean = false,
    val eq: Eq3 = Eq3(),
    val lockEq: Boolean = false,
    val captureInputIndex: Int? = null,
    val sourceTap: String? = null,
)

@Serializable
data class GroupBus(
    val id: String,
    val name: String,
    val channelIds: List<String> = emptyList(),
    val gain: Double = 1.0,
    val mute: Boolean = false,
)

@Serializable
data class MusicianScope(
    val channelIds: List<String> = emptyList(),
    val groupIds: List<String> = emptyList(),
)

@Serializable
data class MusicianStrip(
    val id: String,
    val name: String,
    val username: String,
    val role: String = "musician",
    val sendGains: Map<String, Double> = emptyMap(),
    val sendMutes: Map<String, Boolean>? = null,
    val mute: Boolean = false,
    val scope: MusicianScope = MusicianScope(),
    val eqByChannel: Map<String, Eq3>? = null,
)

@Serializable
data class Showfile(
    val version: Int = 1,
    val name: String = "",
    val networkProfile: String = "auto",
    val channels: List<ChannelStrip> = emptyList(),
    val groups: List<GroupBus> = emptyList(),
    val musicians: List<MusicianStrip> = emptyList(),
)

@Serializable
data class LoginResponse(
    val token: String,
    val role: String,
)

@Serializable
data class NetworkQualitySelf(
    val level: String? = null,
    val rttMs: Double? = null,
    val jitterMs: Double? = null,
    val gapsPerMinute: Double? = null,
    val hint: String? = null,
)

@Serializable
data class NetworkQualityResponse(
    val self: NetworkQualitySelf? = null,
)

@Serializable
data class AudioInputLevelsResponse(
    val captureChannelCount: Int = 0,
    val updatedAt: Long = 0,
    val receiving: Boolean = false,
    val levelsByIndex: Map<String, Double> = emptyMap(),
)

@Serializable
data class SessionInfoResponse(
    val pcAudioCaptureConfigured: Boolean = false,
    val pcAudioCaptureReceiving: Boolean = false,
    val audioCaptureSource: String? = null,
    val captureDeviceName: String? = null,
    val captureChannelCount: Int = 0,
    val captureLastError: String? = null,
    val captureLastGoodMsAgo: Long? = null,
)

@Serializable
data class AudioDebugResponse(
    val configured: Boolean = false,
    val receiving: Boolean = false,
    val captureSource: String? = null,
    val captureMode: String? = null,
    val captureDeviceName: String? = null,
    val captureDeviceIndex: Int? = null,
    val ffmpegPath: String? = null,
    val captureChildRunning: Boolean = false,
    val captureChannelCount: Int = 0,
    val captureUnderruns: Int = 0,
    val captureBufferedBytes: Int = 0,
    val captureLastGoodMsAgo: Long? = null,
    val captureLastChunkMsAgo: Long? = null,
    val captureLastChunkBytes: Int = 0,
    val captureTotalBytes: Long = 0,
    val captureLastError: String? = null,
    val captureStderrTail: List<String> = emptyList(),
    val udpTargetCount: Int = 0,
    val wsClientCount: Int = 0,
    val webrtcSessionCount: Int = 0,
    val lastUdpSendMsAgo: Long? = null,
    val lastUdpSendMusicianId: String? = null,
    val lastWsSendMsAgo: Long? = null,
    val lastWsSendMusicianId: String? = null,
)

@Serializable
data class WebRtcAnswerResponse(
    val ok: Boolean = false,
    val sessionId: String? = null,
    val type: String = "answer",
    val sdp: String = "",
)
