package com.carrel.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.carrel.app.core.auth.OAuthCallbackResult
import com.carrel.app.core.auth.OAuthHandler
import com.carrel.app.ui.navigation.NavGraph
import com.carrel.app.ui.theme.CarrelTheme
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val container by lazy { (application as CarrelApplication).container }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Handle OAuth callback from deep link
        handleIntent(intent)

        setContent {
            val isAuthenticated by container.authManager.isAuthenticated.collectAsState()

            // Load stored tokens and restore auth on startup
            LaunchedEffect(Unit) {
                val convexToken = container.authManager.loadStoredTokens()
                if (convexToken != null) {
                    // Restore Convex Auth session
                    Log.d(TAG, "Restoring Convex Auth session")
                    val success = container.convexService.restoreAuthFromCache(convexToken)
                    if (!success) {
                        Log.w(TAG, "Failed to restore Convex Auth session, token may be invalid")
                        // Try silent refresh
                        val refreshed = container.authManager.refreshTokenSilently()
                        if (refreshed) {
                            // Try again with new token
                            container.authManager.getConvexAuthToken()?.let { newToken ->
                                container.convexService.restoreAuthFromCache(newToken)
                            }
                        } else {
                            // Token is invalid - will require re-login
                            container.authManager.logout()
                        }
                    }
                }
            }

            CarrelTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    NavGraph(
                        isAuthenticated = isAuthenticated,
                        container = container
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "carrel" || uri.host != "auth") return

        Log.d(TAG, "Handling OAuth callback: $uri")

        when (val result = OAuthHandler.parseCallbackUri(uri)) {
            is OAuthCallbackResult.ConvexAuth -> {
                Log.d(TAG, "Received Convex Auth token, exchanging for 90-day token...")
                // Handle OAuth login (GitHub/GitLab)
                // Exchange token and set up ConvexService with the exchanged token
                MainScope().launch {
                    container.authManager.handleConvexAuthCallback(result.token)

                    // Use the exchanged token (or original if exchange failed)
                    val tokenToUse = container.authManager.getConvexAuthToken()
                    if (tokenToUse != null) {
                        val success = container.convexService.setAuthToken(tokenToUse)
                        if (success) {
                            Log.d(TAG, "Convex Auth setup successful")
                        } else {
                            Log.e(TAG, "Convex Auth setup failed")
                        }
                    }
                }
            }

            is OAuthCallbackResult.JwtAuth -> {
                Log.d(TAG, "Received JWT tokens (email login)")
                // Handle email/password login (HTTP-based, no subscriptions)
                container.authManager.handleOAuthCallback(
                    accessToken = result.accessToken,
                    refreshToken = result.refreshToken,
                    expiresAt = result.expiresAt,
                    refreshExpiresAt = result.refreshExpiresAt
                )
            }

            is OAuthCallbackResult.Error -> {
                Log.e(TAG, "OAuth error: ${result.message}")
            }

            null -> {
                Log.w(TAG, "Failed to parse OAuth callback")
            }
        }
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
