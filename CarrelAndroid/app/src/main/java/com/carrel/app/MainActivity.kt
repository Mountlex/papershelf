package com.carrel.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import com.carrel.app.ui.navigation.NavGraph
import com.carrel.app.ui.theme.CarrelTheme

class MainActivity : ComponentActivity() {
    private val container by lazy { (application as CarrelApplication).container }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Handle OAuth callback from deep link
        handleIntent(intent)

        setContent {
            val isAuthenticated by container.authManager.isAuthenticated.collectAsState()

            LaunchedEffect(Unit) {
                container.authManager.loadStoredTokens()
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
        if (uri.scheme == "carrel" && uri.host == "auth") {
            val accessToken = uri.getQueryParameter("accessToken")
            val refreshToken = uri.getQueryParameter("refreshToken")
            val expiresAt = uri.getQueryParameter("expiresAt")?.toLongOrNull()
            val refreshExpiresAt = uri.getQueryParameter("refreshExpiresAt")?.toLongOrNull()

            if (accessToken != null && expiresAt != null) {
                container.authManager.handleOAuthCallback(
                    accessToken = accessToken,
                    refreshToken = refreshToken,
                    expiresAt = expiresAt,
                    refreshExpiresAt = refreshExpiresAt
                )
            }
        }
    }
}
