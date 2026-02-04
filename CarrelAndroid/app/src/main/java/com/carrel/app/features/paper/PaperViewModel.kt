package com.carrel.app.features.paper

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.ConvexService
import com.carrel.app.core.network.models.Paper
import com.carrel.app.core.network.models.PaperStatus
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
    private val convexClient: ConvexClient,
    private val convexService: ConvexService? = null,
    private val useConvexSubscriptions: Boolean = false
) : ViewModel() {

    private val _uiState = MutableStateFlow(PaperDetailUiState())
    val uiState: StateFlow<PaperDetailUiState> = _uiState.asStateFlow()
    private var subscriptionJob: Job? = null

    init {
        if (convexService != null && useConvexSubscriptions) {
            observeConvexAuth()
        } else {
            loadPaper()
        }
    }

    /**
     * Start real-time subscription to the paper.
     */
    private fun startSubscription() {
        if (subscriptionJob?.isActive == true) return
        subscriptionJob?.cancel()
        _uiState.update { it.copy(isLoading = true, error = null) }

        subscriptionJob = viewModelScope.launch {
            try {
                convexService?.subscribeToPaper(paperId)
                    ?.collect { paper ->
                        _uiState.update { state ->
                            state.copy(
                                paper = paper,
                                isLoading = false,
                                // Clear building state when paper is no longer building
                                isBuilding = if (paper?.status != PaperStatus.BUILDING) false else state.isBuilding
                            )
                        }
                    }
            } catch (e: Exception) {
                _uiState.update { state ->
                    state.copy(
                        error = e.message,
                        isLoading = false
                    )
                }
            }
        }
    }

    /**
     * Wait for Convex auth before subscribing.
     * If Convex auth is not available, fall back to HTTP.
     */
    private fun observeConvexAuth() {
        _uiState.update { it.copy(isLoading = true, error = null) }
        viewModelScope.launch {
            convexService?.isAuthenticated?.collect { isAuthenticated ->
                if (isAuthenticated) {
                    startSubscription()
                } else {
                    _uiState.update { it.copy(isLoading = true) }
                }
            }
        }
    }

    fun loadPaper() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            convexClient.paper(paperId)
                .onSuccess { paper ->
                    _uiState.update { state ->
                        state.copy(
                            paper = paper,
                            isLoading = false
                        )
                    }
                }
                .onError { exception ->
                    _uiState.update { state ->
                        state.copy(
                            error = exception.message,
                            isLoading = false
                        )
                    }
                }
        }
    }

    fun build(force: Boolean = false) {
        viewModelScope.launch {
            _uiState.update { it.copy(isBuilding = true) }

            if (convexService != null) {
                // With subscription, just trigger the build and let subscription handle updates
                convexService.buildPaper(paperId, force)
                    .onFailure { exception ->
                        _uiState.update { state ->
                            state.copy(
                                error = exception.message,
                                isBuilding = false
                            )
                        }
                    }
            } else {
                // Fallback to polling when no ConvexService available
                val pollingJob = viewModelScope.launch {
                    while (true) {
                        delay(1500) // 1.5 seconds
                        convexClient.paper(paperId)
                            .onSuccess { paper ->
                                _uiState.update { it.copy(paper = paper) }
                                // Stop polling if build completed
                                if (paper.compilationProgress == null && paper.status != PaperStatus.BUILDING) {
                                    return@launch
                                }
                            }
                    }
                }

                val buildResult = convexClient.buildPaper(paperId, force)
                buildResult.onError { exception ->
                    _uiState.update { state ->
                        state.copy(error = exception.message)
                    }
                    pollingJob.cancel()
                }

                pollingJob.join()
                loadPaper()
                _uiState.update { it.copy(isBuilding = false) }
            }
        }
    }

    fun updateMetadata(title: String?, authors: String?) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            if (convexService != null) {
                convexService.updatePaper(paperId, title)
                    .onFailure { exception ->
                        _uiState.update { state ->
                            state.copy(
                                error = exception.message,
                                isLoading = false
                            )
                        }
                    }
                // Subscription will update the paper
            } else {
                convexClient.updatePaper(paperId, title, authors)
                    .onSuccess {
                        loadPaper()
                    }
                    .onError { exception ->
                        _uiState.update { state ->
                            state.copy(
                                error = exception.message,
                                isLoading = false
                            )
                        }
                    }
            }
        }
    }

    fun togglePublic() {
        viewModelScope.launch {
            _uiState.update { it.copy(isTogglingPublic = true) }

            if (convexService != null) {
                convexService.togglePaperPublic(paperId)
                    .onSuccess {
                        _uiState.update { it.copy(isTogglingPublic = false) }
                    }
                    .onFailure { exception ->
                        _uiState.update { state ->
                            state.copy(
                                error = exception.message,
                                isTogglingPublic = false
                            )
                        }
                    }
            } else {
                convexClient.togglePaperPublic(paperId)
                    .onSuccess {
                        loadPaper()
                    }
                    .onError { exception ->
                        _uiState.update { state ->
                            state.copy(error = exception.message)
                        }
                    }

                _uiState.update { it.copy(isTogglingPublic = false) }
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    override fun onCleared() {
        super.onCleared()
        subscriptionJob?.cancel()
    }
}
