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

    private var accessToken: String? = null
    private var refreshToken: String? = null
    private var accessTokenExpiry: Long = 0L
    private var refreshTokenExpiry: Long? = null

    private val refreshMutex = Mutex()

    // Lazy client for refresh operations only
    private val refreshClient by lazy { ConvexClient(this) }

    fun loadStoredTokens() {
        val stored = tokenStorage.load() ?: run {
            _isAuthenticated.value = false
            return
        }

        accessToken = stored.accessToken
        refreshToken = stored.refreshToken
        accessTokenExpiry = stored.accessTokenExpiry
        refreshTokenExpiry = stored.refreshTokenExpiry

        _isAuthenticated.value = stored.isAccessTokenValid || stored.isRefreshTokenValid
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

    suspend fun logout() {
        refreshToken?.let { token ->
            try {
                refreshClient.revokeToken(token)
            } catch (e: Exception) {
                // Ignore revocation errors
            }
        }

        accessToken = null
        refreshToken = null
        accessTokenExpiry = 0L
        refreshTokenExpiry = null
        tokenStorage.clear()
        _isAuthenticated.value = false
    }
}
