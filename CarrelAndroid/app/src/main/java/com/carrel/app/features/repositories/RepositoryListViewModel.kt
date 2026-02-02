package com.carrel.app.features.repositories

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.network.ConvexService
import com.carrel.app.core.network.models.Repository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RepositoryListUiState(
    val repositories: List<Repository> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val isCheckingAll: Boolean = false,
    val refreshingRepoId: String? = null,
    val error: String? = null,
    val toastMessage: String? = null
)

class RepositoryListViewModel(
    private val convexService: ConvexService
) : ViewModel() {

    private val _uiState = MutableStateFlow(RepositoryListUiState())
    val uiState: StateFlow<RepositoryListUiState> = _uiState.asStateFlow()

    fun loadRepositories() {
        if (_uiState.value.isLoading) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            convexService.getRepositories()
                .onSuccess { repositories ->
                    Log.d(TAG, "Loaded ${repositories.size} repositories")
                    _uiState.update { state ->
                        state.copy(
                            repositories = repositories,
                            isLoading = false,
                            isRefreshing = false
                        )
                    }
                }
                .onFailure { exception ->
                    Log.e(TAG, "Failed to load repositories: ${exception.message}")
                    _uiState.update { state ->
                        state.copy(
                            error = exception.message,
                            isLoading = false,
                            isRefreshing = false
                        )
                    }
                }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            loadRepositories()
        }
    }

    fun checkAllRepositories() {
        if (_uiState.value.isCheckingAll) return

        viewModelScope.launch {
            _uiState.update { it.copy(isCheckingAll = true) }

            convexService.checkAllRepositories()
                .onSuccess { result ->
                    val message = when {
                        result.failed > 0 -> "${result.failed} repos failed"
                        result.checked == 0 -> "All repos recently checked"
                        result.updated > 0 -> "${result.updated} repos updated"
                        else -> "All repos up to date"
                    }
                    _uiState.update { it.copy(toastMessage = message, isCheckingAll = false) }
                    loadRepositories()
                }
                .onFailure { exception ->
                    _uiState.update { it.copy(toastMessage = "Failed to check repos", isCheckingAll = false) }
                }
        }
    }

    fun refreshRepository(repository: Repository) {
        if (_uiState.value.refreshingRepoId != null) return

        viewModelScope.launch {
            _uiState.update { it.copy(refreshingRepoId = repository.id) }

            convexService.refreshRepository(repository.id)
                .onSuccess { result ->
                    val message = when {
                        result.skipped == true -> "Already syncing"
                        result.updated -> "Repository updated"
                        else -> "Already up to date"
                    }
                    _uiState.update { it.copy(toastMessage = message, refreshingRepoId = null) }
                    loadRepositories()
                }
                .onFailure { exception ->
                    val message = if (exception.message?.contains("Rate limit") == true) {
                        "Rate limited, try later"
                    } else {
                        "Failed to refresh"
                    }
                    _uiState.update { it.copy(toastMessage = message, refreshingRepoId = null) }
                }
        }
    }

    fun deleteRepository(repository: Repository) {
        viewModelScope.launch {
            // Optimistic update
            _uiState.update { state ->
                state.copy(repositories = state.repositories.filter { it.id != repository.id })
            }

            convexService.deleteRepository(repository.id)
                .onSuccess {
                    _uiState.update { it.copy(toastMessage = "Repository deleted") }
                }
                .onFailure { exception ->
                    _uiState.update { it.copy(toastMessage = "Failed to delete", error = exception.message) }
                    loadRepositories()
                }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearToast() {
        _uiState.update { it.copy(toastMessage = null) }
    }

    companion object {
        private const val TAG = "RepositoryListViewModel"
    }
}
