package com.carrel.app.core.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Paper(
    @SerialName("_id") val id: String,
    val title: String? = null,
    val authors: String? = null,
    val pdfUrl: String? = null,
    val thumbnailUrl: String? = null,
    val status: PaperStatus = PaperStatus.UNKNOWN,
    val isPublic: Boolean = false,
    val shareSlug: String? = null,
    val repositoryId: String? = null,
    val trackedFileId: String? = null,
    val lastSyncedAt: Long? = null,
    val createdAt: Long? = null,
    val updatedAt: Long? = null
)

@Serializable
enum class PaperStatus {
    @SerialName("synced") SYNCED,
    @SerialName("pending") PENDING,
    @SerialName("building") BUILDING,
    @SerialName("error") ERROR,
    @SerialName("unknown") UNKNOWN;

    companion object {
        fun fromString(value: String): PaperStatus {
            return entries.find { it.name.equals(value, ignoreCase = true) } ?: UNKNOWN
        }
    }
}
