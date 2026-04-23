package com.inear.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.paddingFromBaseline
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.inear.android.net.ChannelStrip
import com.inear.android.net.MusicianStrip
import com.inear.android.net.Showfile
import kotlin.math.max
import kotlin.math.ln
import kotlinx.coroutines.delay

private val PanelBg = Color(0xFF10141c)
private val PanelBorder = Color(0xFF334861)
private val CardBg = Brush.verticalGradient(listOf(Color(0xFF1a212d), Color(0xFF11161f)))
private val MeterBg = Brush.verticalGradient(listOf(Color(0xFF0f141c), Color(0xFF0b1016)))
private val MuteOffBg = Brush.verticalGradient(listOf(Color(0xFF141c28), Color(0xFF141c28)))
private val MuteOnBg = Brush.verticalGradient(listOf(Color(0xFF2a1a1f), Color(0xFF141c28)))
private val DeskBtnBg = Brush.verticalGradient(listOf(Color(0xFF223047), Color(0xFF141c28)))
private val AccentBlue = Color(0xFF58a6ff)
private val ClipLedOff = Color(0xFF3a4554)
private val ClipLedOn = Color(0xFFf85149)
private val VuGrad = Brush.verticalGradient(
    listOf(
        Color(0xFFf40000),
        Color(0xFFec9500),
        Color(0xFFbade09),
        Color(0xFF429321),
    ),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MusicianHomeScreen(vm: InEarViewModel) {
    val showfile by vm.showfile.collectAsState()
    val stats by vm.audioEngine.stats.collectAsState()
    val net by vm.network.collectAsState()
    val inputLevels by vm.audioInputLevels.collectAsState()
    val sessionInfo by vm.sessionInfo.collectAsState()
    val audioDebug by vm.audioDebug.collectAsState()
    val lat by vm.latencyProfile.collectAsState()
    var master by remember { mutableFloatStateOf(1f) }
    var playing by remember { mutableStateOf(false) }
    var previousLatencyKey by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(playing) {
        while (true) {
            vm.refreshShowfile()
            delay(if (playing) 280 else 1100)
        }
    }

    LaunchedEffect(playing) {
        while (true) {
            vm.refreshAudioInputLevels()
            delay(if (playing) 120 else 850)
        }
    }

    LaunchedEffect(playing) {
        while (true) {
            vm.refreshAudioDebug()
            delay(if (playing) 1200 else 2800)
        }
    }

    LaunchedEffect(playing) {
        while (true) {
            vm.refreshNetworkQuality()
            delay(if (playing) 1800 else 3200)
        }
    }

    LaunchedEffect(playing) {
        while (playing) {
            delay(5000)
            vm.postTelemetry(null, vm.audioEngine.stats.value)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Retorno") },
                actions = {
                    Box(modifier = Modifier.padding(end = 8.dp)) {
                        DeskPillButton(label = "Sair", active = false, onClick = { vm.logout() })
                    }
                },
            )
        },
    ) { pad ->
        val sf = showfile
        val m = vm.selfMusician()
        if (sf == null || m == null) {
            Column(
                Modifier.fillMaxWidth().padding(pad).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text("Sem showfile ou perfil músico. Confirma login e servidor.")
                Button(onClick = { vm.refreshShowfile() }) { Text("Recarregar") }
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(pad).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            val estimatedLatencyMs = stats.estimatedLatencyMs
            val latencyUserLabel =
                when {
                    !playing || !stats.connected -> "Aguardando"
                    estimatedLatencyMs <= 60 -> "Quase em tempo real"
                    estimatedLatencyMs <= 120 -> "Muito rapido"
                    estimatedLatencyMs <= 220 -> "Bom para palco"
                    estimatedLatencyMs < 1000 -> "Perceptivel, mas ainda usavel"
                    else -> "Atraso alto"
                }
            val transportUserLabel =
                when (stats.transport) {
                    "webrtc" -> "WebRTC Opus"
                    "udp" -> "UDP dedicado"
                    "ws" -> "Fallback WebSocket"
                    "starting" -> "Conectando"
                    "error" -> "Erro"
                    else -> "Parado"
                }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DeskPillButton(
                    label = "Palco (~200 ms)",
                    active = lat == "mid200",
                    onClick = { vm.latencyProfile.value = "mid200" },
                )
                DeskPillButton(
                    label = "Pro (~35 ms)",
                    active = lat == "pro",
                    onClick = { vm.latencyProfile.value = "pro" },
                )
                DeskPillButton(
                    label = "2.4 GHz",
                    active = lat == "wifi24",
                    onClick = { vm.latencyProfile.value = "wifi24" },
                )
                DeskPillButton(label = "Baixa", active = lat == "low", onClick = { vm.latencyProfile.value = "low" })
                DeskPillButton(label = "Estável", active = lat == "stable", onClick = { vm.latencyProfile.value = "stable" })
            }
            LaunchedEffect(lat) {
                val prev = previousLatencyKey
                previousLatencyKey = lat
                if (prev != null && prev != lat && playing) {
                    vm.stopRetorno()
                    delay(60)
                    vm.startRetorno()
                }
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (net?.self?.hint?.isNotBlank() == true) {
                    Text(
                        net?.self?.hint ?: "",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF9aa0a6),
                        modifier = Modifier.weight(1f).padding(end = 8.dp),
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                if (!playing) {
                    DeskPillButton(label = "Iniciar áudio", active = true, onClick = { vm.startRetorno(); playing = true })
                } else {
                    DeskPillButton(label = "Parar", active = false, onClick = { vm.stopRetorno(); playing = false })
                }
            }
            if (stats.lastError != null) {
                Text("Erro: ${stats.lastError}", color = MaterialTheme.colorScheme.error)
            }
            Card(shape = RoundedCornerShape(10.dp)) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(CardBg)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Text(
                        "Status do retorno",
                        style = MaterialTheme.typography.titleSmall,
                        color = Color(0xFFe8eaed),
                    )
                    Text(
                        "Atraso estimado: ${stats.estimatedLatencyMs} ms · $latencyUserLabel",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color(0xFFdbe6f3),
                    )
                    Text(
                        "Transporte: $transportUserLabel · fila app ${stats.queuedAudioMs} ms · fila audio ${stats.halQueuedMs} ms",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF9ab8d8),
                    )
                    Text(
                        if (inputLevels?.receiving == true) {
                            "Sinal do desktop: recebendo audio"
                        } else {
                            "Sinal do desktop: sem audio recebido agora"
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = if (inputLevels?.receiving == true) Color(0xFF81c995) else Color(0xFFf0883e),
                    )
                    Text(
                        buildString {
                            append("Captura PC: ")
                            append(
                                when {
                                    sessionInfo.pcAudioCaptureReceiving -> "ativa"
                                    sessionInfo.pcAudioCaptureConfigured -> "configurada sem PCM"
                                    else -> "nao configurada"
                                },
                            )
                            if (!sessionInfo.captureDeviceName.isNullOrBlank()) {
                                append(" · ")
                                append(sessionInfo.captureDeviceName)
                            }
                        },
                        style = MaterialTheme.typography.labelSmall,
                        color = if (sessionInfo.pcAudioCaptureReceiving) Color(0xFF81c995) else Color(0xFFf0883e),
                    )
                    if (!audioDebug.captureLastError.isNullOrBlank()) {
                        Text(
                            "Ultimo erro Windows: ${audioDebug.captureLastError}",
                            style = MaterialTheme.typography.labelSmall,
                            color = Color(0xFFf85149),
                        )
                    }
                    Text(
                        "Diag: ultimo PCM ${audioDebug.captureLastGoodMsAgo ?: -1} ms · UDP alvo ${audioDebug.udpTargetCount} · WS ${audioDebug.wsClientCount}",
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF8b949e),
                    )
                }
            }
            MasterDeskControl(value = master, onSet = { master = it; vm.setMasterGain(it) })

            Text("Mesa", style = MaterialTheme.typography.titleMedium)
            val boardScroll = rememberScrollState()
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .border(1.dp, PanelBorder, RoundedCornerShape(10.dp))
                    .background(PanelBg, RoundedCornerShape(10.dp))
                    .padding(horizontal = 4.dp, vertical = 6.dp)
                    .horizontalScroll(boardScroll),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                for (gid in m.scope.groupIds) {
                    val g = sf.groups.find { it.id == gid } ?: continue
                    val send = (m.sendGains[gid] ?: 1.0).toFloat()
                    val muted = m.sendMutes?.get(gid) == true
                    MixerStripCard(
                        title = g.name,
                        subtitle = "Grupo · $gid",
                        gain = send,
                        meterTitle = "Send",
                        vuLevel = groupVuLevel(sf, g.id, inputLevels?.levelsByIndex ?: emptyMap()),
                        muted = muted,
                        onToggleMute = { vm.patchSendMute(m.id, gid, !muted) },
                        onGainCommit = { vm.patchSendGain(m.id, gid, it) },
                    )
                }
                for (cid in vm.channelOrderForSelf()) {
                    val ch = sf.channels.find { it.id == cid } ?: continue
                    val send = (m.sendGains[cid] ?: 1.0).toFloat()
                    val muted = m.sendMutes?.get(cid) == true
                    val ear = m.eqByChannel?.get(cid)
                    val low = (ear?.lowDb ?: ch.eq.lowDb).toFloat()
                    val mid = (ear?.midDb ?: ch.eq.midDb).toFloat()
                    val high = (ear?.highDb ?: ch.eq.highDb).toFloat()
                    MixerStripCard(
                        channel = ch,
                        title = ch.name,
                        subtitle = "$cid · send",
                        gain = send,
                        meterTitle = "Send",
                        vuLevel = channelVuLevel(ch, inputLevels?.levelsByIndex ?: emptyMap()),
                        muted = muted,
                        onToggleMute = { vm.patchSendMute(m.id, cid, !muted) },
                        onGainCommit = { vm.patchSendGain(m.id, cid, it) },
                        eq = if (ch.lockEq) null else Triple(low, mid, high),
                        onEqChange = { l, md, h -> vm.patchEqBand(m.id, cid, l.toDouble(), md.toDouble(), h.toDouble()) },
                        eqLocked = ch.lockEq,
                    )
                }
            }
        }
    }
}

@Composable
private fun MixerStripCard(
    channel: ChannelStrip? = null,
    title: String,
    subtitle: String,
    gain: Float,
    meterTitle: String,
    vuLevel: Float,
    muted: Boolean,
    onToggleMute: () -> Unit,
    onGainCommit: (Float) -> Unit,
    eq: Triple<Float, Float, Float>? = null,
    onEqChange: ((Float, Float, Float) -> Unit)? = null,
    eqLocked: Boolean = false,
) {
    Card(
        modifier = Modifier.width(158.dp).fillMaxHeight(),
        shape = RoundedCornerShape(8.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize().background(CardBg).padding(horizontal = 5.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                val accent = channelAccentColor(channel?.id ?: title, channel?.color, channel?.captureInputIndex)
                val badge = channelIconGlyph(channel?.icon)
                Box(
                    modifier = Modifier
                        .size(22.dp)
                        .background(accent, RoundedCornerShape(6.dp))
                        .border(1.dp, accent.copy(alpha = 0.45f), RoundedCornerShape(6.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = badge,
                        color = Color(0xFF07111a),
                        fontWeight = FontWeight.Black,
                        style = MaterialTheme.typography.labelSmall,
                    )
                    if (muted) {
                        Box(
                            modifier = Modifier
                                .fillMaxHeight()
                                .width(2.dp)
                                .background(Color(0xFFf85149))
                                .rotate(-35f),
                        )
                    }
                }
                Column {
                    Text(
                        title,
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFFe8eaed),
                    )
                    Text(
                        subtitle,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF9aa0a6),
                        fontSize = MaterialTheme.typography.labelSmall.fontSize * 0.85f,
                    )
                }
            }
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .border(
                        width = 1.dp,
                        color = if (muted) Color(0xFFf85149) else Color(0xFF3c5068),
                        shape = RoundedCornerShape(999.dp),
                    )
                    .background(if (muted) MuteOnBg else MuteOffBg, RoundedCornerShape(999.dp))
                    .padding(horizontal = 6.dp, vertical = 3.dp)
                    .clickable { onToggleMute() },
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(
                            "MUTE",
                            color = if (muted) Color(0xFFffb4b0) else Color(0xFFdbe6f3),
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .border(
                                1.dp,
                                if (muted) Color(0xFFf85149) else Color(0xFF5f7998),
                                CircleShape,
                            )
                            .background(if (muted) Color(0xFF2b1a22) else Color(0xFF172234), CircleShape)
                            .clickable { onToggleMute() },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            text = if (muted) "🔇" else "🔊",
                            color = if (muted) Color(0xFFf2f6ff) else Color(0xFFbdd6f7),
                            style = MaterialTheme.typography.labelSmall,
                        )
                        Box(
                            modifier = Modifier
                                .size(7.dp)
                                .background(if (muted) Color(0xFFf85149) else Color(0xFF2ea043), CircleShape)
                                .align(Alignment.BottomEnd),
                        )
                    }
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.fillMaxWidth().weight(1f),
            ) {
                DesktopLikeVolumeStrip(
                    gain = gain,
                    vuLevel = vuLevel,
                    meterTitle = meterTitle,
                    rangeMin = 0f,
                    rangeMax = 4f,
                    onCommit = onGainCommit,
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                )
                if (eq != null && onEqChange != null) {
                    EqMiniKnobs(
                        low = eq.first,
                        mid = eq.second,
                        high = eq.third,
                        onChange = onEqChange,
                        modifier = Modifier.width(46.dp).fillMaxHeight(),
                    )
                } else if (eqLocked) {
                    Box(
                        modifier = Modifier.width(46.dp).fillMaxHeight().border(1.dp, Color(0xFF3c5068), RoundedCornerShape(6.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("EQ\nLOCK", style = MaterialTheme.typography.labelSmall, color = Color(0xFF8b949e))
                    }
                }
            }
        }
    }
}

@Composable
private fun EqMiniKnobs(
    low: Float,
    mid: Float,
    high: Float,
    onChange: (Float, Float, Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(4.dp),
        modifier = modifier,
    ) {
        EqSlider("H", high, Modifier.weight(1f)) { v -> onChange(low, mid, v) }
        EqSlider("M", mid, Modifier.weight(1f)) { v -> onChange(low, v, high) }
        EqSlider("L", low, Modifier.weight(1f)) { v -> onChange(v, mid, high) }
    }
}

@Composable
private fun EqSlider(label: String, value: Float, modifier: Modifier = Modifier, onSet: (Float) -> Unit) {
    Column(
        modifier = Modifier
            .then(modifier)
            .fillMaxWidth()
            .border(1.dp, Color(0xFF3c5068), RoundedCornerShape(7.dp))
            .padding(horizontal = 3.dp, vertical = 3.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall)
        Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
            Slider(
                value = value.coerceIn(-12f, 12f),
                onValueChange = { onSet(it) },
                valueRange = -12f..12f,
                modifier = Modifier.width(110.dp).height(20.dp).rotate(-90f),
                colors = SliderDefaults.colors(
                    thumbColor = Color(0xFF9ab6d6),
                    activeTrackColor = Color(0xFF2ea043),
                    inactiveTrackColor = Color(0xFF18222f),
                ),
            )
        }
        Text(
            String.format("%.1f", value),
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            color = Color(0xFF9ab8d8),
        )
    }
}

@Composable
private fun DesktopLikeVolumeStrip(
    gain: Float,
    vuLevel: Float,
    meterTitle: String,
    rangeMin: Float,
    rangeMax: Float,
    onCommit: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    var local by remember(rangeMin, rangeMax) { mutableFloatStateOf(gain.coerceIn(rangeMin, rangeMax)) }
    var dragging by remember { mutableStateOf(false) }
    var clipHoldUntilMs by remember { mutableLongStateOf(0L) }
    var trackHeightPx by remember { mutableStateOf(1f) }
    val latestGain by rememberUpdatedState(gain)
    LaunchedEffect(latestGain, rangeMin, rangeMax, dragging) {
        if (!dragging) {
            local = latestGain.coerceIn(rangeMin, rangeMax)
        }
    }
    LaunchedEffect(vuLevel) {
        if (vuLevel >= 0.98f) {
            clipHoldUntilMs = max(clipHoldUntilMs, System.currentTimeMillis() + 300)
        }
    }
    val clipOn = System.currentTimeMillis() < clipHoldUntilMs
    val meterFill = vuLevel.coerceIn(0f, 1f)
    val faderFill = ((local - rangeMin) / (rangeMax - rangeMin)).coerceIn(0f, 1f)

    Column(
        modifier = modifier
            .border(1.dp, Color(0xFF3f4f66), RoundedCornerShape(6.dp))
            .background(Color(0xFF303030), RoundedCornerShape(6.dp))
            .padding(horizontal = 3.dp, vertical = 5.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                meterTitle,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = Color(0xFFdbe6f3),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("CLIP", style = MaterialTheme.typography.labelSmall, color = Color(0xFF8b949e))
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(if (clipOn) ClipLedOn else ClipLedOff, CircleShape),
                )
            }
        }
        Box(
            modifier = Modifier
                .padding(top = 2.dp)
                .border(1.dp, Color(0xFF2f3f55), RoundedCornerShape(3.dp))
                .background(Color(0xFF202020), RoundedCornerShape(3.dp))
                .padding(horizontal = 4.dp, vertical = 1.dp),
        ) {
            Text("${linearToDb(local)} dB", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = Color(0xFF2af02a))
        }
        Row(
            modifier = Modifier.fillMaxWidth().weight(1f).padding(top = 5.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Box(
                modifier = Modifier
                    .width(21.dp)
                    .fillMaxHeight()
                    .border(1.dp, Color(0xFF2f3f55), RoundedCornerShape(5.dp))
                    .background(MeterBg, RoundedCornerShape(5.dp))
                    .padding(3.dp),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.55f)
                        .fillMaxHeight(meterFill)
                        .background(VuGrad, RoundedCornerShape(3.dp)),
                )
            }
            Column(
                modifier = Modifier.fillMaxHeight(),
                verticalArrangement = Arrangement.SpaceBetween,
                horizontalAlignment = Alignment.End,
            ) {
                listOf("0", "-6", "-12", "-24", "-80").forEach {
                    Text(
                        it,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF808080),
                        fontSize = MaterialTheme.typography.labelSmall.fontSize * 0.8f,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
            Box(
                modifier = Modifier
                    .width(30.dp)
                    .fillMaxHeight()
                    .onSizeChanged { trackHeightPx = it.height.toFloat().coerceAtLeast(1f) }
                    .pointerInput(rangeMin, rangeMax, trackHeightPx) {
                        var dragY = 0f
                        detectVerticalDragGestures(
                            onDragStart = { o ->
                                dragging = true
                                dragY = o.y.coerceIn(0f, trackHeightPx)
                                val pct = 1f - (dragY / trackHeightPx)
                                local = (rangeMin + (rangeMax - rangeMin) * pct).coerceIn(rangeMin, rangeMax)
                            },
                            onVerticalDrag = { _, dragAmount ->
                                dragY = (dragY + dragAmount).coerceIn(0f, trackHeightPx)
                                val pct = 1f - (dragY / trackHeightPx)
                                local = (rangeMin + (rangeMax - rangeMin) * pct).coerceIn(rangeMin, rangeMax)
                            },
                            onDragEnd = {
                                dragging = false
                                onCommit(local)
                            },
                            onDragCancel = { dragging = false },
                        )
                    },
                contentAlignment = Alignment.TopCenter,
            ) {
                Box(
                    modifier = Modifier
                        .width(4.dp)
                        .fillMaxHeight()
                        .background(Color(0xFF121212), RoundedCornerShape(999.dp)),
                )
                val thumbOffsetPx = ((1f - faderFill) * trackHeightPx) - 14f
                val density = LocalDensity.current
                Box(
                    modifier = Modifier
                        .offset(y = with(density) { thumbOffsetPx.toDp() })
                        .size(width = 21.dp, height = 29.dp)
                        .background(
                            brush = Brush.verticalGradient(
                                listOf(Color(0xFFfbfcff), Color(0xFF9ab6d6), Color(0xFF4b627f)),
                            ),
                            shape = RoundedCornerShape(5.dp),
                        )
                        .border(1.dp, Color(0xFF8da7c7), RoundedCornerShape(5.dp)),
                )
            }
        }
    }
}

@Composable
private fun DeskPillButton(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .border(
                1.dp,
                if (active) AccentBlue.copy(alpha = 0.65f) else Color(0xFF3c5068),
                RoundedCornerShape(999.dp),
            )
            .background(DeskBtnBg, RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = if (active) Color(0xFFdbe6f3) else Color(0xFF9aa0a6),
        )
    }
}

@Composable
private fun MasterDeskControl(value: Float, onSet: (Float) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .border(1.dp, Color(0xFF3f4f66), RoundedCornerShape(8.dp))
            .background(Color(0xFF303030), RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("MASTER", color = Color(0xFFdbe6f3), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
            Text(
                "${linearToDb(value)} dB",
                color = Color(0xFF2af02a),
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
            )
        }
        Slider(
            value = value.coerceIn(0f, 4f),
            onValueChange = onSet,
            valueRange = 0f..4f,
            colors = SliderDefaults.colors(
                thumbColor = Color(0xFF9ab6d6),
                activeTrackColor = Color(0xFF2ea043),
                inactiveTrackColor = Color(0xFF18222f),
            ),
        )
    }
}

private fun linearToDb(v: Float): String {
    val clamped = v.coerceIn(0f, 4f)
    if (clamped <= 0.0001f) return "-80.0"
    return (20.0 * ln(clamped.toDouble()) / ln(10.0)).toFloat().let { String.format("%.1f", it) }
}

private fun channelVuLevel(ch: ChannelStrip, levelsByIndex: Map<String, Double>): Float {
    val idx = ch.captureInputIndex ?: return 0f
    return (levelsByIndex[idx.toString()] ?: 0.0).toFloat().coerceIn(0f, 1f)
}

private fun groupVuLevel(sf: Showfile, groupId: String, levelsByIndex: Map<String, Double>): Float {
    val g = sf.groups.find { it.id == groupId } ?: return 0f
    var peak = 0f
    for (cid in g.channelIds) {
        val ch = sf.channels.find { it.id == cid } ?: continue
        val lv = channelVuLevel(ch, levelsByIndex)
        if (lv > peak) peak = lv
    }
    return peak
}

private val DefaultChannelColors = listOf(
    Color(0xFF58a6ff),
    Color(0xFF2ea043),
    Color(0xFFd29922),
    Color(0xFFf85149),
    Color(0xFFa371f7),
    Color(0xFF39c5cf),
    Color(0xFFdb61a2),
    Color(0xFFf0883e),
)

private fun channelIconGlyph(icon: String?): String {
    return when (icon) {
        "kick" -> "🥁"
        "snare" -> "🥁"
        "tom1" -> "🥁"
        "tom2" -> "🥁"
        "floor" -> "🥁"
        "hihat" -> "🥁"
        "crash" -> "🥁"
        "ride" -> "🥁"
        "overhead" -> "🎙"
        "bass" -> "🎸"
        "guitar" -> "🎸"
        "keys" -> "🎹"
        "vocal" -> "🎤"
        "click" -> "⏱"
        "track" -> "🎵"
        "mic" -> "🎙"
        else -> "🎚"
    }
}

private fun channelAccentColor(id: String, color: String?, captureInputIndex: Int?): Color {
    val explicit = normalizeHex(color)
    if (explicit != null) return Color(android.graphics.Color.parseColor(explicit))
    if (captureInputIndex != null && captureInputIndex >= 0) {
        return DefaultChannelColors[captureInputIndex % DefaultChannelColors.size]
    }
    val h = hashText(id)
    return DefaultChannelColors[h % DefaultChannelColors.size]
}

private fun normalizeHex(input: String?): String? {
    if (input == null) return null
    val raw = input.trim()
    val re = Regex("^#?[0-9a-fA-F]{6}$")
    if (!re.matches(raw)) return null
    return if (raw.startsWith("#")) raw.lowercase() else "#${raw.lowercase()}"
}

private fun hashText(text: String): Int {
    var h = 0
    for (ch in text) {
        h = ((h * 31) + ch.code) ushr 0
    }
    return h
}
