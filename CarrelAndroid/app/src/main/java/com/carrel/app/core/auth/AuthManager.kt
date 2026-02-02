package com.carrel.app.core.auth

import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.models.AuthTokens
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class AuthManager(
    private val tokenStorage: TokenStorage
) {
    private val _isAuthenticated = MutableStateFlow(false)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated.asStateFlow()

    // JWT tokens (for email/password login - HTTP only, no subscriptions)
    private var accessToken: String? = null
    private var refreshToken: String? = null
    private var accessTokenExpiry: Long = 0L
    private var refreshTokenExpiry: Long? = null

    // Convex Auth token (for OAuth login - enables real-time subscriptions)
    private var convexAuthToken: String? = null

    private val refreshMutex = Mutex()

    // Lazy client for refresh operations only
    private val refreshClient by lazy { ConvexClient(this) }

    // MARK: - Token Loading

    /**
     * Load stored tokens from secure storage.
     * Prioritizes Convex Auth token over JWT tokens.
     * @return The Convex Auth token if available, null otherwise
     */
    fun loadStoredTokens(): String? {
        // First try to load Convex Auth token (OAuth login)
        val storedConvexToken = tokenStorage.loadConvexAuthToken()
        if (storedConvexToken != null) {
            convexAuthToken = storedConvexToken
            _isAuthenticated.value = true
            return storedConvexToken
        }

        // Fall back to JWT tokens (email/password login)
        val stored = tokenStorage.load()
        if (stored == null) {
            _isAuthenticated.value = false
            return null
        }

        accessToken = stored.accessToken
        refreshToken = stored.refreshToken
        accessTokenExpiry = stored.accessTokenExpiry
        refreshTokenExpiry = stored.refreshTokenExpiry

        _isAuthenticated.value = stored.isAccessTokenValid || stored.isRefreshTokenValid
        return null
    }

    // MARK: - Convex Auth (OAuth)

    /**
     * Handle OAuth callback with Convex Auth token.
     * Used for GitHub/GitLab OAuth login.
     */
    fun handleConvexAuthCallback(token: String) {
        convexAuthToken = token
        tokenStorage.saveConvexAuthToken(token)

        // Clear any old JWT tokens
        accessToken = null
        refreshToken = null
        accessTokenExpiry = 0L
        refreshTokenExpiry = null
        tokenStorage.clear()

        _isAuthenticated.value = true
    }

    /**
     * Get the current Convex Auth token.
     */
    fun getConvexAuthToken(): String? = convexAuthToken

    /**
     * Check if using Convex Auth (OAuth) vs JWT (email login).
     */
    fun hasConvexAuth(): Boolean = convexAuthToken != null

    // MARK: - JWT Auth (Email/Password)

    /**
     * Handle OAuth callback with JWT tokens.
     * Used for email/password login (HTTP-based, no subscriptions).
     */
    fun handleOAuthCallback(
        accessToken: String,
        refreshToken: String?,
        expiresAt: Long,
        refreshExpiresAt: Long?
    ) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken
        this.accessTokenExpiry = expiresAt
        this.refreshTokenExpiry = refreshExpiresAt

        // Clear any Convex Auth token
        convexAuthToken = null
        tokenStorage.clearConvexAuthToken()

        tokenStorage.save(
            AuthTokens(
                accessToken = accessToken,
                refreshToken = refreshToken,
                expiresAt = expiresAt,
                refreshExpiresAt = refreshExpiresAt
            )
        )

        _isAuthenticated.value = true
    }

    suspend fun getValidToken(): String? {
        // If we have a valid access token, return it
        if (accessToken != null && accessTokenExpiry > System.currentTimeMillis() + 60_000) {
            return accessToken
        }

        // Need to refresh
        return refreshAccessToken()
    }

    private suspend fun refreshAccessToken(): String? = refreshMutex.withLock {
        // Double-check after acquiring lock
        if (accessToken != null && accessTokenExpiry > System.currentTimeMillis() + 60_000) {
            return accessToken
        }

        val currentRefreshToken = refreshToken ?: return null

        return try {
            val result = refreshClient.refreshToken(currentRefreshToken)
            result.onSuccess { response ->
                accessToken = response.accessToken
                accessTokenExpiry = response.expiresAt

                // Update storage
                tokenStorage.save(
                    AuthTokens(
                        accessToken = response.accessToken,
                        refreshToken = currentRefreshToken,
                        expiresAt = response.expiresAt,
                        refreshExpiresAt = refreshTokenExpiry
                    )
                )
            }
            result.getOrNull()?.accessToken
        } catch (e: Exception) {
            null
        }
    }

    // MARK: - Logout

    suspend fun logout() {
        // Revoke JWT refresh token if present
        refreshToken?.let { token ->
            try {
                refreshClient.revokeToken(token)
            } catch (e: Exception) {
                // Ignore revocation errors
            }
        }

        // Clear JWT tokens
        accessToken = null
        refreshToken = null
        accessTokenExpiry = 0L
        refreshTokenExpiry = null
        tokenStorage.clear()

        // Clear Convex Auth token
        convexAuthToken = null
        tokenStorage.clearConvexAuthToken()

        _isAuthenticated.value = false
    }
}
