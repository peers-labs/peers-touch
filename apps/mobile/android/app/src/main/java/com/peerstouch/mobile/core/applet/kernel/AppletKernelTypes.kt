package com.peerstouch.mobile.core.applet.kernel

import com.peerstouch.mobile.core.applet.AppletLifecycleEvent
import com.peerstouch.mobile.core.applet.AppletState

data class AppletInstanceKey(
    val appletId: String,
    val instanceId: String
)

data class AppletInstanceRecord(
    val appletId: String,
    val instanceId: String,
    val sessionId: String,
    val state: AppletState,
    val createdAtMs: Long,
    val lastVisibleAtMs: Long,
    val lastHiddenAtMs: Long,
    val lastTouchedAtMs: Long,
    val memoryEstimateBytes: Long,
    val crashCount: Int,
    val manifestVersion: String,
    val resumeTarget: AppletState = AppletState.VISIBLE
)

data class AppletLifecycleTarget(
    val appletId: String,
    val instanceId: String,
    val sessionId: String
)

data class AppletLifecycleSignal(
    val target: AppletLifecycleTarget,
    val event: AppletLifecycleEvent,
    val timestampMs: Long,
    val reason: String? = null
)

enum class MemoryPressureLevel {
    LOW,
    MODERATE,
    CRITICAL
}

enum class SurfaceCommand {
    SHOW,
    HIDE,
    DETACH,
    DESTROY
}

interface AppletSurfaceController {
    fun applySurfaceCommand(command: SurfaceCommand, target: AppletLifecycleTarget)
}

data class AppletResourcePolicy(
    val lruSize: Int,
    val maxSuspended: Int,
    val hiddenWarmTtlMs: Long,
    val suspendedTtlMs: Long,
    val pausedTtlMs: Long
) {
    companion object {
        val MOBILE = AppletResourcePolicy(
            lruSize = 3,
            maxSuspended = 8,
            hiddenWarmTtlMs = 30L * 60L * 1000L,
            suspendedTtlMs = 120L * 60L * 1000L,
            pausedTtlMs = 15L * 60L * 1000L
        )
    }
}
