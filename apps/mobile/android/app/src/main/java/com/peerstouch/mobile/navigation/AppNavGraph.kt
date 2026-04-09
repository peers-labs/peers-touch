package com.peerstouch.mobile.navigation

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.peerstouch.mobile.features.ai.ui.AIScreen
import com.peerstouch.mobile.features.applets.ui.AppletsScreen
import com.peerstouch.mobile.features.auth.ui.AuthScreen
import com.peerstouch.mobile.features.channels.ui.ChannelsScreen
import com.peerstouch.mobile.features.chat.ui.ChatScreen
import com.peerstouch.mobile.features.memory.ui.MemoryScreen
import com.peerstouch.mobile.features.profile.ui.ProfileScreen
import com.peerstouch.mobile.features.search.ui.SearchScreen
import com.peerstouch.mobile.features.settings.ui.SettingsScreen
import com.peerstouch.mobile.features.skills.ui.SkillsScreen
import com.peerstouch.mobile.features.timeline.ui.TimelineScreen
import com.peerstouch.mobile.core.applet.ui.AppletContainerView

@Composable
fun AppNavGraph() {
    val navController = rememberNavController()
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    val bottomBarRoutes = listOf(
        Routes.Chat.route,
        Routes.AI.route,
        Routes.Applets.route,
        Routes.Search.route,
        Routes.Profile.route
    )

    Scaffold(
        bottomBar = {
            if (currentRoute in bottomBarRoutes) {
                BottomNavBar(
                    currentRoute = currentRoute,
                    onNavigate = { route ->
                        navController.navigate(route) {
                            popUpTo(Routes.Chat.route) { saveState = true }
                            launchSingleTop = true
                            restoreState = true
                        }
                    }
                )
            }
        }
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Routes.Chat.route,
            modifier = Modifier.padding(innerPadding)
        ) {
            composable(Routes.Chat.route) { ChatScreen(navController) }
            composable(Routes.AI.route) { AIScreen(navController) }
            composable(Routes.Applets.route) { AppletsScreen(navController) }
            composable(Routes.Search.route) { SearchScreen(navController) }
            composable(Routes.Profile.route) { ProfileScreen(navController) }
            composable(Routes.Settings.route) { SettingsScreen(navController) }
            composable(Routes.Auth.route) { AuthScreen(navController) }
            composable(Routes.Memory.route) { MemoryScreen(navController) }
            composable(Routes.Timeline.route) { TimelineScreen(navController) }
            composable(Routes.Channels.route) { ChannelsScreen(navController) }
            composable(Routes.Skills.route) { SkillsScreen(navController) }
            composable(
                route = Routes.AppletDetail.route,
                arguments = listOf(navArgument("appletId") { type = NavType.StringType })
            ) { backStackEntry ->
                val appletId = backStackEntry.arguments?.getString("appletId") ?: return@composable
                AppletContainerView(appletId = appletId)
            }
        }
    }
}
