package com.carrel.app.features.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudQueue
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.carrel.app.core.auth.OAuthHandler
import com.carrel.app.core.auth.OAuthProvider

@Composable
fun LoginScreen(
    oAuthHandler: OAuthHandler
) {
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
                imageVector = Icons.Default.CloudQueue,
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

            // Sign in buttons
            SignInButton(
                provider = OAuthProvider.GITHUB,
                icon = Icons.Default.CloudQueue,
                onClick = { oAuthHandler.launchOAuth(OAuthProvider.GITHUB) }
            )

            Spacer(modifier = Modifier.height(16.dp))

            SignInButton(
                provider = OAuthProvider.GITLAB,
                icon = Icons.Default.Storage,
                onClick = { oAuthHandler.launchOAuth(OAuthProvider.GITLAB) }
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
