package com.peerstouch.mobile.core.applet.kernel

import com.peerstouch.mobile.core.applet.AppletLifecycleEvent
import com.peerstouch.mobile.core.applet.AppletManifest
import com.peerstouch.mobile.core.applet.AppletState

class AppletKernel(
    private val registry: AppletInstanceRegistry,
    private val orchestrator: AppletLifecycleOrchestrator,
    private val scheduler: AppletResourceScheduler,
    private val clock: () -> Long = System::currentTimeMillis
) {
    fun registerMaterializing(
        manifest: AppletManifest,
        instanceId: String,
        sessionId: String
    ): AppletLifecycleTarget {
        val existing = registry.get(manifest.id, instanceId)
        if (existing != null) {
            return existing.toTarget()
        }
        val record = registry.create(
            appletId = manifest.id,
            instanceId = instanceId,
            sessionId = sessionId,
            manifestVersion = manifest.version,
            timestampMs = clock()
        )
        return record.toTarget()
    }

    fun dispatch(target: AppletLifecycleTarget, event: AppletLifecycleEvent, reason: String? = null) {
        orchestrator.dispatch(
            AppletLifecycleSignal(
                target = target,
                event = event,
                timestampMs = clock(),
                reason = reason
            )
        )
        runSignals(scheduler.evaluateAfterStateChange(clock()))
    }

    fun dispatchApplet(appletId: String, event: AppletLifecycleEvent, reason: String? = null) {
        val target = registry.getByAppletId(appletId)?.toTarget() ?: return
        dispatch(target, event, reason)
    }

    fun sweep() {
        runSignals(scheduler.sweep(clock()))
    }

    fun handleMemoryPressure(level: MemoryPressureLevel) {
        runSignals(scheduler.handleMemoryPressure(level, clock()))
    }

    fun recordForApplet(appletId: String): AppletInstanceRecord? =
        registry.getByAppletId(appletId)

    fun records(): List<AppletInstanceRecord> = registry.all()

    fun clear() {
        registry.all()
            .filter { it.state != AppletState.DESTROYED }
            .map { it.toTarget() }
            .forEach { target ->
                orchestrator.dispatch(
                    AppletLifecycleSignal(
                        target = target,
                        event = AppletLifecycleEvent.DESTROY,
                        timestampMs = clock(),
                        reason = "clear"
                    )
                )
            }
        registry.clear()
    }

    private fun runSignals(signals: List<AppletLifecycleSignal>) {
        signals.forEach { signal ->
            orchestrator.dispatch(signal)
        }
    }

    private fun AppletInstanceRecord.toTarget(): AppletLifecycleTarget =
        AppletLifecycleTarget(
            appletId = appletId,
            instanceId = instanceId,
            sessionId = sessionId
        )
}
