package com.peerstouch.mobile.core.lynx.bridge

import android.content.Context
import android.os.Build

class SystemBridgeModule constructor(
    private val context: Context
) : BridgeModule {

    override val moduleName: String = "system"

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "getInfo" -> getInfo()
            "getLocale" -> getLocale()
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun getInfo(): Map<String, Any> {
        return mapOf(
            "platform" to "mobile",
            "os" to "android",
            "version" to Build.VERSION.RELEASE,
            "appVersion" to getAppVersion(),
            "appName" to "PeersTouch",
            "screenWidth" to context.resources.displayMetrics.widthPixels,
            "screenHeight" to context.resources.displayMetrics.heightPixels,
            "density" to context.resources.displayMetrics.density
        )
    }

    private fun getLocale(): Map<String, String> {
        val locale = context.resources.configuration.locales[0]
        return mapOf(
            "language" to locale.language,
            "country" to locale.country,
            "tag" to locale.toLanguageTag()
        )
    }

    private fun getAppVersion(): String {
        return try {
            val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
            packageInfo.versionName ?: "0.0.0"
        } catch (_: Exception) {
            "0.0.0"
        }
    }
}
