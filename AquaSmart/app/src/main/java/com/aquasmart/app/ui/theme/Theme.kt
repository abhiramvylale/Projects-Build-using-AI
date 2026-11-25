package com.aquasmart.app.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

private val DarkColorScheme = darkColorScheme(
    primary = Teal500,
    onPrimary = Navy900,
    primaryContainer = Teal400,
    onPrimaryContainer = Navy900,
    secondary = Teal300,
    onSecondary = Navy900,
    secondaryContainer = Navy700,
    onSecondaryContainer = Teal300,
    tertiary = Teal200,
    onTertiary = Navy900,
    tertiaryContainer = Navy600,
    onTertiaryContainer = Teal200,
    background = Navy900,
    onBackground = White87,
    surface = DarkSurface,
    onSurface = White87,
    surfaceVariant = DarkCard,
    onSurfaceVariant = White87,
    error = ErrorRed,
    onError = White,
    errorContainer = ErrorRed.copy(alpha = 0.2f),
    onErrorContainer = ErrorRed
)

private val LightColorScheme = lightColorScheme(
    primary = Navy900,
    onPrimary = White,
    primaryContainer = Navy800,
    onPrimaryContainer = White,
    secondary = Teal500,
    onSecondary = White,
    secondaryContainer = Teal200,
    onSecondaryContainer = Navy900,
    tertiary = Teal400,
    onTertiary = Navy900,
    tertiaryContainer = Teal200,
    onTertiaryContainer = Navy900,
    background = White,
    onBackground = Navy900,
    surface = White,
    onSurface = Navy900,
    surfaceVariant = White87,
    onSurfaceVariant = Navy900,
    error = ErrorRed,
    onError = White
)

private val AquaSmartShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(28.dp)
)

@Composable
fun AquaSmartTheme(
    darkTheme: Boolean = true, // Default to dark theme
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }
    
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        shapes = AquaSmartShapes,
        content = content
    )
}
