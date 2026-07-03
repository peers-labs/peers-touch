package com.peerstouch.mobile.core.applet

import android.content.ComponentCallbacks2
import com.peerstouch.mobile.core.applet.kernel.AppletInstanceRegistry
import com.peerstouch.mobile.core.applet.kernel.AppletKernel
import com.peerstouch.mobile.core.applet.kernel.AppletLifecycleOrchestrator
import com.peerstouch.mobile.core.applet.kernel.AppletResourcePolicy
import com.peerstouch.mobile.core.applet.kernel.AppletResourceScheduler
import com.peerstouch.mobile.core.applet.kernel.AppletSurfaceController
import com.peerstouch.mobile.core.applet.kernel.MemoryPressureLevel
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
    private val bridgeDispatcher: BridgeDispatcher,
    surfaceController: AppletSurfaceController
) {
    private val platformVersion = "0.1.0"

    private val applets = mutableMapOf<String, AppletInfo>()
    private val sessions = mutableMapOf<String, AppletBridgeSession>()
    private val rejectedDiagnostics = mutableMapOf<String, List<String>>()
    private val registry = AppletInstanceRegistry()
    private val kernel = AppletKernel(
        registry = registry,
        orchestrator = AppletLifecycleOrchestrator(
            registry = registry,
            surfaceController = surfaceController,
            sessionLifecycleDispatcher = { appletId, event, resumeTarget ->
                sessions[appletId]?.dispatchLifecycle(event, resumeTarget)
                notifyStateChange()
            },
            sessionDestroyer = { appletId ->
                destroySessionOnly(appletId)
                notifyStateChange()
            }
        ),
        scheduler = AppletResourceScheduler(registry, AppletResourcePolicy.MOBILE)
    )

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

            if ("android" !in manifest.targets) {
                rejectedDiagnostics[manifest.id] = listOf("Applet does not target android platform")
                return@forEach
            }

            val bundlePath = appletBundleStorage.getBundlePath(manifest.id)
            applets[manifest.id] = AppletInfo(
                manifest = manifest,
                main = manifest.load.android?.entry ?: "",
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
        if (existing != null && existing.state != AppletState.DESTROYED) {
            val target = kernel.recordForApplet(id)
            when (existing.state) {
                AppletState.HIDDEN_WARM -> target?.let { kernel.dispatchApplet(id, AppletLifecycleEvent.SHOW, "load-visible") }
                AppletState.PAUSED -> target?.let { kernel.dispatchApplet(id, AppletLifecycleEvent.RESUME, "load-resume") }
                AppletState.SUSPENDED -> target?.let { kernel.dispatchApplet(id, AppletLifecycleEvent.RESTORE, "load-restore") }
                else -> Unit
            }
            return existing
        }

        val session = AppletBridgeSession(info.manifest, bridgeDispatcher)
        session.dispatchLifecycle(AppletLifecycleEvent.LAUNCH)
        sessions[id] = session
        val target = kernel.registerMaterializing(
            manifest = info.manifest,
            instanceId = id,
            sessionId = session.sessionId
        )
        kernel.dispatch(target, AppletLifecycleEvent.READY, "load-ready")
        notifyStateChange()

        return session
    }

    fun unloadApplet(id: String) {
        kernel.dispatchApplet(id, AppletLifecycleEvent.DESTROY, "explicit-unload")
    }

    fun hideApplet(id: String) {
        val session = sessions[id] ?: return
        if (session.state == AppletState.VISIBLE) {
            kernel.dispatchApplet(id, AppletLifecycleEvent.HIDE, "surface-hidden")
        }
    }

    fun showApplet(id: String) {
        val session = sessions[id] ?: return
        when (session.state) {
            AppletState.HIDDEN_WARM -> kernel.dispatchApplet(id, AppletLifecycleEvent.SHOW, "surface-visible")
            AppletState.PAUSED -> kernel.dispatchApplet(id, AppletLifecycleEvent.RESUME, "surface-visible")
            AppletState.SUSPENDED -> kernel.dispatchApplet(id, AppletLifecycleEvent.RESTORE, "surface-visible")
            else -> Unit
        }
    }

    fun pauseApplet(id: String) {
        val session = sessions[id] ?: return
        if (session.state == AppletState.VISIBLE || session.state == AppletState.HIDDEN_WARM) {
            kernel.dispatchApplet(id, AppletLifecycleEvent.PAUSE, "app-background")
        }
    }

    fun resumeApplet(id: String) {
        val session = sessions[id] ?: return
        if (session.state == AppletState.PAUSED) {
            kernel.dispatchApplet(id, AppletLifecycleEvent.RESUME, "app-foreground")
        }
    }

    fun runResourceSweep() {
        kernel.sweep()
    }

    fun handleMemoryPressure(level: MemoryPressureLevel) {
        kernel.handleMemoryPressure(level)
    }

    fun handleTrimMemory(level: Int) {
        val pressure = when {
            level >= ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> MemoryPressureLevel.CRITICAL
            level >= ComponentCallbacks2.TRIM_MEMORY_MODERATE -> MemoryPressureLevel.MODERATE
            else -> MemoryPressureLevel.LOW
        }
        handleMemoryPressure(pressure)
    }

    fun getApplet(id: String): AppletBridgeSession? = sessions[id]

    fun getAppletInfo(id: String): AppletInfo? = applets[id]

    fun getLoadedApplets(): List<AppletBridgeSession> {
        return sessions.values.filter {
            it.state != AppletState.DESTROYED
        }
    }

    fun getAvailableApplets(): List<AppletInfo> = applets.values.toList()

    fun getDiagnostics(): List<AppletDiagnostic> {
        return rejectedDiagnostics.map { (source, issues) ->
            AppletDiagnostic(source = source, issues = issues)
        }
    }

    fun clear() {
        kernel.clear()
        sessions.clear()
        notifyStateChange()
    }

    private fun destroySessionOnly(id: String) {
        val session = sessions[id] ?: return
        session.destroy()
        sessions.remove(id)
    }

    private fun notifyStateChange() {
        _sessionsState.value = sessions.toMap()
    }
}
