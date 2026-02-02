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
    val isUpToDate: Boolean? = null,
    val buildStatus: String? = null,
    val compilationProgress: String? = null,
    val lastSyncError: String? = null,
    val isPublic: Boolean = false,
    val shareSlug: String? = null,
    val repositoryId: String? = null,
    val trackedFileId: String? = null,
    val pdfSourceType: String? = null,
    // Convex returns timestamps as doubles (milliseconds with decimal precision)
    val lastAffectedCommitTime: Double? = null,
    val lastAffectedCommitAuthor: String? = null,
    val lastSyncedAt: Double? = null,
    val createdAt: Double? = null,
    val updatedAt: Double? = null
) {
    // Derive status from isUpToDate and buildStatus
    val status: PaperStatus
        get() = when {
            buildStatus == "building" -> PaperStatus.BUILDING
            buildStatus == "error" -> PaperStatus.ERROR
            buildStatus == "pending" -> PaperStatus.PENDING
            isUpToDate == true -> PaperStatus.SYNCED
            isUpToDate == false -> PaperStatus.PENDING
            else -> PaperStatus.UNKNOWN
        }
}

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
