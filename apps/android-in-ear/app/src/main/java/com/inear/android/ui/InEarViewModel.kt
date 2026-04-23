package com.inear.android.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.inear.android.audio.RetornoAudioEngine
import com.inear.android.data.SessionDataStore
import com.inear.android.net.InEarRepository
import com.inear.android.net.LoginResponse
import com.inear.android.net.MusicianStrip
import com.inear.android.net.Showfile
import com.inear.android.net.NetworkQualityResponse
import com.inear.android.net.AudioInputLevelsResponse
import com.inear.android.net.AudioDebugResponse
import com.inear.android.net.parseJwtSub
import com.inear.android.net.retornoMixerChannelOrder
import com.inear.android.net.SessionInfoResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class UiSession(
    val apiBase: String = "",
    val token: String = "",
    val role: String = "",
)

class InEarViewModel(application: Application) : AndroidViewModel(application) {
    private val sessionStore = SessionDataStore(application)
    val repository = InEarRepository()
    val audioEngine = RetornoAudioEngine(application.applicationContext, viewModelScope, repository)

    private val _session = MutableStateFlow(UiSession())
    val session: StateFlow<UiSession> = _session.asStateFlow()

    private val _showfile = MutableStateFlow<Showfile?>(null)
    val showfile: StateFlow<Showfile?> = _showfile.asStateFlow()

    private val _network = MutableStateFlow<NetworkQualityResponse?>(null)
    val network: StateFlow<NetworkQualityResponse?> = _network.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _audioInputLevels = MutableStateFlow<AudioInputLevelsResponse?>(null)
    val audioInputLevels: StateFlow<AudioInputLevelsResponse?> = _audioInputLevels.asStateFlow()

    private val _sessionInfo = MutableStateFlow(SessionInfoResponse())
    val sessionInfo: StateFlow<SessionInfoResponse> = _sessionInfo.asStateFlow()

    private val _audioDebug = MutableStateFlow(AudioDebugResponse())
    val audioDebug: StateFlow<AudioDebugResponse> = _audioDebug.asStateFlow()

    val latencyProfile = MutableStateFlow("pro")

    init {
        viewModelScope.launch {
            val (base, token, role) = sessionStore.session.first()
            if (base != null && token != null && role != null) {
                _session.value = UiSession(base, token, role)
                refreshShowfile()
            }
        }
    }

    fun clearError() {
        _error.value = null
    }

    fun login(apiBase: String, username: String, password: String) {
        viewModelScope.launch {
            _error.value = null
            try {
                val r: LoginResponse = repository.login(apiBase, username, password)
                sessionStore.saveSession(apiBase, r.token, r.role)
                _session.value = UiSession(apiBase.trim().trimEnd('/'), r.token, r.role)
                refreshShowfile()
            } catch (e: Exception) {
                _error.value = e.message ?: "login failed"
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            audioEngine.stop()
            sessionStore.clear()
            _session.value = UiSession()
            _showfile.value = null
        }
    }

    fun refreshShowfile() {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                _showfile.value = repository.getShowfile(s.apiBase, s.token)
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun selfMusician(): MusicianStrip? {
        val sf = _showfile.value ?: return null
        val sub = parseJwtSub(_session.value.token) ?: return null
        return sf.musicians.find { it.username == sub }
    }

    fun channelOrderForSelf(): List<String> {
        val sf = _showfile.value ?: return emptyList()
        val m = selfMusician() ?: return emptyList()
        return retornoMixerChannelOrder(sf, m)
    }

    fun patchMusicianMerge(strip: MusicianStrip) {
        val sf = _showfile.value ?: return
        _showfile.value = sf.copy(
            musicians = sf.musicians.map { if (it.id == strip.id) strip else it },
        )
    }

    fun patchSendGain(musicianId: String, sourceId: String, value: Float) {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                val g = value.coerceIn(0f, 4f).toDouble()
                val body = buildJsonObject {
                    put("sendGains", buildJsonObject { put(sourceId, g) })
                }
                val next = repository.patchMusician(s.apiBase, s.token, musicianId, body)
                patchMusicianMerge(next)
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun patchSendMute(musicianId: String, sourceId: String, muted: Boolean) {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                val body = buildJsonObject {
                    put("sendMutes", buildJsonObject { put(sourceId, muted) })
                }
                val next = repository.patchMusician(s.apiBase, s.token, musicianId, body)
                patchMusicianMerge(next)
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun patchEqBand(musicianId: String, channelId: String, low: Double, mid: Double, high: Double) {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                val body = buildJsonObject {
                    put(
                        "eqByChannel",
                        buildJsonObject {
                            put(
                                channelId,
                                buildJsonObject {
                                    put("lowDb", low)
                                    put("midDb", mid)
                                    put("highDb", high)
                                },
                            )
                        },
                    )
                }
                val next = repository.patchMusician(s.apiBase, s.token, musicianId, body)
                patchMusicianMerge(next)
            } catch (e: Exception) {
                _error.value = e.message
            }
        }
    }

    fun startRetorno() {
        val s = _session.value
        val m = selfMusician() ?: return
        if (s.token.isEmpty()) return
        val picked = latencyProfile.value
        val net = _showfile.value?.networkProfile.orEmpty()
        /* Em 2,4 GHz o perfil "pro" é demasiado apertado para o jitter típico — usa wifi24. */
        val effective =
            if (net == "wifi_2_4" && picked == "pro") "wifi24" else picked
        audioEngine.start(s.apiBase, s.token, effective)
    }

    fun stopRetorno() {
        audioEngine.stop()
    }

    fun setMasterGain(v: Float) {
        audioEngine.setMasterGain(v.coerceIn(0f, 4f))
    }

    fun refreshNetworkQuality() {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                _network.value = repository.getNetworkQuality(s.apiBase, s.token)
            } catch (_: Exception) {
            }
        }
    }

    fun refreshAudioInputLevels() {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                _audioInputLevels.value = repository.getAudioInputLevels(s.apiBase, s.token)
            } catch (_: Exception) {
            }
        }
    }

    fun refreshAudioDebug() {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                _sessionInfo.value = repository.getSessionInfo(s.apiBase, s.token)
            } catch (_: Exception) {
            }
            try {
                _audioDebug.value = repository.getAudioDebug(s.apiBase, s.token)
            } catch (_: Exception) {
            }
        }
    }

    fun postTelemetry(rttMs: Double?, statsSnapshot: com.inear.android.audio.RetornoStats) {
        val s = _session.value
        if (s.token.isEmpty()) return
        viewModelScope.launch {
            try {
                repository.postTelemetry(
                    s.apiBase,
                    s.token,
                    rttMs,
                    statsSnapshot.sequenceGaps,
                    statsSnapshot.estimatedLatencyMs,
                    statsSnapshot.queuedFrames,
                    statsSnapshot.queuedAudioMs + statsSnapshot.halQueuedMs,
                    latencyProfile.value,
                )
            } catch (_: Exception) {
            }
        }
    }

    override fun onCleared() {
        audioEngine.stop()
        super.onCleared()
    }
}
