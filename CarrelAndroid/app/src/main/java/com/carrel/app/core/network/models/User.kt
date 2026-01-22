package com.carrel.app.core.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class User(
    @SerialName("_id") val id: String,
    val email: String,
    val name: String? = null,
    val avatarUrl: String? = null,
    val providers: List<String> = emptyList()
)
