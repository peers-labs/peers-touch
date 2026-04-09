package com.peerstouch.mobile.core.applet

import com.peerstouch.mobile.core.lynx.bridge.BridgeDispatcher
import com.peerstouch.mobile.core.lynx.bridge.BridgeResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class AppletBridgeSession(
    val manifest: AppletManifest,
    private val bridgeDispatcher: BridgeDispatcher
) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    val loadedAt: Long = System.currentTimeMillis()

    var state: AppletState = AppletState.REGISTERED
        private set

    private val grantedPermissions: Set<String> = manifest.permissions.toSet()

    fun transition(to: AppletState) {
        state = to
    }

    suspend fun dispatch(module: String, method: String, params: Map<String, Any?>): BridgeResult {
        check(state != AppletState.UNLOADED) { "BridgeSession for applet ${manifest.id} is unloaded" }
        checkPermission(module)
        return bridgeDispatcher.invoke(module, method, params)
    }

    suspend fun dispatch(api: String, params: Map<String, Any?>): BridgeResult {
        check(state != AppletState.UNLOADED) { "BridgeSession for applet ${manifest.id} is unloaded" }
        val components = api.split(".", limit = 2)
        if (components.size == 2) {
            checkPermission(components[0])
        }
        return bridgeDispatcher.invoke(api, params)
    }

    private fun checkPermission(module: String) {
        if (grantedPermissions.contains("*")) return
        if (!grantedPermissions.contains(module)) {
            throw SecurityException("Applet ${manifest.id} lacks permission for module: $module")
        }
    }
}
