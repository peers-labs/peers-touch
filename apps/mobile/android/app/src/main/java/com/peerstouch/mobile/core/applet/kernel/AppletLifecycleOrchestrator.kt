package com.peerstouch.mobile.core.applet.kernel

import com.peerstouch.mobile.core.applet.AppletLifecycleEvent
import com.peerstouch.mobile.core.applet.AppletState
import com.peerstouch.mobile.core.applet.nextState

class AppletLifecycleOrchestrator(
    private val registry: AppletInstanceRegistry,
    private val surfaceController: AppletSurfaceController,
    private val sessionLifecycleDispatcher: (String, AppletLifecycleEvent, AppletState) -> Unit,
    private val sessionDestroyer: (String) -> Unit
) {
    fun dispatch(signal: AppletLifecycleSignal): AppletInstanceRecord? {
        val current = registry.get(signal.target.appletId, signal.target.instanceId) ?: return null
        val nextState = current.state.nextState(signal.event, current.resumeTarget)
        val nextRecord = current.toTransitionedRecord(signal, nextState)

        if (nextState == AppletState.DESTROYED) {
            sessionLifecycleDispatcher(signal.target.appletId, signal.event, current.resumeTarget)
            sessionDestroyer(signal.target.appletId)
            registry.remove(signal.target.appletId, signal.target.instanceId)
            surfaceController.applySurfaceCommand(SurfaceCommand.DESTROY, signal.target)
            return nextRecord
        }

        sessionLifecycleDispatcher(signal.target.appletId, signal.event, current.resumeTarget)
        registry.update(nextRecord)
        applySurfaceSideEffect(signal)
        return nextRecord
    }

    private fun AppletInstanceRecord.toTransitionedRecord(
        signal: AppletLifecycleSignal,
        nextState: AppletState
    ): AppletInstanceRecord {
        val timestampMs = signal.timestampMs
        val nextCrashCount = if (signal.event == AppletLifecycleEvent.ERROR) crashCount + 1 else crashCount
        val nextResumeTarget = when (signal.event) {
            AppletLifecycleEvent.PAUSE -> state
            AppletLifecycleEvent.RESUME -> AppletState.VISIBLE
            else -> resumeTarget
        }
        return copy(
            state = nextState,
            lastVisibleAtMs = if (nextState == AppletState.VISIBLE) timestampMs else lastVisibleAtMs,
            lastHiddenAtMs = if (nextState == AppletState.HIDDEN_WARM || nextState == AppletState.PAUSED) {
                timestampMs
            } else {
                lastHiddenAtMs
            },
            lastTouchedAtMs = timestampMs,
            crashCount = nextCrashCount,
            resumeTarget = nextResumeTarget
        )
    }

    private fun applySurfaceSideEffect(signal: AppletLifecycleSignal) {
        when (signal.event) {
            AppletLifecycleEvent.READY,
            AppletLifecycleEvent.SHOW,
            AppletLifecycleEvent.RESTORE,
            AppletLifecycleEvent.RESUME -> surfaceController.applySurfaceCommand(SurfaceCommand.SHOW, signal.target)
            AppletLifecycleEvent.HIDE -> surfaceController.applySurfaceCommand(SurfaceCommand.HIDE, signal.target)
            AppletLifecycleEvent.SUSPEND -> surfaceController.applySurfaceCommand(SurfaceCommand.DETACH, signal.target)
            AppletLifecycleEvent.DESTROY,
            AppletLifecycleEvent.ERROR -> surfaceController.applySurfaceCommand(SurfaceCommand.DESTROY, signal.target)
            AppletLifecycleEvent.LAUNCH,
            AppletLifecycleEvent.PAUSE -> Unit
        }
    }
}
