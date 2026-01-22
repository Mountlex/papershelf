package com.carrel.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.carrel.app.core.di.AppContainer
import com.carrel.app.features.auth.LoginScreen
import com.carrel.app.features.gallery.GalleryScreen
import com.carrel.app.features.paper.PaperDetailScreen
import com.carrel.app.features.settings.SettingsScreen

sealed class Screen(val route: String) {
    data object Login : Screen("login")
    data object Gallery : Screen("gallery")
    data object Settings : Screen("settings")
    data object PaperDetail : Screen("paper/{paperId}") {
        fun createRoute(paperId: String) = "paper/$paperId"
    }
}

@Composable
fun NavGraph(
    isAuthenticated: Boolean,
    container: AppContainer
) {
    val navController = rememberNavController()
    val startDestination = if (isAuthenticated) Screen.Gallery.route else Screen.Login.route

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Login.route) {
            LoginScreen(
                oAuthHandler = container.oAuthHandler
            )
        }

        composable(Screen.Gallery.route) {
            GalleryScreen(
                convexClient = container.convexClient,
                authManager = container.authManager,
                onPaperClick = { paperId ->
                    navController.navigate(Screen.PaperDetail.createRoute(paperId))
                },
                onSettingsClick = {
                    navController.navigate(Screen.Settings.route)
                }
            )
        }

        composable(
            route = Screen.PaperDetail.route,
            arguments = listOf(
                navArgument("paperId") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val paperId = backStackEntry.arguments?.getString("paperId") ?: return@composable
            PaperDetailScreen(
                paperId = paperId,
                convexClient = container.convexClient,
                onBackClick = { navController.popBackStack() }
            )
        }

        composable(Screen.Settings.route) {
            SettingsScreen(
                convexClient = container.convexClient,
                authManager = container.authManager,
                onBackClick = { navController.popBackStack() }
            )
        }
    }
}
