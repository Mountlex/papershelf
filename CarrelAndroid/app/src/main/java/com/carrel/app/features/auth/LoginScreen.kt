package com.carrel.app.features.auth

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.auth.OAuthHandler
import com.carrel.app.core.auth.OAuthProvider
import com.carrel.app.core.network.ConvexService
import kotlinx.coroutines.launch

@Composable
fun LoginScreen(
    oAuthHandler: OAuthHandler,
    authManager: AuthManager? = null,
    convexService: ConvexService? = null,
    useWebView: Boolean = true // Use WebView by default (works better in emulators)
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    // Activity result launcher for WebView login
    val webViewLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val token = result.data?.getStringExtra(WebViewLoginActivity.EXTRA_TOKEN)
            if (token != null && authManager != null && convexService != null) {
                // Handle the token
                authManager.handleConvexAuthCallback(token)
                scope.launch {
                    convexService.setAuthToken(token)
                }
            }
        }
    }

    fun launchLogin(provider: OAuthProvider) {
        if (useWebView) {
            val intent = WebViewLoginActivity.createIntent(context, provider.id)
            webViewLauncher.launch(intent)
        } else {
            oAuthHandler.launchOAuth(provider)
        }
    }
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF1A1A2E),
                        Color(0xFF25253D)
                    )
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            Spacer(modifier = Modifier.weight(1f))

            // Logo and title
            Icon(
                imageVector = Icons.Default.Cloud,
                contentDescription = null,
                modifier = Modifier.size(80.dp),
                tint = Color.White
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Carrel",
                fontSize = 42.sp,
                fontWeight = FontWeight.Bold,
                color = Color.White
            )

            Text(
                text = "Your paper gallery",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.7f)
            )

            Spacer(modifier = Modifier.weight(1f))

            // Sign in buttons - all use web flow for Convex Auth token
            SignInButton(
                provider = OAuthProvider.EMAIL,
                icon = Icons.Default.Email,
                onClick = { launchLogin(OAuthProvider.EMAIL) }
            )

            Spacer(modifier = Modifier.height(16.dp))

            SignInButton(
                provider = OAuthProvider.GITHUB,
                icon = Icons.Default.Cloud,
                onClick = { launchLogin(OAuthProvider.GITHUB) }
            )

            Spacer(modifier = Modifier.height(16.dp))

            SignInButton(
                provider = OAuthProvider.GITLAB,
                icon = Icons.Default.Code,
                onClick = { launchLogin(OAuthProvider.GITLAB) }
            )

            Spacer(modifier = Modifier.height(60.dp))
        }
    }
}

@Composable
private fun SignInButton(
    provider: OAuthProvider,
    icon: ImageVector,
    onClick: () -> Unit
) {
    FilledTonalButton(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = Color.White.copy(alpha = 0.1f),
            contentColor = Color.White
        )
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(24.dp)
        )
        Spacer(modifier = Modifier.width(12.dp))
        Text(
            text = "Sign in with ${provider.displayName}",
            style = MaterialTheme.typography.titleMedium
        )
    }
}
