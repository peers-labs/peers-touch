package com.peerstouch.mobile.core.applet

enum class AppletState {
    COLD,
    MATERIALIZING,
    VISIBLE,
    HIDDEN_WARM,
    PAUSED,
    SUSPENDED,
    DESTROYED
}

enum class AppletLifecycleEvent {
    LAUNCH,
    READY,
    SHOW,
    HIDE,
    PAUSE,
    RESUME,
    SUSPEND,
    RESTORE,
    DESTROY,
    ERROR
}

fun AppletState.canTransition(event: AppletLifecycleEvent): Boolean =
    when (event) {
        AppletLifecycleEvent.LAUNCH -> this == AppletState.COLD
        AppletLifecycleEvent.READY -> this == AppletState.MATERIALIZING
        AppletLifecycleEvent.SHOW -> this == AppletState.HIDDEN_WARM || this == AppletState.PAUSED || this == AppletState.SUSPENDED
        AppletLifecycleEvent.HIDE -> this == AppletState.VISIBLE
        AppletLifecycleEvent.PAUSE -> this == AppletState.VISIBLE || this == AppletState.HIDDEN_WARM
        AppletLifecycleEvent.RESUME -> this == AppletState.PAUSED
        AppletLifecycleEvent.SUSPEND -> this == AppletState.HIDDEN_WARM || this == AppletState.PAUSED
        AppletLifecycleEvent.RESTORE -> this == AppletState.SUSPENDED
        AppletLifecycleEvent.DESTROY, AppletLifecycleEvent.ERROR -> this != AppletState.COLD && this != AppletState.DESTROYED
    }

fun AppletState.nextState(event: AppletLifecycleEvent, resumeTarget: AppletState = AppletState.VISIBLE): AppletState {
    require(canTransition(event)) { "Invalid applet lifecycle transition: $this + $event" }
    return when (event) {
        AppletLifecycleEvent.LAUNCH -> AppletState.MATERIALIZING
        AppletLifecycleEvent.READY -> AppletState.VISIBLE
        AppletLifecycleEvent.SHOW -> AppletState.VISIBLE
        AppletLifecycleEvent.HIDE -> AppletState.HIDDEN_WARM
        AppletLifecycleEvent.PAUSE -> AppletState.PAUSED
        AppletLifecycleEvent.RESUME -> resumeTarget
        AppletLifecycleEvent.SUSPEND -> AppletState.SUSPENDED
        AppletLifecycleEvent.RESTORE -> AppletState.VISIBLE
        AppletLifecycleEvent.DESTROY, AppletLifecycleEvent.ERROR -> AppletState.DESTROYED
    }
}
