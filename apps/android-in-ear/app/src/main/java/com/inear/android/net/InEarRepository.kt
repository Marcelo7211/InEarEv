package com.inear.android.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class InEarRepository(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build(),
) {
    /** Sinalização WebRTC: falha rápido para não bloquear a corrida UDP/WS. */
    private val webrtcSignalingClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(800, TimeUnit.MILLISECONDS)
        .readTimeout(5, TimeUnit.SECONDS)
        .writeTimeout(3, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    suspend fun login(apiBase: String, username: String, password: String): LoginResponse {
        val base = apiBase.trim().trimEnd('/')
        val body = apiJson.encodeToString(
            buildJsonObject {
                put("username", username)
                put("password", password)
            },
        ).toRequestBody(jsonMedia)
        val req = Request.Builder()
            .url("$base/api/auth/login")
            .post(body)
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    error("login ${resp.code}: $text")
                }
                apiJson.decodeFromString<LoginResponse>(text)
            }
        }
    }

    suspend fun getShowfile(apiBase: String, bearer: String): Showfile {
        val base = apiBase.trim().trimEnd('/')
        val req = Request.Builder()
            .url("$base/api/showfile")
            .header("Authorization", "Bearer $bearer")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("showfile ${resp.code}: $text")
                apiJson.decodeFromString<Showfile>(text)
            }
        }
    }

    suspend fun patchMusician(
        apiBase: String,
        bearer: String,
        musicianId: String,
        patch: JsonObject,
    ): MusicianStrip {
        val base = apiBase.trim().trimEnd('/')
        val body = apiJson.encodeToString(JsonElement.serializer(), patch).toRequestBody(jsonMedia)
        val req = Request.Builder()
            .url("$base/api/showfile/musician/$musicianId")
            .header("Authorization", "Bearer $bearer")
            .patch(body)
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("patch musician ${resp.code}: $text")
                apiJson.decodeFromString<MusicianStrip>(text)
            }
        }
    }

    suspend fun postTelemetry(
        apiBase: String,
        bearer: String,
        rttMs: Double?,
        sequenceGaps: Int?,
        estimatedE2eMs: Int?,
        queueDepth: Int?,
        aheadMs: Int?,
        latencyProfile: String?,
    ) {
        val base = apiBase.trim().trimEnd('/')
        val obj = buildJsonObject {
            if (rttMs != null) put("rttMs", rttMs)
            if (sequenceGaps != null) put("sequenceGaps", sequenceGaps)
            if (estimatedE2eMs != null) put("estimatedE2eMs", estimatedE2eMs)
            if (queueDepth != null) put("queueDepth", queueDepth)
            if (aheadMs != null) put("aheadMs", aheadMs)
            if (!latencyProfile.isNullOrBlank()) put("latencyProfile", latencyProfile)
        }
        val body = apiJson.encodeToString(obj).toRequestBody(jsonMedia)
        val req = Request.Builder()
            .url("$base/api/telemetry")
            .header("Authorization", "Bearer $bearer")
            .post(body)
            .build()
        withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    resp.body?.close()
                }
            }
        }
    }

    suspend fun getNetworkQuality(apiBase: String, bearer: String): NetworkQualityResponse {
        val base = apiBase.trim().trimEnd('/')
        val req = Request.Builder()
            .url("$base/api/network-quality")
            .header("Authorization", "Bearer $bearer")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("network-quality ${resp.code}: $text")
                apiJson.decodeFromString<NetworkQualityResponse>(text)
            }
        }
    }

    suspend fun getAudioInputLevels(apiBase: String, bearer: String): AudioInputLevelsResponse {
        val base = apiBase.trim().trimEnd('/')
        val req = Request.Builder()
            .url("$base/api/audio-input-levels")
            .header("Authorization", "Bearer $bearer")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("audio-input-levels ${resp.code}: $text")
                apiJson.decodeFromString<AudioInputLevelsResponse>(text)
            }
        }
    }

    suspend fun getSessionInfo(apiBase: String, bearer: String): SessionInfoResponse {
        val base = apiBase.trim().trimEnd('/')
        val req = Request.Builder()
            .url("$base/api/session")
            .header("Authorization", "Bearer $bearer")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("session ${resp.code}: $text")
                apiJson.decodeFromString<SessionInfoResponse>(text)
            }
        }
    }

    suspend fun getAudioDebug(apiBase: String, bearer: String): AudioDebugResponse {
        val base = apiBase.trim().trimEnd('/')
        val req = Request.Builder()
            .url("$base/api/audio-debug")
            .header("Authorization", "Bearer $bearer")
            .get()
            .build()
        return withContext(Dispatchers.IO) {
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("audio-debug ${resp.code}: $text")
                apiJson.decodeFromString<AudioDebugResponse>(text)
            }
        }
    }

    suspend fun createWebRtcAnswer(
        apiBase: String,
        bearer: String,
        offerSdp: String,
        latencyProfile: String? = null,
    ): WebRtcAnswerResponse {
        val base = apiBase.trim().trimEnd('/')
        val body = apiJson.encodeToString(
            buildJsonObject {
                put("sdp", offerSdp)
                if (!latencyProfile.isNullOrBlank()) put("latencyProfile", latencyProfile)
            },
        ).toRequestBody(jsonMedia)
        val req = Request.Builder()
            .url("$base/api/webrtc/offer")
            .header("Authorization", "Bearer $bearer")
            .post(body)
            .build()
        return withContext(Dispatchers.IO) {
            webrtcSignalingClient.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) error("webrtc offer ${resp.code}: $text")
                apiJson.decodeFromString<WebRtcAnswerResponse>(text)
            }
        }
    }
}
