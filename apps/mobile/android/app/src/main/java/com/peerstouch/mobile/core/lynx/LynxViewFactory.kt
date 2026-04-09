package com.peerstouch.mobile.core.lynx

import android.content.Context
import android.view.View
import com.lynx.core.LynxView
import com.peerstouch.mobile.core.applet.AppletBridgeSession

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
        lynxView.loadTemplateUrl(bundleUrl)
        return lynxView
    }
}
