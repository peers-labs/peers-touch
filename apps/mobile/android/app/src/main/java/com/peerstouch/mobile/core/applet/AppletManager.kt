package com.peerstouch.mobile.core.applet

import com.peerstouch.mobile.core.lynx.bridge.BridgeDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
data class AppletDiagnostic(
    val source: String,
    val issues: List<String>
)

class AppletManager constructor(
    private val appletBundleStorage: AppletBundleStorage,
    private val bridgeDispatcher: BridgeDispatcher
) {
    private val platformVersion = "0.1.0"

    private val applets = mutableMapOf<String, AppletInfo>()
    private val sessions = mutableMapOf<String, AppletBridgeSession>()
    private val rejectedDiagnostics = mutableMapOf<String, List<String>>()

    private val _sessionsState = MutableStateFlow<Map<String, AppletBridgeSession>>(emptyMap())
    val sessionsState: StateFlow<Map<String, AppletBridgeSession>> = _sessionsState.asStateFlow()

    fun scanLocalApplets(): List<AppletManifest> {
        rejectedDiagnostics.clear()
        applets.clear()

        val cached = appletBundleStorage.listCachedBundles()
        cached.forEach { manifest ->
            if (applets.containsKey(manifest.id)) {
                rejectedDiagnostics[manifest.id] = listOf("Duplicate applet ID: ${manifest.id}")
                return@forEach
            }

            if (manifest.targetPlatforms != null && "mobile" !in manifest.targetPlatforms) {
                rejectedDiagnostics[manifest.id] = listOf("Applet does not target mobile platform")
                return@forEach
            }

            val bundlePath = appletBundleStorage.getBundlePath(manifest.id)
            applets[manifest.id] = AppletInfo(
                manifest = manifest,
                main = manifest.load.entry,
                path = bundlePath?.path ?: ""
            )
        }

        return applets.values.map { it.manifest }
    }

    fun loadApplet(id: String): AppletBridgeSession {
        val info = applets[id]
        if (info == null) {
            val rejectedIssues = rejectedDiagnostics[id]
            if (rejectedIssues != null) {
                throw IllegalStateException("Applet $id is invalid:\n${rejectedIssues.joinToString("\n")}")
            }
            throw IllegalArgumentException("Applet $id not found")
        }

        if (info.manifest.minPlatformVersion != null) {
            if (AppletManifestParser.compareSemver(info.manifest.minPlatformVersion, platformVersion) > 0) {
                throw IllegalStateException(
                    "Requires platform version ${info.manifest.minPlatformVersion}, current is $platformVersion"
                )
            }
        }

        val existing = sessions[id]
        if (existing != null && existing.state != AppletState.UNLOADED && existing.state != AppletState.ERROR) {
            return existing
        }

        val session = AppletBridgeSession(info.manifest, bridgeDispatcher)
        session.transition(AppletState.LOADING)
        session.transition(AppletState.READY)

        sessions[id] = session
        notifyStateChange()

        return session
    }

    fun unloadApplet(id: String) {
        val session = sessions[id] ?: return
        session.transition(AppletState.UNLOADED)
        sessions.remove(id)
        notifyStateChange()
    }

    fun getApplet(id: String): AppletBridgeSession? = sessions[id]

    fun getAppletInfo(id: String): AppletInfo? = applets[id]

    fun getLoadedApplets(): List<AppletBridgeSession> {
        return sessions.values.filter {
            it.state != AppletState.UNLOADED && it.state != AppletState.ERROR
        }
    }

    fun getAvailableApplets(): List<AppletInfo> = applets.values.toList()

    fun getDiagnostics(): List<AppletDiagnostic> {
        return rejectedDiagnostics.map { (source, issues) ->
            AppletDiagnostic(source = source, issues = issues)
        }
    }

    fun clear() {
        sessions.values.forEach { it.transition(AppletState.UNLOADED) }
        sessions.clear()
        notifyStateChange()
    }

    private fun notifyStateChange() {
        _sessionsState.value = sessions.toMap()
    }
}
