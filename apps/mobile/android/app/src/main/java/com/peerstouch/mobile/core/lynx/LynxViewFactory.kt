package com.peerstouch.mobile.core.lynx

import android.content.Context
import android.view.View
import com.lynx.core.LynxView
import com.peerstouch.mobile.core.applet.AppletBridgeSession
import com.peerstouch.mobile.core.lynx.bridge.AppletBridgeNativeModule

class LynxViewFactory constructor(
    private val engineManager: LynxEngineManager
) {
    fun create(
        context: Context,
        bundleUrl: String,
        bridgeSession: AppletBridgeSession
    ): View {
        check(engineManager.isInitialized) { "LynxEngineManager must be initialized" }

        val lynxView = LynxView(context)

        // Register the bridge NativeModule so applet SDK can call NativeModules.bridge.invoke()
        val bridgeModule = AppletBridgeNativeModule(bridgeSession)
        lynxView.registerModule(bridgeModule)

        lynxView.loadTemplateUrl(bundleUrl)
        return lynxView
    }
}
