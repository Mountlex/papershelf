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

@Serializable
data class RefreshRepositoryResponse(
    val updated: Boolean,
    val dateIsFallback: Boolean? = null,
    val skipped: Boolean? = null,
    val reason: String? = null,
    val commitHash: String? = null
)

@Serializable
data class CheckAllResponse(
    val checked: Int,
    val updated: Int,
    val failed: Int
)

@Serializable
data class AddTrackedFileResponse(
    val trackedFileId: String,
    val paperId: String
)
