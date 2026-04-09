package com.peerstouch.mobile.core.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightColorScheme = lightColorScheme(
    primary = PeersPrimary,
    onPrimary = PeersOnPrimary,
    primaryContainer = PeersPrimaryContainer,
    onPrimaryContainer = PeersOnPrimaryContainer,
    secondary = PeersSecondary,
    onSecondary = PeersOnSecondary,
    secondaryContainer = PeersSecondaryContainer,
    onSecondaryContainer = PeersOnSecondaryContainer,
    tertiary = PeersTertiary,
    onTertiary = PeersOnTertiary,
    background = PeersBackground,
    onBackground = PeersOnBackground,
    surface = PeersSurface,
    onSurface = PeersOnSurface,
    surfaceVariant = PeersSurfaceVariant,
    onSurfaceVariant = PeersOnSurfaceVariant,
    outline = PeersOutline,
    outlineVariant = PeersOutlineVariant,
    error = PeersError,
    onError = PeersOnError
)

private val DarkColorScheme = darkColorScheme(
    primary = PeersPrimaryDark,
    onPrimary = PeersOnPrimaryDark,
    primaryContainer = PeersPrimaryContainerDark,
    onPrimaryContainer = PeersOnPrimaryContainerDark,
    secondary = PeersSecondaryDark,
    onSecondary = PeersOnSecondaryDark,
    secondaryContainer = PeersSecondaryContainerDark,
    onSecondaryContainer = PeersOnSecondaryContainerDark,
    tertiary = PeersTertiaryDark,
    onTertiary = PeersOnTertiaryDark,
    background = PeersBackgroundDark,
    onBackground = PeersOnBackgroundDark,
    surface = PeersSurfaceDark,
    onSurface = PeersOnSurfaceDark,
    surfaceVariant = PeersSurfaceVariantDark,
    onSurfaceVariant = PeersOnSurfaceVariantDark,
    outline = PeersOutlineDark,
    outlineVariant = PeersOutlineVariantDark,
    error = PeersErrorDark,
    onError = PeersOnErrorDark
)

@Composable
fun PeersTouchTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
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
            window.statusBarColor = colorScheme.surface.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = PeersTouchTypography,
        content = content
    )
}
