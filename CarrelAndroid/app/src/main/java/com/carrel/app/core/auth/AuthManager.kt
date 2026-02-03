package com.carrel.app.core.auth

import android.os.Build
import android.util.Base64
import android.util.Log
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.models.AuthTokens
import io.ktor.client.*
import io.ktor.client.call.*
import io.ktor.client.engine.android.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.json.JSONObject

class AuthManager(
    private val tokenStorage: TokenStorage,
    private val deviceId: String,
    private val deviceName: String
) {
    private val _isAuthenticated = MutableStateFlow(false)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private fun setAuthenticated(value: Boolean, source: String) {
        Log.d(TAG, "setAuthenticated($value) from $source")
        _isAuthenticated.value = value
    }

    // JWT tokens (for email/password login - HTTP only, no subscriptions)
    private var accessToken: String? = null
    private var refreshToken: String? = null
    private var accessTokenExpiry: Long = 0L
    private var refreshTokenExpiry: Long? = null

    // Convex Auth token (for OAuth login - enables real-time subscriptions)
    private var convexAuthToken: String? = null

    private val refreshMutex = Mutex()
    private var isRefreshing = false

    // HTTP client for token exchange/refresh
    private val httpClient = HttpClient(Android) {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
    }

    // Lazy client for JWT refresh operations only
    private val refreshClient by lazy { ConvexClient(this) }

    // How long before expiration to trigger a refresh (7 days in ms)
    private val refreshThreshold: Long = 7 * 24 * 60 * 60 * 1000L

    // MARK: - Token Loading

    /**
     * Load stored tokens from secure storage.
     * Checks expiration and refreshes if needed.
     * @return The Convex Auth token if available, null otherwise
     */
    suspend fun loadStoredTokens(): String? {
        _isLoading.value = true

        try {
            // First try to load Convex Auth token (OAuth login)
            val storedConvexToken = tokenStorage.loadConvexAuthToken()
            if (storedConvexToken != null) {
                // Check if token is expired
                if (isTokenExpired(storedConvexToken)) {
                    Log.d(TAG, "Stored Convex token is expired, attempting silent refresh...")
                    val refreshed = refreshTokenSilently()
                    if (!refreshed) {
                        Log.w(TAG, "Silent refresh failed, clearing tokens")
                        tokenStorage.clearAll()
                        setAuthenticated(false, "loadStoredTokens:expiredNoRefresh")
                        return null
                    }
                    return convexAuthToken
                }

                // Check if token is expiring soon - refresh in background
                if (isTokenExpiringSoon(storedConvexToken)) {
                    Log.d(TAG, "Token expiring soon, will refresh in background")
                    // Don't await - let it refresh in background
                    CoroutineScope(Dispatchers.IO).launch {
                        refreshTokenSilently()
                    }
                }

                convexAuthToken = storedConvexToken
                setAuthenticated(true, "loadStoredTokens:convexToken")
                return storedConvexToken
            }

            // Fall back to JWT tokens (email/password login)
            val stored = tokenStorage.load()
            if (stored == null) {
                setAuthenticated(false, "loadStoredTokens:noTokens")
                return null
            }

            accessToken = stored.accessToken
            refreshToken = stored.refreshToken
            accessTokenExpiry = stored.accessTokenExpiry
            refreshTokenExpiry = stored.refreshTokenExpiry

            val isValid = stored.isAccessTokenValid || stored.isRefreshTokenValid
            setAuthenticated(isValid, "loadStoredTokens:jwtTokens(valid=$isValid)")
            return null
        } finally {
            _isLoading.value = false
        }
    }

    // MARK: - Token Validation

    /**
     * Check if a JWT token is expired
     */
    private fun isTokenExpired(token: String): Boolean {
        val remaining = tokenTimeRemaining(token)
        return remaining <= 0
    }

    /**
     * Check if a JWT token is expiring soon (within 7 days)
     */
    private fun isTokenExpiringSoon(token: String): Boolean {
        val remaining = tokenTimeRemaining(token)
        return remaining > 0 && remaining < refreshThreshold
    }

    /**
     * Get the time remaining before token expires (in milliseconds)
     */
    private fun tokenTimeRemaining(token: String): Long {
        try {
            // JWT format: header.payload.signature
            val parts = token.split(".")
            if (parts.size != 3) return 0

            // Decode the payload (base64url encoded)
            val payload = parts[1]
                .replace("-", "+")
                .replace("_", "/")

            // Add padding if needed
            val paddedPayload = when (payload.length % 4) {
                2 -> "$payload=="
                3 -> "$payload="
                else -> payload
            }

            val decodedBytes = Base64.decode(paddedPayload, Base64.DEFAULT)
            val json = JSONObject(String(decodedBytes))
            val exp = json.optLong("exp", 0)

            if (exp == 0L) return 0

            val expirationMs = exp * 1000 // Convert to milliseconds
            val remaining = expirationMs - System.currentTimeMillis()

            if (remaining <= 0) {
                Log.d(TAG, "Token expired")
            } else if (remaining > 24 * 60 * 60 * 1000) {
                Log.d(TAG, "Token valid, expires in ${remaining / (24 * 60 * 60 * 1000)} days")
            } else {
                Log.d(TAG, "Token valid, expires in ${remaining / (60 * 1000)} minutes")
            }

            return remaining
        } catch (e: Exception) {
            Log.e(TAG, "Failed to parse token expiration", e)
            return 0
        }
    }

    // MARK: - Silent Token Refresh

    /**
     * Refresh the access token using the stored refresh token (no user interaction)
     * @return true if refresh succeeded, false otherwise
     */
    suspend fun refreshTokenSilently(): Boolean = refreshMutex.withLock {
        if (isRefreshing) {
            Log.d(TAG, "Refresh already in progress, skipping")
            return false
        }

        val storedRefreshToken = tokenStorage.loadConvexRefreshToken()
        if (storedRefreshToken == null) {
            Log.d(TAG, "No refresh token available")
            return false
        }

        isRefreshing = true
        try {
            Log.d(TAG, "Attempting silent token refresh...")

            val response = httpClient.post("${ConvexClient.BASE_URL}/api/mobile/refresh") {
                contentType(ContentType.Application.Json)
                setBody(mapOf("refreshToken" to storedRefreshToken))
            }

            if (response.status == HttpStatusCode.OK) {
                val result = response.body<TokenResponse>()

                // Save the new access token
                tokenStorage.saveConvexAuthToken(result.accessToken, result.expiresAt.toLong())
                convexAuthToken = result.accessToken

                val daysRemaining = (result.expiresAt - System.currentTimeMillis()) / (1000 * 60 * 60 * 24)
                Log.d(TAG, "Silent refresh successful, token expires in $daysRemaining days")

                setAuthenticated(true, "refreshTokenSilently:success")
                return true
            } else {
                Log.w(TAG, "Refresh failed with status ${response.status}")
                // Clear invalid refresh token
                tokenStorage.clearConvexRefreshToken()
                return false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Refresh request failed", e)
            return false
        } finally {
            isRefreshing = false
        }
    }

    // MARK: - Convex Auth (OAuth)

    /**
     * Handle OAuth callback with Convex Auth token.
     * Exchanges for 90-day token + refresh token.
     * Used for GitHub/GitLab OAuth login.
     */
    suspend fun handleConvexAuthCallback(token: String) {
        Log.d(TAG, "handleConvexAuthCallback called, exchanging for 90-day token...")

        // Exchange the Convex Auth token for a 90-day token + refresh token
        try {
            val response = httpClient.post("${ConvexClient.BASE_URL}/api/mobile/exchange") {
                contentType(ContentType.Application.Json)
                setBody(mapOf(
                    "convexToken" to token,
                    "deviceId" to deviceId,
                    "deviceName" to deviceName,
                    "platform" to "android"
                ))
            }

            if (response.status == HttpStatusCode.OK) {
                val result = response.body<TokenResponse>()

                // Save the 90-day access token
                tokenStorage.saveConvexAuthToken(result.accessToken, result.expiresAt.toLong())
                convexAuthToken = result.accessToken

                // Save the refresh token
                result.refreshToken?.let { refreshToken ->
                    tokenStorage.saveConvexRefreshToken(refreshToken)
                }

                // Clear any old JWT tokens
                accessToken = null
                refreshToken = null
                accessTokenExpiry = 0L
                refreshTokenExpiry = null
                tokenStorage.clear()

                val daysRemaining = (result.expiresAt - System.currentTimeMillis()) / (1000 * 60 * 60 * 24)
                Log.d(TAG, "Token exchange successful, token expires in $daysRemaining days")

                setAuthenticated(true, "handleConvexAuthCallback:exchanged")
            } else {
                Log.w(TAG, "Token exchange failed with status ${response.status}, using original token")
                useTokenDirectly(token)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Token exchange error, using original token", e)
            useTokenDirectly(token)
        }
    }

    /**
     * Fallback: use the original Convex Auth token directly
     */
    private fun useTokenDirectly(token: String) {
        convexAuthToken = token
        tokenStorage.saveConvexAuthToken(token)

        // Clear any old JWT tokens
        accessToken = null
        refreshToken = null
        accessTokenExpiry = 0L
        refreshTokenExpiry = null
        tokenStorage.clear()

        Log.d(TAG, "Using original Convex Auth token (expires in ~1 hour)")
        setAuthenticated(true, "handleConvexAuthCallback:direct")
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
        tokenStorage.clearConvexRefreshToken()

        tokenStorage.save(
            AuthTokens(
                accessToken = accessToken,
                refreshToken = refreshToken,
                expiresAt = expiresAt,
                refreshExpiresAt = refreshExpiresAt
            )
        )

        setAuthenticated(true, "handleOAuthCallback")
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

        // Clear Convex Auth token
        convexAuthToken = null

        // Clear all stored tokens
        tokenStorage.clearAll()

        setAuthenticated(false, "logout")
    }

    companion object {
        private const val TAG = "AuthManager"
    }
}

@Serializable
private data class TokenResponse(
    val accessToken: String,
    val refreshToken: String? = null,
    val expiresAt: Double,
    val refreshExpiresAt: Double? = null,
    val tokenType: String? = null
)
