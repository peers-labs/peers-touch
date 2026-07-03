package com.peerstouch.mobile.core.applet.kernel

import com.peerstouch.mobile.core.applet.AppletLifecycleEvent
import com.peerstouch.mobile.core.applet.AppletState

class AppletResourceScheduler(
    private val registry: AppletInstanceRegistry,
    private val policy: AppletResourcePolicy = AppletResourcePolicy.MOBILE
) {
    fun evaluateAfterStateChange(timestampMs: Long): List<AppletLifecycleSignal> {
        val hiddenWarm = registry.all()
            .filter { it.state == AppletState.HIDDEN_WARM }
            .sortedBy { it.lastTouchedAtMs }

        val lruSignals = hiddenWarm
            .dropLast(policy.lruSize.coerceAtLeast(0))
            .map { it.toSignal(AppletLifecycleEvent.SUSPEND, timestampMs, "lru") }

        val suspendedOverflow = registry.all()
            .filter { it.state == AppletState.SUSPENDED }
            .sortedBy { it.lastTouchedAtMs }
            .dropLast(policy.maxSuspended.coerceAtLeast(0))
            .map { it.toSignal(AppletLifecycleEvent.DESTROY, timestampMs, "suspended-overflow") }

        return lruSignals + suspendedOverflow
    }

    fun sweep(timestampMs: Long): List<AppletLifecycleSignal> =
        registry.all().mapNotNull { record ->
            when (record.state) {
                AppletState.HIDDEN_WARM -> {
                    val anchor = record.lastHiddenAtMs.takeIf { it > 0L } ?: record.lastTouchedAtMs
                    if (timestampMs - anchor >= policy.hiddenWarmTtlMs) {
                        record.toSignal(AppletLifecycleEvent.SUSPEND, timestampMs, "hidden-warm-ttl")
                    } else {
                        null
                    }
                }
                AppletState.PAUSED -> {
                    val anchor = record.lastHiddenAtMs.takeIf { it > 0L } ?: record.lastTouchedAtMs
                    if (timestampMs - anchor >= policy.pausedTtlMs) {
                        record.toSignal(AppletLifecycleEvent.SUSPEND, timestampMs, "paused-ttl")
                    } else {
                        null
                    }
                }
                AppletState.SUSPENDED -> {
                    if (timestampMs - record.lastTouchedAtMs >= policy.suspendedTtlMs) {
                        record.toSignal(AppletLifecycleEvent.DESTROY, timestampMs, "suspended-ttl")
                    } else {
                        null
                    }
                }
                else -> null
            }
        } + evaluateAfterStateChange(timestampMs)

    fun handleMemoryPressure(level: MemoryPressureLevel, timestampMs: Long): List<AppletLifecycleSignal> =
        when (level) {
            MemoryPressureLevel.LOW -> emptyList()
            MemoryPressureLevel.MODERATE -> registry.all()
                .filter { it.state == AppletState.SUSPENDED }
                .minByOrNull { it.lastTouchedAtMs }
                ?.let { listOf(it.toSignal(AppletLifecycleEvent.DESTROY, timestampMs, "memory-pressure-moderate")) }
                ?: emptyList()
            MemoryPressureLevel.CRITICAL -> registry.all()
                .filter { it.state != AppletState.VISIBLE }
                .map { it.toSignal(AppletLifecycleEvent.DESTROY, timestampMs, "memory-pressure-critical") }
        }

    private fun AppletInstanceRecord.toSignal(
        event: AppletLifecycleEvent,
        timestampMs: Long,
        reason: String
    ): AppletLifecycleSignal =
        AppletLifecycleSignal(
            target = AppletLifecycleTarget(
                appletId = appletId,
                instanceId = instanceId,
                sessionId = sessionId
            ),
            event = event,
            timestampMs = timestampMs,
            reason = reason
        )
}
