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
data class WebRtcAnswerResponse(
    val ok: Boolean = false,
    val sessionId: String? = null,
    val type: String = "answer",
    val sdp: String = "",
)
