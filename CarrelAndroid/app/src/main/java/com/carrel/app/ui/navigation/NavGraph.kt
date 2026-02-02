package com.carrel.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.carrel.app.core.di.AppContainer
import com.carrel.app.core.network.models.Repository
import com.carrel.app.features.auth.EmailLoginScreen
import com.carrel.app.features.auth.LoginScreen
import com.carrel.app.features.gallery.GalleryScreen
import com.carrel.app.features.paper.PaperDetailScreen
import com.carrel.app.features.repositories.AddPaperFromRepoScreen
import com.carrel.app.features.repositories.RepositoryListScreen
import com.carrel.app.features.settings.SettingsScreen
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.URLDecoder
import java.net.URLEncoder

sealed class Screen(val route: String) {
    data object Login : Screen("login")
    data object EmailLogin : Screen("email-login")
    data object Gallery : Screen("gallery")
    data object Settings : Screen("settings")
    data object Repositories : Screen("repositories")
    data object PaperDetail : Screen("paper/{paperId}") {
        fun createRoute(paperId: String) = "paper/$paperId"
    }
    data object AddPaperFromRepo : Screen("add-paper/{repoJson}") {
        fun createRoute(repository: Repository): String {
            val json = Json.encodeToString(repository)
            val encoded = URLEncoder.encode(json, "UTF-8")
            return "add-paper/$encoded"
        }
    }
}

@Composable
fun NavGraph(
    isAuthenticated: Boolean,
    container: AppContainer
) {
    val navController = rememberNavController()
    val startDestination = if (isAuthenticated) Screen.Gallery.route else Screen.Login.route

    // Handle auth state changes - navigate to appropriate screen
    LaunchedEffect(isAuthenticated) {
        if (isAuthenticated) {
            // Clear back stack and go to Gallery
            navController.navigate(Screen.Gallery.route) {
                popUpTo(0) { inclusive = true }
            }
        } else {
            // Clear back stack and go to Login
            navController.navigate(Screen.Login.route) {
                popUpTo(0) { inclusive = true }
            }
        }
    }

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.Login.route) {
            LoginScreen(
                oAuthHandler = container.oAuthHandler,
                onEmailLoginClick = {
                    navController.navigate(Screen.EmailLogin.route)
                }
            )
        }

        composable(Screen.EmailLogin.route) {
            EmailLoginScreen(
                convexClient = container.convexClient,
                authManager = container.authManager,
                onBackClick = { navController.popBackStack() }
            )
        }

        composable(Screen.Gallery.route) {
            GalleryScreen(
                convexClient = container.convexClient,
                convexService = container.convexService,
                authManager = container.authManager,
                onPaperClick = { paperId ->
                    navController.navigate(Screen.PaperDetail.createRoute(paperId))
                },
                onSettingsClick = {
                    navController.navigate(Screen.Settings.route)
                },
                onRepositoriesClick = {
                    navController.navigate(Screen.Repositories.route)
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
                convexService = container.convexService,
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

        composable(Screen.Repositories.route) {
            RepositoryListScreen(
                convexClient = container.convexClient,
                authManager = container.authManager,
                onRepositoryClick = { repository ->
                    navController.navigate(Screen.AddPaperFromRepo.createRoute(repository))
                },
                onBackClick = { navController.popBackStack() }
            )
        }

        composable(
            route = Screen.AddPaperFromRepo.route,
            arguments = listOf(
                navArgument("repoJson") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val repoJson = backStackEntry.arguments?.getString("repoJson") ?: return@composable
            val decoded = URLDecoder.decode(repoJson, "UTF-8")
            val repository = Json.decodeFromString<Repository>(decoded)
            AddPaperFromRepoScreen(
                repository = repository,
                convexClient = container.convexClient,
                onBackClick = { navController.popBackStack() },
                onPaperAdded = {
                    // Navigate back to gallery after adding paper
                    navController.popBackStack(Screen.Gallery.route, inclusive = false)
                }
            )
        }
    }
}
