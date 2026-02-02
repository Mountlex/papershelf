package com.carrel.app.features.repositories

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.models.Repository
import com.carrel.app.core.network.models.RepositoryFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AddPaperFromRepoUiState(
    val files: List<RepositoryFile> = emptyList(),
    val currentPath: String = "",
    val isLoadingFiles: Boolean = false,
    val loadError: String? = null,
    val trackedFilePaths: Set<String> = emptySet()
) {
    val breadcrumbs: List<String>
        get() = if (currentPath.isEmpty()) emptyList() else currentPath.split("/")
}

class AddPaperFromRepoViewModel(
    private val repository: Repository,
    private val convexClient: ConvexClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(AddPaperFromRepoUiState())
    val uiState: StateFlow<AddPaperFromRepoUiState> = _uiState.asStateFlow()

    fun isFileTracked(path: String): Boolean {
        return _uiState.value.trackedFilePaths.contains(path)
    }

    fun loadFiles(path: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingFiles = true, loadError = null) }

            val loadPath = path ?: _uiState.value.currentPath

            // Fetch files
            convexClient.listRepositoryFiles(
                gitUrl = repository.gitUrl,
                path = loadPath.ifEmpty { null },
                branch = repository.defaultBranch
            ).onSuccess { fetchedFiles ->
                // Then fetch tracked files
                convexClient.listTrackedFiles(repository.id)
                    .onSuccess { trackedFiles ->
                        val trackedPaths = trackedFiles.map { it.filePath }.toSet()

                        // Sort: directories first, then files, alphabetically within each group
                        val sortedFiles = fetchedFiles
                            .sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
                            .filter { it.isDirectory || it.isSelectable }

                        _uiState.update { state ->
                            state.copy(
                                files = sortedFiles,
                                trackedFilePaths = trackedPaths,
                                isLoadingFiles = false
                            )
                        }
                    }
                    .onError { exception ->
                        // If tracked files fail, still show the files
                        val sortedFiles = fetchedFiles
                            .sortedWith(compareBy({ !it.isDirectory }, { it.name.lowercase() }))
                            .filter { it.isDirectory || it.isSelectable }

                        _uiState.update { state ->
                            state.copy(
                                files = sortedFiles,
                                trackedFilePaths = emptySet(),
                                isLoadingFiles = false
                            )
                        }
                    }
            }.onError { exception ->
                _uiState.update { state ->
                    state.copy(
                        loadError = exception.message ?: "Failed to load files",
                        isLoadingFiles = false
                    )
                }
            }
        }
    }

    fun navigateToFolder(folder: RepositoryFile) {
        if (!folder.isDirectory) return

        _uiState.update { it.copy(currentPath = folder.path) }
        loadFiles()
    }

    fun navigateUp() {
        val currentPath = _uiState.value.currentPath
        if (currentPath.isEmpty()) return

        val components = currentPath.split("/")
        val newPath = if (components.size <= 1) {
            ""
        } else {
            components.dropLast(1).joinToString("/")
        }

        _uiState.update { it.copy(currentPath = newPath) }
        loadFiles()
    }

    fun navigateToBreadcrumb(index: Int) {
        val breadcrumbs = _uiState.value.breadcrumbs
        if (index >= breadcrumbs.size) return

        val newPath = if (index == -1) {
            ""
        } else {
            breadcrumbs.subList(0, index + 1).joinToString("/")
        }

        _uiState.update { it.copy(currentPath = newPath) }
        loadFiles()
    }
}
