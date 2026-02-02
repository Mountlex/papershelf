package com.carrel.app.core.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Repository(
    @SerialName("_id") val id: String,
    val name: String,
    val gitUrl: String,
    val provider: RepositoryProvider,
    val defaultBranch: String,
    val syncStatus: RepositorySyncStatus,
    // Convex returns timestamps as doubles (milliseconds with decimal precision)
    val lastSyncedAt: Double? = null,
    val lastCommitHash: String? = null,
    val lastCommitTime: Double? = null,
    val lastCommitAuthor: String? = null,
    val paperSyncStatus: PaperSyncStatus,
    // Convex returns numbers as doubles
    val paperCount: Double,
    val papersWithErrors: Double
) {
    val paperCountInt: Int get() = paperCount.toInt()
    val papersWithErrorsInt: Int get() = papersWithErrors.toInt()
}

@Serializable
enum class RepositoryProvider {
    @SerialName("github") GITHUB,
    @SerialName("gitlab") GITLAB,
    @SerialName("selfhosted-gitlab") SELFHOSTED_GITLAB,
    @SerialName("overleaf") OVERLEAF,
    @SerialName("generic") GENERIC;

    val displayName: String
        get() = when (this) {
            GITHUB -> "GitHub"
            GITLAB -> "GitLab"
            SELFHOSTED_GITLAB -> "Self-hosted GitLab"
            OVERLEAF -> "Overleaf"
            GENERIC -> "Git"
        }
}

@Serializable
enum class RepositorySyncStatus {
    @SerialName("idle") IDLE,
    @SerialName("syncing") SYNCING,
    @SerialName("error") ERROR
}

@Serializable
enum class PaperSyncStatus {
    @SerialName("no_papers") NO_PAPERS,
    @SerialName("in_sync") IN_SYNC,
    @SerialName("needs_sync") NEEDS_SYNC,
    @SerialName("never_synced") NEVER_SYNCED;

    val displayText: String
        get() = when (this) {
            NO_PAPERS -> "No papers"
            IN_SYNC -> "Up to date"
            NEEDS_SYNC -> "Outdated"
            NEVER_SYNCED -> "Not synced"
        }
}
