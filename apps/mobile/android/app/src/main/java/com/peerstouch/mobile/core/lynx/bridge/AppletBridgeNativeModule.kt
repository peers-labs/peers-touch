package com.peerstouch.mobile.core.lynx.bridge

import com.lynx.core.base.LynxMethod
import com.lynx.core.base.LynxModule
import com.peerstouch.mobile.core.applet.AppletBridgeSession
import kotlinx.coroutines.runBlocking
import org.json.JSONObject

/**
 * Native module registered as "bridge" in the LynxView runtime.
 * Receives invoke calls from the applet SDK's LynxBridgeAdapter:
 *   NativeModules.bridge.invoke({ method: "storage.get", params: { key: "foo" } })
 */
class AppletBridgeNativeModule(
    private val session: AppletBridgeSession
) : LynxModule() {

    override fun getName(): String = "bridge"

    @LynxMethod
    fun invoke(data: String): String {
        val json = JSONObject(data)
        val method = json.getString("method")
        val params = json.optJSONObject("params")
        val paramsMap: Map<String, Any?> = if (params != null) {
            params.keys().asSequence().associateWith { key -> params.opt(key) }
        } else {
            emptyMap()
        }

        val result = runBlocking {
            session.dispatch(method, paramsMap)
        }

        return when (result) {
            is BridgeResult.Success -> {
                val resp = JSONObject()
                resp.put("success", true)
                resp.put("data", result.data)
                resp.toString()
            }
            is BridgeResult.Error -> {
                val resp = JSONObject()
                resp.put("success", false)
                resp.put("error", JSONObject().apply {
                    put("code", result.code)
                    put("message", result.message)
                })
                resp.toString()
            }
        }
    }
}
