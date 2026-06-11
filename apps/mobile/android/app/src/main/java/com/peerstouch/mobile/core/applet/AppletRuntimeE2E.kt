package com.peerstouch.mobile.core.applet

import android.content.Context
import android.content.Intent
import java.io.File

object AppletRuntimeE2E {
    private const val EXTRA_ENABLED = "peers_touch_applet_android_runtime_e2e"
    private const val EXTRA_APPLET_ID = "peers_touch_applet_android_runtime_e2e_applet_id"
    private const val MARKER_DIR = "AppletRuntimeE2E"

    @Volatile
    private var enabled = false

    @Volatile
    private var appletId: String? = null

    fun configure(intent: Intent?): String? {
        enabled = intent?.getStringExtra(EXTRA_ENABLED) == "1"
        appletId = intent?.getStringExtra(EXTRA_APPLET_ID)?.takeIf { it.isNotBlank() }
        return launchAppletId()
    }

    fun launchAppletId(): String? = if (enabled) appletId else null

    fun record(context: Context, session: AppletBridgeSession, method: String, envelope: String) {
        val expectedAppletId = launchAppletId() ?: return
        if (session.manifest.id != expectedAppletId) return
        if (method != "storage.set" && method != "storage.get") return

        val markerDir = File(context.filesDir, MARKER_DIR).also { it.mkdirs() }
        File(markerDir, "$method.json").writeText(envelope)
    }
}
