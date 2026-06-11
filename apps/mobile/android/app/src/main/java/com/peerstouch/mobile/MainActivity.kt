package com.peerstouch.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.peerstouch.mobile.core.applet.AppletRuntimeE2E
import com.peerstouch.mobile.core.applet.ui.AppletContainerView
import com.peerstouch.mobile.core.theme.PeersTouchTheme
import com.peerstouch.mobile.navigation.AppNavGraph
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runtimeE2EAppletId = AppletRuntimeE2E.configure(intent)
        enableEdgeToEdge()
        setContent {
            PeersTouchTheme {
                if (runtimeE2EAppletId != null) {
                    AppletContainerView(appletId = runtimeE2EAppletId)
                } else {
                    AppNavGraph()
                }
            }
        }
    }
}
