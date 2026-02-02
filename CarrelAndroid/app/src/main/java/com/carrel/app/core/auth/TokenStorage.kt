package com.carrel.app.core.auth

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.carrel.app.core.network.models.AuthTokens

class TokenStorage(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs: SharedPreferences = EncryptedSharedPreferences.create(
        context,
        "carrel_tokens",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    // MARK: - JWT Token Storage (for email/password login)

    fun save(tokens: AuthTokens) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, tokens.accessToken)
            .putString(KEY_REFRESH_TOKEN, tokens.refreshToken)
            .putLong(KEY_EXPIRES_AT, tokens.expiresAt)
            .putLong(KEY_REFRESH_EXPIRES_AT, tokens.refreshExpiresAt ?: 0L)
            .apply()
    }

    fun load(): StoredTokens? {
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return null
        val expiresAt = prefs.getLong(KEY_EXPIRES_AT, 0L)
        if (expiresAt == 0L) return null

        return StoredTokens(
            accessToken = accessToken,
            refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null),
            accessTokenExpiry = expiresAt,
            refreshTokenExpiry = prefs.getLong(KEY_REFRESH_EXPIRES_AT, 0L).takeIf { it > 0 }
        )
    }

    fun clear() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_EXPIRES_AT)
            .remove(KEY_REFRESH_EXPIRES_AT)
            .apply()
    }

    // MARK: - Convex Auth Token Storage (for OAuth login)

    fun saveConvexAuthToken(token: String) {
        prefs.edit()
            .putString(KEY_CONVEX_AUTH_TOKEN, token)
            .apply()
    }

    fun loadConvexAuthToken(): String? {
        return prefs.getString(KEY_CONVEX_AUTH_TOKEN, null)
    }

    fun clearConvexAuthToken() {
        prefs.edit()
            .remove(KEY_CONVEX_AUTH_TOKEN)
            .apply()
    }

    fun clearAll() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_REFRESH_TOKEN = "refresh_token"
        private const val KEY_EXPIRES_AT = "expires_at"
        private const val KEY_REFRESH_EXPIRES_AT = "refresh_expires_at"
        private const val KEY_CONVEX_AUTH_TOKEN = "convex_auth_token"
    }
}

data class StoredTokens(
    val accessToken: String,
    val refreshToken: String?,
    val accessTokenExpiry: Long,
    val refreshTokenExpiry: Long?
) {
    val isAccessTokenValid: Boolean
        get() = accessTokenExpiry > System.currentTimeMillis() + 60_000 // 1 minute buffer

    val isRefreshTokenValid: Boolean
        get() = refreshTokenExpiry?.let { it > System.currentTimeMillis() + 60_000 } ?: false
}
