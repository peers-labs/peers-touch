package com.peerstouch.mobile.navigation

sealed class Routes(val route: String) {
    data object Chat : Routes("chat")
    data object AI : Routes("ai")
    data object Applets : Routes("applets")
    data object Search : Routes("search")
    data object Profile : Routes("profile")
    data object Settings : Routes("settings")
    data object Auth : Routes("auth")
    data object Memory : Routes("memory")
    data object Timeline : Routes("timeline")
    data object Channels : Routes("channels")
    data object Skills : Routes("skills")
    data object AppletDetail : Routes("applet_detail/{appletId}") {
        fun createRoute(appletId: String): String = "applet_detail/$appletId"
    }
}
