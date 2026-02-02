package com.carrel.app.core.auth

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import com.carrel.app.core.network.ConvexClient

enum class OAuthProvider(val id: String?, val displayName: String) {
    GITHUB("github", "GitHub"),
    GITLAB("gitlab", "GitLab"),
    EMAIL(null, "Email")  // null means no provider param - shows full auth page
}

class OAuthHandler(private val context: Context) {

    fun launchOAuth(provider: OAuthProvider) {
        val uriBuilder = Uri.parse("${ConvexClient.SITE_URL}/mobile-auth").buildUpon()

        // Only add provider param for OAuth providers, not email
        provider.id?.let {
            uriBuilder.appendQueryParameter("provider", it)
        }

        val uri = uriBuilder.build()

        val customTabsIntent = CustomTabsIntent.Builder()
            .setShowTitle(true)
            .build()

        customTabsIntent.launchUrl(context, uri)
    }

    companion object {
        fun parseCallbackUri(uri: Uri): OAuthCallbackResult? {
            if (uri.scheme != "carrel" || uri.host != "auth") {
                return null
            }

            // Check for new Convex Auth token format (OAuth login)
            val convexToken = uri.getQueryParameter("token")
            if (convexToken != null) {
                return OAuthCallbackResult.ConvexAuth(token = convexToken)
            }

            // Check for legacy JWT format (email/password login)
            val accessToken = uri.getQueryParameter("accessToken")
            val expiresAt = uri.getQueryParameter("expiresAt")?.toLongOrNull()

            if (accessToken != null && expiresAt != null) {
                return OAuthCallbackResult.JwtAuth(
                    accessToken = accessToken,
                    refreshToken = uri.getQueryParameter("refreshToken"),
                    expiresAt = expiresAt,
                    refreshExpiresAt = uri.getQueryParameter("refreshExpiresAt")?.toLongOrNull()
                )
            }

            // Check for error
            val error = uri.getQueryParameter("error")
            if (error != null) {
                return OAuthCallbackResult.Error(message = error)
            }

            return null
        }
    }
}

/**
 * Result of parsing an OAuth callback URI.
 */
sealed class OAuthCallbackResult {
    /**
     * Convex Auth token received from OAuth login (GitHub/GitLab).
     * This token is used with ConvexClientWithAuth for real-time subscriptions.
     */
    data class ConvexAuth(val token: String) : OAuthCallbackResult()

    /**
     * JWT tokens received from email/password login.
     * These tokens are used with the HTTP-based ConvexClient (no subscriptions).
     */
    data class JwtAuth(
        val accessToken: String,
        val refreshToken: String?,
        val expiresAt: Long,
        val refreshExpiresAt: Long?
    ) : OAuthCallbackResult()

    /**
     * Error during authentication.
     */
    data class Error(val message: String) : OAuthCallbackResult()
}
