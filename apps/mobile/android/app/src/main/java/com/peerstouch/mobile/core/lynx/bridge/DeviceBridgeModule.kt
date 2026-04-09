package com.peerstouch.mobile.core.lynx.bridge

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build

class DeviceBridgeModule constructor(
    private val context: Context
) : BridgeModule {

    override val moduleName: String = "device"

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "getClipboardContent" -> getClipboardContent()
            "setClipboardContent" -> setClipboardContent(
                params["content"] as? String ?: throw IllegalArgumentException("content is required")
            )
            "getDeviceInfo" -> getDeviceInfo()
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun getClipboardContent(): String? {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = clipboard.primaryClip
        return if (clip != null && clip.itemCount > 0) {
            clip.getItemAt(0).text?.toString()
        } else {
            null
        }
    }

    private fun setClipboardContent(content: String) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("applet_clipboard", content)
        clipboard.setPrimaryClip(clip)
    }

    private fun getDeviceInfo(): Map<String, Any> {
        return mapOf(
            "brand" to Build.BRAND,
            "model" to Build.MODEL,
            "manufacturer" to Build.MANUFACTURER,
            "osVersion" to Build.VERSION.RELEASE,
            "sdkInt" to Build.VERSION.SDK_INT
        )
    }
}
