package com.carrel.app.features.gallery

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.ConvexService
import com.carrel.app.core.network.models.Paper
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GalleryUiState(
    val papers: List<Paper> = emptyList(),
    val isLoading: Boolean = false,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val isSubscribed: Boolean = false,
    val isSyncing: Boolean = false,
    val isRefreshingAll: Boolean = false,
    val refreshProgress: Pair<Int, Int>? = null,
    val toastMessage: String? = null
)

class GalleryViewModel(
    private val convexClient: ConvexClient,
    private val convexService: ConvexService,
    private val authManager: AuthManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(GalleryUiState())
    val uiState: StateFlow<GalleryUiState> = _uiState.asStateFlow()

    private var subscriptionJob: Job? = null

    init {
        observeAuthState()
    }

    /**
     * Observe auth state and set up subscription when authenticated.
     */
    private fun observeAuthState() {
        viewModelScope.launch {
            convexService.isAuthenticated.collect { isAuthenticated ->
                Log.d(TAG, "ConvexService auth state: $isAuthenticated")

                if (isAuthenticated) {
                    // Authenticated - use real-time subscriptions
                    startSubscription()
                } else if (authManager.hasConvexAuth()) {
                    // Have token but ConvexService not yet authenticated - wait for it
                    Log.d(TAG, "Waiting for ConvexService authentication...")
                    _uiState.update { it.copy(isLoading = true) }
                }
            }
        }

        // Observe AuthManager's auth state for logout
        viewModelScope.launch {
            authManager.isAuthenticated.collect { isAuthenticated ->
                Log.d(TAG, "AuthManager auth state: $isAuthenticated")

                if (!isAuthenticated) {
                    // Logged out - clear papers
                    subscriptionJob?.cancel()
                    _uiState.update { GalleryUiState() }
                }
            }
        }
    }

    /**
     * Start real-time subscription to papers.
     * Used when authenticated via OAuth (Convex Auth).
     */
    private fun startSubscription() {
        if (_uiState.value.isSubscribed) return

        Log.d(TAG, "Starting papers subscription")
        subscriptionJob?.cancel()
        subscriptionJob = viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            try {
                convexService.subscribeToPapers().collect { papers ->
                    Log.d(TAG, "Received ${papers.size} papers from subscription")
                    _uiState.update { state ->
                        state.copy(
                            papers = papers,
                            isLoading = false,
                            isRefreshing = false,
                            isSubscribed = true
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Subscription error: ${e.message}")
                _uiState.update { state ->
                    state.copy(
                        error = e.message,
                        isLoading = false,
                        isRefreshing = false,
                        isSubscribed = false
                    )
                }
                // Fall back to HTTP
                loadPapersViaHttp()
            }
        }
    }

    /**
     * Load papers using HTTP client (authenticated).
     * Used for email/password login or as fallback when subscriptions fail.
     */
    private fun loadPapersViaHttp() {
        if (_uiState.value.isLoading && !_uiState.value.isRefreshing) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            convexClient.papers()
                .onSuccess { papers ->
                    Log.d(TAG, "Loaded ${papers.size} papers via HTTP")
                    _uiState.update { state ->
                        state.copy(
                            papers = papers,
                            isLoading = false,
                            isRefreshing = false
                        )
                    }
                }
                .onError { exception ->
                    Log.e(TAG, "HTTP error: ${exception.message}, isAuthError: ${exception.isAuthError}")
                    _uiState.update { state ->
                        state.copy(
                            error = exception.message,
                            isLoading = false,
                            isRefreshing = false
                        )
                    }

                    // Only auto-logout on auth errors if using JWT auth (not Convex Auth)
                    // Convex Auth users don't have JWT tokens, so HTTP fallback will always fail
                    if (exception.isAuthError && !authManager.hasConvexAuth()) {
                        Log.w(TAG, "Auth error detected (JWT mode), logging out")
                        viewModelScope.launch { authManager.logout() }
                    }
                }
        }
    }

    /**
     * Manual refresh.
     * For subscription mode, this does nothing (data is real-time).
     * For HTTP mode, this triggers a reload.
     */
    fun refresh() {
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }

            if (_uiState.value.isSubscribed) {
                // Subscription mode - data is already real-time
                // Just clear the refreshing state after a brief delay
                kotlinx.coroutines.delay(500)
                _uiState.update { it.copy(isRefreshing = false) }
            } else {
                // HTTP mode - reload
                loadPapersViaHttp()
            }
        }
    }

    fun buildPaper(paper: Paper, force: Boolean = false) {
        viewModelScope.launch {
            // Use ConvexService for mutations (works with both auth modes)
            convexService.buildPaper(paper.id, force)
                .onSuccess {
                    // If not subscribed, refresh manually
                    if (!_uiState.value.isSubscribed) {
                        loadPapersViaHttp()
                    }
                }
                .onFailure { exception ->
                    _uiState.update { it.copy(error = exception.message) }
                }
        }
    }

    fun deletePaper(paper: Paper) {
        viewModelScope.launch {
            // Optimistic update
            _uiState.update { state ->
                state.copy(papers = state.papers.filter { it.id != paper.id })
            }

            convexService.deletePaper(paper.id)
                .onFailure { exception ->
                    _uiState.update { it.copy(error = exception.message) }
                    // Restore correct state on error (subscription will auto-update, or reload via HTTP)
                    if (!_uiState.value.isSubscribed) {
                        loadPapersViaHttp()
                    }
                }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearToast() {
        _uiState.update { it.copy(toastMessage = null) }
    }

    /**
     * Check all repositories for updates.
     */
    fun checkAllRepositories() {
        if (_uiState.value.isSyncing) return

        viewModelScope.launch {
            _uiState.update { it.copy(isSyncing = true) }

            convexService.checkAllRepositories()
                .onSuccess { result ->
                    val message = when {
                        result.failed > 0 -> "${result.failed} repos failed"
                        result.checked == 0 -> "All repos recently checked"
                        result.updated > 0 -> "${result.updated} repos updated"
                        else -> "All repos up to date"
                    }
                    _uiState.update { it.copy(isSyncing = false, toastMessage = message) }
                }
                .onFailure { e ->
                    Log.e(TAG, "Check all failed: ${e.message}")
                    _uiState.update { it.copy(isSyncing = false, toastMessage = "Failed to check repos") }
                }
        }
    }

    /**
     * Refresh all papers that need sync (in parallel).
     */
    fun refreshAllPapers() {
        val outdated = _uiState.value.papers.filter {
            it.isUpToDate == false && it.buildStatus != "building"
        }

        if (outdated.isEmpty()) {
            _uiState.update { it.copy(toastMessage = "All papers up to date") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshingAll = true, refreshProgress = 0 to outdated.size) }

            val completed = java.util.concurrent.atomic.AtomicInteger(0)
            val successCount = java.util.concurrent.atomic.AtomicInteger(0)
            val failCount = java.util.concurrent.atomic.AtomicInteger(0)

            // Build all papers in parallel
            val jobs = outdated.map { paper ->
                async {
                    convexService.buildPaper(paper.id, force = false)
                        .onSuccess { successCount.incrementAndGet() }
                        .onFailure { failCount.incrementAndGet() }
                    val current = completed.incrementAndGet()
                    _uiState.update { it.copy(refreshProgress = current to outdated.size) }
                }
            }

            // Wait for all to complete
            jobs.awaitAll()

            val message = if (failCount.get() > 0) {
                "Refreshed ${successCount.get()}, ${failCount.get()} failed"
            } else {
                "Refreshed ${successCount.get()} papers"
            }

            _uiState.update { it.copy(isRefreshingAll = false, refreshProgress = null, toastMessage = message) }
        }
    }

    override fun onCleared() {
        super.onCleared()
        subscriptionJob?.cancel()
    }

    companion object {
        private const val TAG = "GalleryViewModel"
    }
}
