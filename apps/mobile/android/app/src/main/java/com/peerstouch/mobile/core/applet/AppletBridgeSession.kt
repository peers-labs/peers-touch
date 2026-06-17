package com.peerstouch.mobile.core.applet

import com.peerstouch.mobile.core.lynx.bridge.BridgeDispatcher
import com.peerstouch.mobile.core.lynx.bridge.BridgeResult
import com.peerstouch.mobile.core.lynx.bridge.MANIFEST_SERVICES_PARAM
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class AppletBridgeSession(
    val manifest: AppletManifest,
    private val bridgeDispatcher: BridgeDispatcher
) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val loadedAt: Long = System.currentTimeMillis()
    val sessionId: String = "android:${manifest.id}:$loadedAt"

    var state: AppletState = AppletState.REGISTERED
        private set

    private val grantedPermissions: Set<String> = manifest.permissions.toSet()

    fun transition(to: AppletState) {
        state = to
    }

    suspend fun dispatch(module: String, method: String, params: Map<String, Any?>): BridgeResult {
        if (state == AppletState.UNLOADED) {
            return BridgeResult.Error(
                "INVALID_SESSION",
                "BridgeSession for applet ${manifest.id} is unloaded"
            )
        }
        val api = "$module.$method"
        if (!hasPermission(module, api)) {
            return BridgeResult.Error(
                "PERMISSION_DENIED",
                "Applet ${manifest.id} lacks permission for capability: $api"
            )
        }
        return bridgeDispatcher.invoke(module, method, withManifestContext(api, params))
    }

    suspend fun dispatch(api: String, params: Map<String, Any?>): BridgeResult {
        if (state == AppletState.UNLOADED) {
            return BridgeResult.Error(
                "INVALID_SESSION",
                "BridgeSession for applet ${manifest.id} is unloaded"
            )
        }
        val components = api.split(".", limit = 2)
        if (components.size == 2) {
            val module = components[0]
            if (!hasPermission(module, api)) {
                return BridgeResult.Error(
                    "PERMISSION_DENIED",
                    "Applet ${manifest.id} lacks permission for capability: $api"
                )
            }
        }
        return bridgeDispatcher.invoke(api, withManifestContext(api, params))
    }

    private fun withManifestContext(api: String, params: Map<String, Any?>): Map<String, Any?> {
        if (api != "network.request") return params
        return params + (MANIFEST_SERVICES_PARAM to manifest.services)
    }

    private fun hasPermission(module: String, api: String): Boolean =
        grantedPermissions.contains("*") ||
            grantedPermissions.contains(api) ||
            grantedPermissions.contains(module) ||
            grantedPermissions.any { permission -> permission.endsWith(".*") && api.startsWith(permission.removeSuffix("*")) }
}
