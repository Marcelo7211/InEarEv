package com.inear.android.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val Bg = Color(0xFF070b11)
private val Panel = Color(0xFF111925)
private val Accent = Color(0xFF58a6ff)
private val Green = Color(0xFF2ea043)
private val TextMain = Color(0xFFeef4fb)
private val TextMuted = Color(0xFF99abc1)
private val Error = Color(0xFFff8e8e)

private val scheme = darkColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    secondary = Green,
    background = Bg,
    surface = Panel,
    onBackground = TextMain,
    onSurface = TextMain,
    outline = Color(0xFF31445c),
    tertiary = TextMuted,
    error = Error,
)

private val inEarTypography =
    Typography(
        headlineSmall =
            TextStyle(
                fontSize = 28.sp,
                lineHeight = 32.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = 0.3.sp,
            ),
        titleLarge =
            TextStyle(
                fontSize = 22.sp,
                lineHeight = 26.sp,
                fontWeight = FontWeight.Bold,
            ),
        titleMedium =
            TextStyle(
                fontSize = 18.sp,
                lineHeight = 22.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        titleSmall =
            TextStyle(
                fontSize = 15.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        labelMedium =
            TextStyle(
                fontSize = 13.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
            ),
        labelSmall =
            TextStyle(
                fontSize = 12.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Medium,
            ),
        bodyMedium =
            TextStyle(
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
    )

@Composable
fun InEarTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = scheme,
        typography = inEarTypography,
        content = content,
    )
}
