package com.inear.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Bg = Color(0xFF05070b)
private val Panel = Color(0xFF10141c)
private val Accent = Color(0xFF58a6ff)
private val Green = Color(0xFF2ea043)
private val TextMain = Color(0xFFe6edf3)
private val TextMuted = Color(0xFF95a1b5)

private val scheme = darkColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    secondary = Green,
    background = Bg,
    surface = Panel,
    onBackground = TextMain,
    onSurface = TextMain,
    outline = Color(0xFF293244),
    tertiary = TextMuted,
)

@Composable
fun InEarTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        content = content,
    )
}
