package com.peerstouch.mobile.core.lynx.bridge

import android.content.Context
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.ReadableMap
import com.peerstouch.mobile.core.applet.AppletBridgeSession
import com.peerstouch.mobile.core.applet.AppletRuntimeE2E
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Native module registered as "bridge" in the LynxView runtime.
 * Receives invoke calls from the applet SDK's LynxBridgeAdapter:
 *   NativeModules.bridge.invoke({ method: "storage.get", params: { key: "foo" } })
 */
class AppletBridgeNativeModule(
    context: Context,
    sessionParam: Any?
) : LynxModule(context, sessionParam) {

    private val protocol = "peers-touch.applet.bridge"
    private val appContext = context.applicationContext
    private val session = sessionParam as AppletBridgeSession

    @LynxMethod
    fun invoke(data: String): String {
        return try {
            val json = JSONObject(data)
            val method = json.optString("method").takeIf { it.isNotBlank() }
                ?: return errorEnvelope(nextRequestId(), "INVALID_PARAMS", "Applet bridge invoke requires method")
            val params = json.optJSONObject("params")
            val requestId = params
                ?.optJSONObject("options")
                ?.optString("requestId")
                ?.takeIf { it.isNotBlank() }
                ?: nextRequestId()
            val paramsMap: Map<String, Any?> = if (params != null) {
                params.keys().asSequence().associateWith { key ->
                    params.opt(key).takeUnless { value -> value == JSONObject.NULL }
                }
            } else {
                emptyMap()
            }

            dispatchEnvelope(method, paramsMap, requestId)
        } catch (e: JSONException) {
            errorEnvelope(nextRequestId(), "INVALID_PARAMS", e.message ?: "Invalid applet bridge payload")
        } catch (e: Exception) {
            errorEnvelope(nextRequestId(), "CAPABILITY_FAILED", e.message ?: "Applet bridge invocation failed")
        }
    }

    @LynxMethod
    fun invoke(data: ReadableMap): String {
        val requestId = data.getMap("params")
            ?.getMap("options")
            ?.getString("requestId")
            ?.takeIf { it.isNotBlank() }
            ?: nextRequestId()
        return try {
            val method = data.getString("method")?.takeIf { it.isNotBlank() }
                ?: return errorEnvelope(requestId, "INVALID_PARAMS", "Applet bridge invoke requires method")
            val paramsMap = data.getMap("params")?.toHashMap() ?: emptyMap()

            dispatchEnvelope(method, paramsMap, requestId)
        } catch (e: Exception) {
            errorEnvelope(requestId, "CAPABILITY_FAILED", e.message ?: "Applet bridge invocation failed")
        }
    }

    private fun dispatchEnvelope(method: String, params: Map<String, Any?>, requestId: String): String {
        val result = runBlocking {
            session.dispatch(method, params)
        }

        val envelope = when (result) {
            is BridgeResult.Success -> {
                contractEnvelope(requestId, true).apply {
                    put("result", toJsonValue(result.data))
                }.toString()
            }
            is BridgeResult.Error -> {
                errorEnvelope(requestId, result.code, result.message)
            }
        }
        AppletRuntimeE2E.record(appContext, session, method, envelope)
        return envelope
    }

    private fun nextRequestId(): String = "android-${System.currentTimeMillis()}"

    private fun errorEnvelope(requestId: String, code: String, message: String): String =
        contractEnvelope(requestId, false).apply {
            put("error", JSONObject().apply {
                put("code", code)
                put("message", message)
                put("requestId", requestId)
            })
        }.toString()

    private fun contractEnvelope(requestId: String, ok: Boolean): JSONObject = JSONObject().apply {
        put("protocol", protocol)
        put("kind", "response")
        put("appletId", session.manifest.id)
        put("sessionId", session.sessionId)
        put("requestId", requestId)
        put("ok", ok)
    }

    private fun toJsonValue(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        JSONObject.NULL -> JSONObject.NULL
        is JSONObject -> value
        is JSONArray -> value
        is Map<*, *> -> JSONObject().apply {
            value.forEach { (key, item) ->
                if (key is String) {
                    put(key, toJsonValue(item))
                }
            }
        }
        is Iterable<*> -> JSONArray().apply {
            value.forEach { item -> put(toJsonValue(item)) }
        }
        is Array<*> -> JSONArray().apply {
            value.forEach { item -> put(toJsonValue(item)) }
        }
        is String, is Number, is Boolean -> value
        else -> value.toString()
    }
}
