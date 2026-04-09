package com.peerstouch.mobile.core.lynx.bridge

import android.content.Context
import android.content.SharedPreferences

class StorageBridgeModule constructor(
    private val context: Context
) : BridgeModule {

    override val moduleName: String = "storage"

    private val prefs: SharedPreferences by lazy {
        context.getSharedPreferences("applet_storage", Context.MODE_PRIVATE)
    }

    override suspend fun handle(method: String, params: Map<String, Any?>): Any? {
        return when (method) {
            "get" -> {
                val key = params["key"] as? String ?: throw IllegalArgumentException("key is required")
                prefs.getString(key, null)
            }
            "set" -> {
                val key = params["key"] as? String ?: throw IllegalArgumentException("key is required")
                val value = params["value"] as? String ?: throw IllegalArgumentException("value is required")
                prefs.edit().putString(key, value).apply()
                null
            }
            "remove" -> {
                val key = params["key"] as? String ?: throw IllegalArgumentException("key is required")
                prefs.edit().remove(key).apply()
                null
            }
            "clear" -> {
                prefs.edit().clear().apply()
                null
            }
            else -> throw IllegalArgumentException("Unknown method: $moduleName.$method")
        }
    }
}
