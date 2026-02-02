package com.carrel.app.core.network.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class RepositoryFile(
    val name: String,
    val path: String,
    val type: FileType,
    // Convex returns numbers as doubles
    val size: Double? = null
) {
    val isDirectory: Boolean get() = type == FileType.DIR
    val isTexFile: Boolean get() = name.endsWith(".tex")
    val isPdfFile: Boolean get() = name.endsWith(".pdf")
    val isSelectable: Boolean get() = isTexFile || isPdfFile
    val sizeInt: Int? get() = size?.toInt()
}

@Serializable
enum class FileType {
    @SerialName("file") FILE,
    @SerialName("dir") DIR
}
