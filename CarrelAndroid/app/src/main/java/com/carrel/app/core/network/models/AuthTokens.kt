package com.carrel.app.core.network.models

import kotlinx.serialization.Serializable

@Serializable
data class AuthTokens(
    val accessToken: String,
    val refreshToken: String? = null,
    val expiresAt: Long,
    val refreshExpiresAt: Long? = null,
    val tokenType: String = "Bearer"
)

@Serializable
data class RefreshTokenResponse(
    val accessToken: String,
    val expiresAt: Long,
    val tokenType: String = "Bearer"
)

@Serializable
data class TogglePublicResponse(
    val isPublic: Boolean,
    val shareSlug: String? = null
)

@Serializable
data class ApiErrorResponse(
    val error: String
)

@Serializable
data class SuccessResponse(
    val success: Boolean = true
)
