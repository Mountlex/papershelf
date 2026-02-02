package com.carrel.app.core.auth

import android.content.Context
import dev.convex.android.AuthProvider

/**
 * Custom AuthProvider that uses pre-obtained Convex Auth JWT tokens.
 * This allows us to use tokens obtained from the web OAuth flow with the Convex SDK.
 *
 * The token is a JWT issued by Convex Auth on the web, which we pass to the
 * Android SDK for WebSocket authentication.
 */
class ConvexAuthTokenProvider : AuthProvider<String> {
    private var currentToken: String? = null

    /**
     * Set the token (called when we receive it from OAuth callback).
     */
    fun setToken(token: String?) {
        currentToken = token
    }

    /**
     * Get the current token.
     */
    fun getToken(): String? = currentToken

    /**
     * Login using the stored token.
     * Called by ConvexClientWithAuth when authenticating.
     * Context is not needed since we already have the token from the OAuth flow.
     */
    override suspend fun login(context: Context): Result<String> {
        val token = currentToken
        return if (token != null) {
            Result.success(token)
        } else {
            Result.failure(ConvexAuthError.NoToken)
        }
    }

    /**
     * Login from cached token (same as login since we manage our own cache).
     */
    override suspend fun loginFromCache(): Result<String> {
        val token = currentToken
        return if (token != null) {
            Result.success(token)
        } else {
            Result.failure(ConvexAuthError.NoToken)
        }
    }

    /**
     * Logout - just clear the token.
     * Context is not needed since we just clear the in-memory token.
     */
    override suspend fun logout(context: Context): Result<Void?> {
        currentToken = null
        return Result.success(null)
    }

    /**
     * Extract the JWT ID token from our auth result (it's already the token).
     */
    override fun extractIdToken(authResult: String): String {
        return authResult
    }
}

/**
 * Errors that can occur during Convex authentication.
 */
sealed class ConvexAuthError : Exception() {
    object NoToken : ConvexAuthError() {
        private fun readResolve(): Any = NoToken
        override val message: String = "No authentication token available"
    }
}
