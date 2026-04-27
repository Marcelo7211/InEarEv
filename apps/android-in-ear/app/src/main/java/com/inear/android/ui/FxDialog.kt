package com.inear.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.Canvas
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.nativeCanvas
import com.inear.android.net.CompressorSettings
import com.inear.android.net.DelaySettings
import com.inear.android.net.PeqBand
import com.inear.android.net.PeqSettings
import com.inear.android.net.ReverbSettings
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

// Paleta console alinhada ao desktop / mobile RN.
private val FxBgChassis = Color(0xFF05080d)
private val FxBgPanel = Color(0xFF0b1118)
private val FxBgScribble = Color(0xFF0e1825)
private val FxBgRecess = Color(0xFF070b11)
private val FxBorder = Color(0xFF1e2a3c)
private val FxBorderMetal = Color(0xFF2a394f)
private val FxTextHi = Color(0xFFe8eef7)
private val FxTextMid = Color(0xFF9caec6)
private val FxTextLo = Color(0xFF5b6a82)
private val FxLedGreen = Color(0xFF39ff14)
private val FxLedAmber = Color(0xFFffb020)
private val FxLedRed = Color(0xFFff3b3b)
private val FxLedBlue = Color(0xFF4ea3ff)
private val FxBandColors = listOf(
    Color(0xFF39ff14),
    Color(0xFF5cc8ff),
    Color(0xFFffb020),
    Color(0xFFff5252),
    Color(0xFFbf7af0),
    Color(0xFF41e0d4),
)

private const val FREQ_MIN = 20.0
private const val FREQ_MAX = 20000.0

@Composable
fun FxDialog(
    visible: Boolean,
    channelName: String,
    channelId: String,
    accent: Color,
    peq: PeqSettings?,
    comp: CompressorSettings?,
    delay: DelaySettings?,
    reverb: ReverbSettings?,
    bypassed: Boolean,
    onClose: () -> Unit,
    onPeqCommit: (PeqSettings) -> Unit,
    onCompCommit: (CompressorSettings) -> Unit,
    onDelayCommit: (DelaySettings) -> Unit,
    onReverbCommit: (ReverbSettings) -> Unit,
    onToggleBypass: (Boolean) -> Unit,
    onCreateDefaultPeq: () -> Unit,
) {
    if (!visible) return

    val effectiveComp = comp ?: defaultCompressor()
    val effectiveDelay = delay ?: defaultDelay()
    val effectiveReverb = reverb ?: defaultReverb()
    val peqEnabled = peq?.enabled == true
    val peqBands: List<PeqBand> = peq?.bands ?: emptyList()

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xCC020408)),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                modifier = Modifier
                    .padding(12.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(FxBgChassis)
                    .border(1.dp, accent, RoundedCornerShape(12.dp))
                    .fillMaxWidth(0.96f)
                    .height(720.dp),
            ) {
                // HEADER
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(FxBgScribble)
                        .border(1.dp, FxBorder)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        modifier = Modifier
                            .width(6.dp)
                            .height(26.dp)
                            .background(accent, RoundedCornerShape(2.dp)),
                    )
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "FX · $channelId",
                            color = FxTextLo,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Black,
                            fontFamily = FontFamily.Monospace,
                        )
                        Text(
                            channelName.ifBlank { "Canal" },
                            color = FxTextHi,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 1,
                        )
                    }
                    PowerPill(
                        label = "BYPASS",
                        on = bypassed,
                        accent = FxLedAmber,
                        onClick = { onToggleBypass(!bypassed) },
                    )
                    CloseBtn(onClick = onClose)
                }

                // BODY
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (bypassed) {
                        BypassWarning()
                    }

                    // PEQ section
                    SectionFrame(dimmed = bypassed) {
                        SectionHeaderRow(
                            ledOn = peqEnabled,
                            ledColor = accent,
                            title = "EQUALIZER · PARAMÉTRICO",
                            trailing = {
                                PowerPill(
                                    label = "EQ",
                                    on = peqEnabled,
                                    accent = accent,
                                    onClick = {
                                        if (peqBands.isEmpty()) onCreateDefaultPeq()
                                        else onPeqCommit(
                                            PeqSettings(
                                                enabled = !peqEnabled,
                                                bands = peqBands,
                                            ),
                                        )
                                    },
                                )
                            },
                        )
                        Spacer(Modifier.height(8.dp))
                        if (peqBands.isEmpty()) {
                            EmptyPeqCta(accent = accent, onCreate = onCreateDefaultPeq)
                        } else {
                            PeqGraph(
                                bands = peqBands,
                                enabled = peqEnabled,
                                accent = accent,
                                onBandsChange = { newBands ->
                                    onPeqCommit(PeqSettings(enabled = peqEnabled, bands = newBands))
                                },
                            )
                            Spacer(Modifier.height(6.dp))
                            PeqBandList(
                                bands = peqBands,
                                onToggleBand = { idx ->
                                    val updated = peqBands.mapIndexed { i, b ->
                                        if (i == idx) b.copy(enabled = !(b.enabled)) else b
                                    }
                                    onPeqCommit(PeqSettings(enabled = peqEnabled, bands = updated))
                                },
                                onUpdateQ = { idx, newQ ->
                                    val updated = peqBands.mapIndexed { i, b ->
                                        if (i == idx) b.copy(q = newQ.toDouble()) else b
                                    }
                                    onPeqCommit(PeqSettings(enabled = peqEnabled, bands = updated))
                                },
                            )
                        }
                    }

                    // COMPRESSOR
                    AccordionSection(
                        title = "COMPRESSOR (master)",
                        ledOn = effectiveComp.enabled,
                        ledColor = FxLedBlue,
                        dimmed = bypassed,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FxParamSlider(
                                label = "ENABLED",
                                accent = FxLedBlue,
                                value = if (effectiveComp.enabled) 1f else 0f,
                                min = 0f, max = 1f, step = 1f,
                                unit = "",
                                displayFormat = { if (it >= 0.5f) "ON" else "OFF" },
                                onCommit = { v ->
                                    onCompCommit(effectiveComp.copy(enabled = v >= 0.5f))
                                },
                            )
                            FxParamSlider(
                                label = "THRESHOLD",
                                accent = FxLedBlue,
                                value = effectiveComp.thresholdDb.toFloat(),
                                min = -60f, max = 0f, step = 0.5f, unit = "dB",
                                onCommit = { onCompCommit(effectiveComp.copy(thresholdDb = it.toDouble())) },
                            )
                            FxParamSlider(
                                label = "RATIO",
                                accent = FxLedBlue,
                                value = effectiveComp.ratio.toFloat(),
                                min = 1f, max = 20f, step = 0.1f, unit = ":1",
                                onCommit = { onCompCommit(effectiveComp.copy(ratio = it.toDouble())) },
                            )
                            FxParamSlider(
                                label = "ATTACK",
                                accent = FxLedBlue,
                                value = effectiveComp.attackMs.toFloat(),
                                min = 0.1f, max = 200f, step = 0.5f, unit = "ms",
                                onCommit = { onCompCommit(effectiveComp.copy(attackMs = it.toDouble())) },
                            )
                            FxParamSlider(
                                label = "RELEASE",
                                accent = FxLedBlue,
                                value = effectiveComp.releaseMs.toFloat(),
                                min = 5f, max = 2000f, step = 5f, unit = "ms",
                                onCommit = { onCompCommit(effectiveComp.copy(releaseMs = it.toDouble())) },
                            )
                            FxParamSlider(
                                label = "MAKEUP",
                                accent = FxLedBlue,
                                value = effectiveComp.makeupDb.toFloat(),
                                min = -12f, max = 24f, step = 0.5f, unit = "dB",
                                onCommit = { onCompCommit(effectiveComp.copy(makeupDb = it.toDouble())) },
                            )
                        }
                    }

                    // DELAY
                    AccordionSection(
                        title = "DELAY (master)",
                        ledOn = effectiveDelay.enabled,
                        ledColor = FxLedRed,
                        dimmed = bypassed,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FxParamSlider(
                                label = "ENABLED",
                                accent = FxLedRed,
                                value = if (effectiveDelay.enabled) 1f else 0f,
                                min = 0f, max = 1f, step = 1f,
                                unit = "",
                                displayFormat = { if (it >= 0.5f) "ON" else "OFF" },
                                onCommit = { v ->
                                    onDelayCommit(effectiveDelay.copy(enabled = v >= 0.5f))
                                },
                            )
                            FxParamSlider(
                                label = "TIME",
                                accent = FxLedRed,
                                value = effectiveDelay.timeMs.toFloat(),
                                min = 5f, max = 1500f, step = 1f, unit = "ms",
                                onCommit = { onDelayCommit(effectiveDelay.copy(timeMs = it.toDouble())) },
                            )
                            FxParamSlider(
                                label = "FEEDBACK",
                                accent = FxLedRed,
                                value = (effectiveDelay.feedback * 100).toFloat(),
                                min = 0f, max = 95f, step = 1f, unit = "%",
                                onCommit = { onDelayCommit(effectiveDelay.copy(feedback = it / 100.0)) },
                            )
                            FxParamSlider(
                                label = "MIX",
                                accent = FxLedRed,
                                value = (effectiveDelay.mix * 100).toFloat(),
                                min = 0f, max = 100f, step = 1f, unit = "%",
                                onCommit = { onDelayCommit(effectiveDelay.copy(mix = it / 100.0)) },
                            )
                            FxParamSlider(
                                label = "OUTPUT",
                                accent = FxLedRed,
                                value = effectiveDelay.outputDb.toFloat(),
                                min = -24f, max = 6f, step = 0.5f, unit = "dB",
                                onCommit = { onDelayCommit(effectiveDelay.copy(outputDb = it.toDouble())) },
                            )
                        }
                    }

                    // REVERB
                    AccordionSection(
                        title = "REVERB (master)",
                        ledOn = effectiveReverb.enabled,
                        ledColor = FxLedBlue,
                        dimmed = bypassed,
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FxParamSlider(
                                label = "ENABLED",
                                accent = FxLedBlue,
                                value = if (effectiveReverb.enabled) 1f else 0f,
                                min = 0f, max = 1f, step = 1f,
                                unit = "",
                                displayFormat = { if (it >= 0.5f) "ON" else "OFF" },
                                onCommit = { v ->
                                    onReverbCommit(effectiveReverb.copy(enabled = v >= 0.5f))
                                },
                            )
                            FxParamSlider(
                                label = "SIZE",
                                accent = FxLedBlue,
                                value = (effectiveReverb.size * 100).toFloat(),
                                min = 0f, max = 100f, step = 1f, unit = "%",
                                onCommit = { onReverbCommit(effectiveReverb.copy(size = it / 100.0)) },
                            )
                            FxParamSlider(
                                label = "DECAY",
                                accent = FxLedBlue,
                                value = effectiveReverb.decayS.toFloat(),
                                min = 0.2f, max = 6f, step = 0.05f, unit = "s",
                                onCommit = { onReverbCommit(effectiveReverb.copy(decayS = it.toDouble())) },
                            )
                            FxParamSlider(
                                label = "DAMPING",
                                accent = FxLedBlue,
                                value = (effectiveReverb.damping * 100).toFloat(),
                                min = 0f, max = 100f, step = 1f, unit = "%",
                                onCommit = { onReverbCommit(effectiveReverb.copy(damping = it / 100.0)) },
                            )
                            FxParamSlider(
                                label = "MIX",
                                accent = FxLedBlue,
                                value = (effectiveReverb.mix * 100).toFloat(),
                                min = 0f, max = 100f, step = 1f, unit = "%",
                                onCommit = { onReverbCommit(effectiveReverb.copy(mix = it / 100.0)) },
                            )
                            FxParamSlider(
                                label = "PRE-DELAY",
                                accent = FxLedBlue,
                                value = effectiveReverb.preDelayMs.toFloat(),
                                min = 0f, max = 200f, step = 1f, unit = "ms",
                                onCommit = { onReverbCommit(effectiveReverb.copy(preDelayMs = it.toDouble())) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BypassWarning() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(Color(0x1AFFB020))
            .border(1.dp, FxLedAmber, RoundedCornerShape(6.dp))
            .padding(10.dp),
    ) {
        Text(
            "BYPASS ATIVO — sinal original (sem PEQ/FX) sendo enviado ao fone deste canal.",
            color = FxLedAmber,
            fontSize = 11.sp,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun SectionFrame(
    dimmed: Boolean = false,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(FxBgPanel)
            .border(1.dp, FxBorder, RoundedCornerShape(8.dp))
            .padding(10.dp),
    ) {
        if (dimmed) {
            Box(modifier = Modifier.fillMaxSize().background(Color(0x66020408)))
        }
        Column { content() }
    }
}

@Composable
private fun SectionHeaderRow(
    ledOn: Boolean,
    ledColor: Color,
    title: String,
    trailing: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .background(if (ledOn) ledColor else Color(0xFF1c2531), CircleShape),
        )
        Text(
            title,
            color = FxTextMid,
            fontSize = 11.sp,
            fontWeight = FontWeight.Black,
            fontFamily = FontFamily.Monospace,
            modifier = Modifier.weight(1f),
        )
        trailing()
    }
}

@Composable
private fun PowerPill(
    label: String,
    on: Boolean,
    accent: Color,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (on) accent.copy(alpha = 0.18f) else FxBgRecess)
            .border(1.dp, if (on) accent else FxBorder, RoundedCornerShape(999.dp))
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(
            label,
            color = if (on) accent else FxTextMid,
            fontSize = 10.sp,
            fontWeight = FontWeight.Black,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun CloseBtn(onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(CircleShape)
            .background(FxBgRecess)
            .border(1.dp, FxBorder, CircleShape)
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text("×", color = FxTextHi, fontSize = 18.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun EmptyPeqCta(accent: Color, onCreate: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(FxBgRecess)
            .border(1.dp, accent, RoundedCornerShape(8.dp))
            .clickable { onCreate() }
            .padding(vertical = 16.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "+ CRIAR EQ GRÁFICO (6 BANDAS)",
            color = accent,
            fontSize = 12.sp,
            fontWeight = FontWeight.Black,
            fontFamily = FontFamily.Monospace,
        )
    }
}

/** Curva PEQ desenhada em Canvas com pontos arrastáveis. */
@Composable
private fun PeqGraph(
    bands: List<PeqBand>,
    enabled: Boolean,
    accent: Color,
    onBandsChange: (List<PeqBand>) -> Unit,
) {
    val gainRangeDb = 18f
    var size by remember { mutableStateOf(Size.Zero) }
    var dragIdx by remember { mutableStateOf(-1) }

    fun freqToX(f: Double, w: Float): Float {
        val safe = f.coerceIn(FREQ_MIN, FREQ_MAX)
        val frac = (log10(safe) - log10(FREQ_MIN)) / (log10(FREQ_MAX) - log10(FREQ_MIN))
        return (frac.toFloat()) * w
    }

    fun xToFreq(x: Float, w: Float): Double {
        val frac = (x / w).coerceIn(0f, 1f).toDouble()
        val lo = log10(FREQ_MIN)
        val hi = log10(FREQ_MAX)
        return 10.0.pow(lo + frac * (hi - lo))
    }

    fun dbToY(db: Float, h: Float): Float {
        val frac = ((gainRangeDb - db) / (gainRangeDb * 2f)).coerceIn(0f, 1f)
        return frac * h
    }

    fun yToDb(y: Float, h: Float): Float {
        val frac = (y / h).coerceIn(0f, 1f)
        return gainRangeDb - frac * gainRangeDb * 2f
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(200.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(Color(0xFF040608))
            .border(1.dp, FxBorder, RoundedCornerShape(6.dp))
            .onSizeChanged { size = Size(it.width.toFloat(), it.height.toFloat()) }
            .pointerInput(bands) {
                detectDragGestures(
                    onDragStart = { offset ->
                        // pega banda mais próxima
                        var best = -1
                        var bestDist = Float.MAX_VALUE
                        bands.forEachIndexed { i, b ->
                            val cx = freqToX(b.freqHz, size.width)
                            val cy = dbToY(b.gainDb.toFloat(), size.height)
                            val d = (offset.x - cx).pow(2) + (offset.y - cy).pow(2)
                            if (d < bestDist) {
                                bestDist = d
                                best = i
                            }
                        }
                        if (bestDist <= 60f * 60f) dragIdx = best
                    },
                    onDrag = { change, _ ->
                        if (dragIdx < 0) return@detectDragGestures
                        change.consume()
                        val pos = change.position
                        val newF = xToFreq(pos.x, size.width)
                        val newG = yToDb(pos.y, size.height)
                        val updated = bands.mapIndexed { i, b ->
                            if (i == dragIdx) b.copy(
                                freqHz = newF.coerceIn(FREQ_MIN, FREQ_MAX).roundToInt().toDouble(),
                                gainDb = ((newG.coerceIn(-gainRangeDb, gainRangeDb) * 10).roundToInt() / 10.0),
                            ) else b
                        }
                        onBandsChange(updated)
                    },
                    onDragEnd = { dragIdx = -1 },
                    onDragCancel = { dragIdx = -1 },
                )
            },
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val w = this.size.width
            val h = this.size.height

            // grid Hz
            val freqMajor = listOf(
                20.0 to "20",
                100.0 to "100",
                1000.0 to "1k",
                10000.0 to "10k",
                20000.0 to "20k",
            )
            freqMajor.forEach { (f, _) ->
                val x = freqToX(f, w)
                drawLine(
                    color = Color(0xFF1a2c40),
                    start = Offset(x, 0f),
                    end = Offset(x, h),
                    strokeWidth = 1f,
                )
            }
            // grid dB
            listOf(gainRangeDb, gainRangeDb / 2, 0f, -gainRangeDb / 2, -gainRangeDb).forEach { db ->
                val y = dbToY(db, h)
                val major = db == 0f
                drawLine(
                    color = if (major) Color(0xFF243447) else Color(0xFF0c1825),
                    start = Offset(0f, y),
                    end = Offset(w, y),
                    strokeWidth = if (major) 1.4f else 1f,
                    pathEffect = if (major) null else PathEffect.dashPathEffect(floatArrayOf(4f, 6f)),
                )
            }

            // curva combinada (amostragem)
            if (enabled && bands.isNotEmpty()) {
                val samples = 120
                val path = Path()
                for (i in 0 until samples) {
                    val x = (i.toFloat() / (samples - 1)) * w
                    val frac = (i.toFloat() / (samples - 1)).toDouble()
                    val lo = log10(FREQ_MIN)
                    val hi = log10(FREQ_MAX)
                    val f = 10.0.pow(lo + frac * (hi - lo))
                    val sumDb = combinedResponseDb(bands, f)
                    val y = dbToY(sumDb.toFloat(), h)
                    if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                }
                drawPath(
                    path = path,
                    brush = SolidColor(accent),
                    style = Stroke(width = 3f),
                )
            }

            // Pontos das bandas
            bands.forEachIndexed { i, b ->
                val tint = if (b.enabled) FxBandColors[i % FxBandColors.size] else Color(0xFF3a4a63)
                val cx = freqToX(b.freqHz, w)
                val cy = dbToY(b.gainDb.toFloat(), h)
                // linha guia até eixo X
                drawLine(
                    color = tint.copy(alpha = if (b.enabled) 0.35f else 0.15f),
                    start = Offset(cx, cy),
                    end = Offset(cx, h),
                    strokeWidth = 1f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(2f, 3f)),
                )
                // bolinha
                drawCircle(color = tint, radius = 16f, center = Offset(cx, cy))
                drawCircle(
                    color = Color(0xFF06090f),
                    radius = 16f,
                    center = Offset(cx, cy),
                    style = Stroke(width = 2f),
                )
                // número
                drawContext.canvas.nativeCanvas.apply {
                    val paint = android.graphics.Paint().apply {
                        color = android.graphics.Color.parseColor("#06090f")
                        textSize = 24f
                        isFakeBoldText = true
                        isAntiAlias = true
                        textAlign = android.graphics.Paint.Align.CENTER
                    }
                    drawText("${i + 1}", cx, cy + 8f, paint)
                }
            }

            // Labels Hz no rodapé
            drawContext.canvas.nativeCanvas.apply {
                val paint = android.graphics.Paint().apply {
                    color = android.graphics.Color.parseColor("#9caec6")
                    textSize = 22f
                    isAntiAlias = true
                    typeface = android.graphics.Typeface.MONOSPACE
                    textAlign = android.graphics.Paint.Align.CENTER
                }
                freqMajor.forEach { (f, label) ->
                    val x = freqToX(f, w)
                    drawText(label, x, h - 6f, paint)
                }
            }
        }
    }
}

@Composable
private fun PeqBandList(
    bands: List<PeqBand>,
    onToggleBand: (Int) -> Unit,
    onUpdateQ: (Int, Float) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        bands.forEachIndexed { i, b ->
            val tint = if (b.enabled) FxBandColors[i % FxBandColors.size] else Color(0xFF3a4a63)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(4.dp))
                    .background(FxBgRecess)
                    .padding(horizontal = 6.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Box(
                    modifier = Modifier
                        .size(22.dp)
                        .clip(CircleShape)
                        .background(tint)
                        .clickable { onToggleBand(i) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${i + 1}", color = Color(0xFF06090f), fontSize = 11.sp, fontWeight = FontWeight.Black)
                }
                Text(
                    b.type.uppercase(),
                    color = FxTextHi,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.width(64.dp),
                )
                MiniReadout(
                    label = "FREQ",
                    value = "${b.freqHz.roundToInt()} Hz",
                    accent = tint,
                    modifier = Modifier.weight(1f),
                )
                MiniReadout(
                    label = "GAIN",
                    value = "${if (b.gainDb >= 0) "+" else ""}${"%.1f".format(b.gainDb)} dB",
                    accent = tint,
                    modifier = Modifier.weight(1f),
                )
                MiniReadout(
                    label = "Q",
                    value = "%.2f".format(b.q),
                    accent = tint,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun MiniReadout(
    label: String,
    value: String,
    accent: Color,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(3.dp))
            .background(Color(0xFF040608))
            .border(1.dp, Color(0xFF11202d), RoundedCornerShape(3.dp))
            .padding(horizontal = 4.dp, vertical = 3.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            label,
            color = FxTextLo,
            fontSize = 7.sp,
            fontWeight = FontWeight.Black,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            value,
            color = accent,
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun AccordionSection(
    title: String,
    ledOn: Boolean,
    ledColor: Color,
    dimmed: Boolean = false,
    content: @Composable () -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(FxBgPanel)
            .border(1.dp, FxBorder, RoundedCornerShape(8.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(enabled = !dimmed) { open = !open }
                .padding(horizontal = 10.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .background(if (ledOn) ledColor else Color(0xFF1c2531), CircleShape),
            )
            Text(
                title,
                color = FxTextMid,
                fontSize = 11.sp,
                fontWeight = FontWeight.Black,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.weight(1f),
            )
            Text(
                if (open) "▴" else "▾",
                color = FxTextLo,
                fontSize = 14.sp,
            )
        }
        if (open) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(FxBgRecess)
                    .padding(10.dp),
            ) {
                content()
            }
        }
    }
}

@Composable
private fun FxParamSlider(
    label: String,
    accent: Color,
    value: Float,
    min: Float,
    max: Float,
    step: Float,
    unit: String,
    displayFormat: ((Float) -> String)? = null,
    onCommit: (Float) -> Unit,
) {
    var draft by remember(value) { mutableFloatStateOf(value) }
    val display = displayFormat?.invoke(draft) ?: run {
        val text = if (step < 1f) "%.1f".format(draft) else draft.roundToInt().toString()
        if (unit.isBlank()) text else "$text $unit"
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(6.dp))
            .background(FxBgPanel)
            .border(1.dp, FxBorder, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                label,
                color = FxTextLo,
                fontSize = 9.sp,
                fontWeight = FontWeight.Black,
                fontFamily = FontFamily.Monospace,
            )
            Text(
                display,
                color = accent,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
            )
        }
        Slider(
            value = draft,
            valueRange = min..max,
            steps = if (step <= 0f) 0 else max(0, ((max - min) / step).toInt() - 1),
            onValueChange = { draft = it },
            onValueChangeFinished = { onCommit(draft) },
            colors = SliderDefaults.colors(
                thumbColor = Color(0xFFcfd5df),
                activeTrackColor = accent,
                inactiveTrackColor = Color(0xFF0a131e),
            ),
        )
    }
}

private fun defaultCompressor() = CompressorSettings()
private fun defaultDelay() = DelaySettings()
private fun defaultReverb() = ReverbSettings()

private fun defaultPeqBandsList(): List<PeqBand> = listOf(
    PeqBand(type = "hpf", enabled = true, freqHz = 80.0, q = 0.707, gainDb = 0.0),
    PeqBand(type = "bell", enabled = true, freqHz = 250.0, q = 1.0, gainDb = 0.0),
    PeqBand(type = "bell", enabled = true, freqHz = 800.0, q = 1.0, gainDb = 0.0),
    PeqBand(type = "bell", enabled = true, freqHz = 2500.0, q = 1.0, gainDb = 0.0),
    PeqBand(type = "highshelf", enabled = true, freqHz = 9000.0, q = 0.707, gainDb = 0.0),
    PeqBand(type = "lpf", enabled = false, freqHz = 18000.0, q = 0.707, gainDb = 0.0),
)

fun defaultPeqSettings(): PeqSettings = PeqSettings(enabled = true, bands = defaultPeqBandsList())

private fun bandResponseDb(b: PeqBand, f: Double): Double {
    if (!b.enabled) return 0.0
    val f0 = b.freqHz.coerceIn(FREQ_MIN, FREQ_MAX)
    val oct = (ln(f / f0) / ln(2.0))
    val q = b.q.coerceIn(0.1, 18.0)
    return when (b.type) {
        "bell" -> {
            val w = 1.0 / q
            b.gainDb / (1.0 + (oct / w).pow(2.0))
        }
        "lowshelf" -> {
            val t = 1.0 / (1.0 + exp(oct * 4.0))
            b.gainDb * t
        }
        "highshelf" -> {
            val t = 1.0 / (1.0 + exp(-oct * 4.0))
            b.gainDb * t
        }
        "hpf" -> if (oct >= 0.0) 0.0 else -12.0 * abs(oct)
        "lpf" -> if (oct <= 0.0) 0.0 else -12.0 * oct
        else -> 0.0
    }
}

private fun combinedResponseDb(bands: List<PeqBand>, f: Double): Double {
    var sum = 0.0
    for (b in bands) sum += bandResponseDb(b, f)
    return sum
}
