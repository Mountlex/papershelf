package com.carrel.app.features.paper

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.models.Paper
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PaperDetailUiState(
    val paper: Paper? = null,
    val isLoading: Boolean = false,
    val isBuilding: Boolean = false,
    val isTogglingPublic: Boolean = false,
    val error: String? = null
)

class PaperViewModel(
    private val paperId: String,
    private val convexClient: ConvexClient
) : ViewModel() {

    private val _uiState = MutableStateFlow(PaperDetailUiState())
    val uiState: StateFlow<PaperDetailUiState> = _uiState.asStateFlow()

    init {
        loadPaper()
    }

    fun loadPaper() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            convexClient.paper(paperId)
                .onSuccess { paper ->
                    _uiState.value = _uiState.value.copy(
                        paper = paper,
                        isLoading = false
                    )
                }
                .onError { exception ->
                    _uiState.value = _uiState.value.copy(
                        error = exception.message,
                        isLoading = false
                    )
                }
        }
    }

    fun build(force: Boolean = false) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isBuilding = true)

            convexClient.buildPaper(paperId, force)
                .onSuccess {
                    loadPaper()
                }
                .onError { exception ->
                    _uiState.value = _uiState.value.copy(
                        error = exception.message,
                        isBuilding = false
                    )
                }

            _uiState.value = _uiState.value.copy(isBuilding = false)
        }
    }

    fun updateMetadata(title: String?, authors: String?) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)

            convexClient.updatePaper(paperId, title, authors)
                .onSuccess {
                    loadPaper()
                }
                .onError { exception ->
                    _uiState.value = _uiState.value.copy(
                        error = exception.message,
                        isLoading = false
                    )
                }
        }
    }

    fun togglePublic() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isTogglingPublic = true)

            convexClient.togglePaperPublic(paperId)
                .onSuccess {
                    loadPaper()
                }
                .onError { exception ->
                    _uiState.value = _uiState.value.copy(
                        error = exception.message
                    )
                }

            _uiState.value = _uiState.value.copy(isTogglingPublic = false)
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
