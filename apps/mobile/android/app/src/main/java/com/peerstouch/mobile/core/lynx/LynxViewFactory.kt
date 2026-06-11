package com.peerstouch.mobile.core.lynx

import android.content.Context
import android.view.View
import com.peerstouch.mobile.core.applet.AppletBridgeSession
import com.peerstouch.mobile.core.lynx.bridge.AppletBridgeNativeModule
import com.lynx.tasm.LynxView
import java.io.File
import java.net.URI

class LynxViewFactory constructor(
    private val engineManager: LynxEngineManager
) {
    fun create(
        context: Context,
        bundleUrl: String,
        bridgeSession: AppletBridgeSession
    ): View {
        check(engineManager.isInitialized) { "LynxEngineManager must be initialized" }

        val lynxView = LynxView.builder(context).apply {
            registerModule("bridge", AppletBridgeNativeModule::class.java, bridgeSession)
        }.build(context)

        if (bundleUrl.startsWith("file:")) {
            val bundleBytes = File(URI(bundleUrl)).readBytes()
            lynxView.renderTemplateWithBaseUrl(bundleBytes, emptyMap<String, Any>(), bundleUrl)
        } else {
            lynxView.renderTemplateUrl(bundleUrl, emptyMap<String, Any>())
        }
        return lynxView
    }
}
