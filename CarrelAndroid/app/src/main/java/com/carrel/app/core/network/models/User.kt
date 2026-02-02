package com.carrel.app.core.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class User(
    @SerialName("_id") val id: String,
    @SerialName("_creationTime") val creationTime: Double? = null,
    val email: String? = null,
    val name: String? = null,
    val image: String? = null,
    val emailVerificationTime: Double? = null,
    val hasOverleafCredentials: Boolean = false,
    val hasGitHubToken: Boolean = false,
    val hasGitLabToken: Boolean = false
)
