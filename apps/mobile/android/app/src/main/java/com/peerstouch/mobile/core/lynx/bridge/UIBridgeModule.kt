package com.peerstouch.mobile.core.lynx.bridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast

class UIBridgeModule constructor(
    private val context: Context
) : BridgeModule {

    override val moduleName: String = "ui"

    private val mainHandler = Handler(Looper.getMainLooper())

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "showToast" -> showToast(
                params["content"] as? String ?: throw IllegalArgumentException("content is required"),
                (params["duration"] as? Number)?.toLong() ?: 2000L,
                params["type"] as? String ?: "info"
            )
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }

    private fun showToast(content: String, duration: Long, type: String) {
        val toastDuration = if (duration > 2500) Toast.LENGTH_LONG else Toast.LENGTH_SHORT
        mainHandler.post {
            Toast.makeText(context, content, toastDuration).show()
        }
    }
}
