package com.peerstouch.mobile.core.applet.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.peerstouch.mobile.core.applet.AppletManager
import com.peerstouch.mobile.core.applet.AppletState
import com.peerstouch.mobile.core.applet.kernel.AppletSurfaceCache

sealed class AppletContainerState {
    data object Loading : AppletContainerState()
    data object Running : AppletContainerState()
    data class Error(val message: String) : AppletContainerState()
}

@Composable
fun AppletContainerView(
    appletId: String,
    appletManager: AppletManager = hiltViewModel<AppletContainerViewModel>().appletManager,
    appletSurfaceCache: AppletSurfaceCache = hiltViewModel<AppletContainerViewModel>().appletSurfaceCache
) {
    val context = LocalContext.current
    var containerState by remember { mutableStateOf<AppletContainerState>(AppletContainerState.Loading) }

    LaunchedEffect(appletId) {
        try {
            appletManager.scanLocalApplets()
            val session = appletManager.loadApplet(appletId)
            if (session.state == AppletState.VISIBLE) {
                containerState = AppletContainerState.Running
            } else {
                containerState = AppletContainerState.Error("Applet is in ${session.state} state")
            }
        } catch (e: Exception) {
            containerState = AppletContainerState.Error(e.message ?: "Unknown error")
        }
    }

    DisposableEffect(appletId) {
        onDispose {
            appletManager.hideApplet(appletId)
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        when (val state = containerState) {
            is AppletContainerState.Loading -> AppletLoadingView()
            is AppletContainerState.Running -> {
                val session = appletManager.getApplet(appletId)
                if (session != null) {
                    val loadConfig = session.manifest.load.android
                        ?: throw IllegalStateException("Applet ${session.manifest.id} has no android load config")
                    AndroidView(
                        factory = { ctx ->
                            check(loadConfig.entry.isNotBlank()) { "Applet ${session.manifest.id} has blank android entry" }
                            appletManager.showApplet(appletId)
                            appletSurfaceCache.getOrCreate(ctx, appletId, appletManager)
                        },
                        update = {
                            appletManager.showApplet(appletId)
                        },
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    AppletErrorView(
                        message = "Applet session not available",
                        onRetry = { containerState = AppletContainerState.Loading }
                    )
                }
            }
            is AppletContainerState.Error -> AppletErrorView(
                message = state.message,
                onRetry = { containerState = AppletContainerState.Loading }
            )
        }
    }
}
