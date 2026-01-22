package com.carrel.app.features.gallery

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.network.ApiException
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.models.Paper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class GalleryUiState(
    val papers: List<Paper> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null
)

class GalleryViewModel(
    private val convexClient: ConvexClient,
    private val authManager: AuthManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(GalleryUiState())
    val uiState: StateFlow<GalleryUiState> = _uiState.asStateFlow()

    init {
        loadPapers()
    }

    fun loadPapers() {
        if (_uiState.value.isLoading) return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            convexClient.papers()
                .onSuccess { papers ->
                    _uiState.value = _uiState.value.copy(
                        papers = papers,
                        isLoading = false,
                        isRefreshing = false
                    )
                }
                .onError { exception ->
                    _uiState.value = _uiState.value.copy(
                        error = exception.message,
                        isLoading = false,
                        isRefreshing = false
                    )

                    if (exception.isAuthError) {
                        authManager.logout()
                    }
                }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isRefreshing = true)
            loadPapers()
        }
    }

    fun buildPaper(paper: Paper, force: Boolean = false) {
        viewModelScope.launch {
            convexClient.buildPaper(paper.id, force)
                .onSuccess {
                    loadPapers()
                }
                .onError { exception ->
                    _uiState.value = _uiState.value.copy(error = exception.message)
                }
        }
    }

    fun deletePaper(paper: Paper) {
        viewModelScope.launch {
            convexClient.deletePaper(paper.id)
                .onSuccess {
                    _uiState.value = _uiState.value.copy(
                        papers = _uiState.value.papers.filter { it.id != paper.id }
                    )
                }
                .onError { exception ->
                    _uiState.value = _uiState.value.copy(error = exception.message)
                }
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
