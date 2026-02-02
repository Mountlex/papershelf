package com.carrel.app.core.network

import android.content.Context
import android.util.Log
import com.carrel.app.core.auth.ConvexAuthTokenProvider
import com.carrel.app.core.auth.TokenStorage
import com.carrel.app.core.network.models.*
import dev.convex.android.AuthState
import dev.convex.android.ConvexClientWithAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

/**
 * Service for interacting with Convex backend using the official Android SDK.
 * Provides real-time subscriptions for reactive UI updates.
 *
 * Uses ConvexClientWithAuth with a custom AuthProvider to enable authenticated
 * WebSocket subscriptions using tokens from the web OAuth flow.
 */
class ConvexService(
    private val context: Context
) {
    private val authProvider = ConvexAuthTokenProvider()
    private val client = ConvexClientWithAuth(DEPLOYMENT_URL, authProvider)
    private val tokenStorage = TokenStorage(context)

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val _isAuthenticated = MutableStateFlow(false)
    val isAuthenticated: StateFlow<Boolean> = _isAuthenticated.asStateFlow()

    init {
        // Observe auth state changes from the SDK client
        serviceScope.launch {
            client.authState.collect { authState ->
                Log.d(TAG, "SDK Auth state changed: $authState")
                when (authState) {
                    is AuthState.Authenticated -> {
                        _isAuthenticated.value = true
                        Log.d(TAG, "SDK reports Authenticated")
                    }
                    is AuthState.Unauthenticated -> {
                        _isAuthenticated.value = false
                        Log.d(TAG, "SDK reports Unauthenticated")
                    }
                    is AuthState.AuthLoading -> {
                        Log.d(TAG, "SDK reports AuthLoading")
                    }
                }
            }
        }
    }

    // MARK: - Authentication

    /**
     * Set the authentication token received from OAuth flow.
     * @return true if authentication succeeded, false if it failed
     */
    suspend fun setAuthToken(token: String?): Boolean {
        Log.d(TAG, "setAuthToken called, token exists: ${token != null}")

        if (token == null) {
            authProvider.setToken(null)
            try {
                client.logout(context)
                // Auth state will be updated via authState observer
            } catch (e: Exception) {
                Log.w(TAG, "Error during logout: ${e.message}")
            }
            return false
        }

        authProvider.setToken(token)
        return try {
            // Use login with context - our AuthProvider ignores the context but returns the token
            Log.d(TAG, "Calling client.login()...")
            val result = client.login(context)
            if (result.isSuccess) {
                Log.d(TAG, "login() returned success")
                // Auth state will be updated via authState observer
                true
            } else {
                Log.e(TAG, "login() returned failure: ${result.exceptionOrNull()?.message}")
                authProvider.setToken(null)
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "login() threw exception: ${e.message}", e)
            // Clear the invalid token
            authProvider.setToken(null)
            false
        }
    }

    /**
     * Clear authentication state.
     */
    suspend fun clearAuth() {
        Log.d(TAG, "clearAuth called")
        authProvider.setToken(null)
        try {
            client.logout(context)
            // Auth state will be updated via authState observer
        } catch (e: Exception) {
            Log.w(TAG, "Error during logout: ${e.message}")
        }
    }

    /**
     * Restore authentication from stored token.
     * @return true if restoration succeeded, false if it failed
     */
    suspend fun restoreAuthFromCache(token: String): Boolean {
        Log.d(TAG, "restoreAuthFromCache called")
        return setAuthToken(token)
    }

    // MARK: - Papers (Subscriptions)

    /**
     * Subscribe to the list of papers (real-time updates).
     * Requires authentication to work.
     */
    suspend fun subscribeToPapers(): Flow<List<Paper>> {
        Log.d(TAG, "subscribeToPapers called, isAuthenticated: ${_isAuthenticated.value}")
        return client.subscribe<List<Paper>>("papers:listMine")
            .map { result ->
                if (result.isSuccess) {
                    val papers = result.getOrDefault(emptyList())
                    Log.d(TAG, "Subscription received ${papers.size} papers")
                    papers
                } else {
                    Log.e(TAG, "Subscription result failure: ${result.exceptionOrNull()?.message}")
                    emptyList()
                }
            }
            .catch { e ->
                Log.e(TAG, "Error in papers subscription: ${e.message}", e)
                emit(emptyList())
            }
    }

    /**
     * Subscribe to a single paper for real-time updates.
     */
    suspend fun subscribeToPaper(id: String): Flow<Paper?> {
        return client.subscribe<Paper?>("papers:get", mapOf("id" to id))
            .map { result -> result.getOrNull() }
            .catch { e ->
                Log.e(TAG, "Error in paper subscription: ${e.message}")
                emit(null)
            }
    }

    /**
     * Subscribe to repositories list.
     */
    suspend fun subscribeToRepositories(userId: String): Flow<List<Repository>> {
        return client.subscribe<List<Repository>>("repositories:list", mapOf("userId" to userId))
            .map { result -> result.getOrDefault(emptyList()) }
            .catch { e ->
                Log.e(TAG, "Error in repositories subscription: ${e.message}")
                emit(emptyList())
            }
    }

    // MARK: - Mutations & Actions

    /**
     * Build/sync a paper.
     */
    suspend fun buildPaper(id: String, force: Boolean = false): Result<Unit> {
        return runCatching {
            client.action("sync:buildPaper", mapOf("paperId" to id, "force" to force))
        }
    }

    /**
     * Delete a paper.
     */
    suspend fun deletePaper(id: String): Result<Unit> {
        return runCatching {
            client.mutation("papers:deletePaper", mapOf("id" to id))
        }
    }

    /**
     * Update paper metadata.
     */
    suspend fun updatePaper(id: String, title: String?): Result<Unit> {
        return runCatching {
            val args = mutableMapOf<String, Any?>("id" to id)
            title?.let { args["title"] = it }
            client.mutation("papers:update", args)
        }
    }

    /**
     * Toggle paper public status.
     */
    suspend fun togglePaperPublic(id: String): Result<TogglePublicResult> {
        return runCatching {
            client.mutation<TogglePublicResult>("papers:togglePublic", mapOf("paperId" to id))
        }
    }

    /**
     * Check all repositories for updates.
     */
    suspend fun checkAllRepositories(): Result<CheckAllResult> {
        return runCatching {
            client.action<CheckAllResult>("sync:refreshAllRepositories")
        }
    }

    /**
     * Delete a repository (cascades to papers and tracked files).
     */
    suspend fun deleteRepository(id: String): Result<Unit> {
        return runCatching {
            client.mutation("repositories:remove", mapOf("id" to id))
        }
    }

    /**
     * Refresh a single repository.
     */
    suspend fun refreshRepository(id: String): Result<RefreshRepositoryResult> {
        return runCatching {
            client.action<RefreshRepositoryResult>("sync:refreshRepository", mapOf("repositoryId" to id))
        }
    }

    /**
     * List files in a repository directory.
     */
    suspend fun listRepositoryFiles(
        gitUrl: String,
        path: String?,
        branch: String?
    ): Result<List<RepositoryFile>> {
        return runCatching {
            val args = mutableMapOf<String, Any?>("gitUrl" to gitUrl)
            if (!path.isNullOrEmpty()) {
                args["path"] = path
            }
            branch?.let { args["branch"] = it }
            client.action<List<RepositoryFile>>("git:listRepositoryFiles", args)
        }
    }

    /**
     * Add a tracked file and create paper.
     */
    suspend fun addTrackedFile(
        repositoryId: String,
        filePath: String,
        title: String,
        pdfSourceType: String,
        compiler: String?
    ): Result<AddTrackedFileResult> {
        return runCatching {
            val args = mutableMapOf<String, Any?>(
                "repositoryId" to repositoryId,
                "filePath" to filePath,
                "title" to title,
                "pdfSourceType" to pdfSourceType
            )
            compiler?.let { args["compiler"] = it }
            client.mutation<AddTrackedFileResult>("papers:addTrackedFile", args)
        }
    }

    /**
     * List tracked files for a repository.
     */
    suspend fun listTrackedFiles(repositoryId: String): Result<List<TrackedFileInfo>> {
        return runCatching {
            var files: List<TrackedFileInfo> = emptyList()
            client.subscribe<List<TrackedFileInfo>>("papers:listTrackedFiles", mapOf("repositoryId" to repositoryId))
                .collect { result ->
                    files = result.getOrDefault(emptyList())
                    // Only take first emission by throwing
                    throw FirstValueReceivedException(files)
                }
            files
        }.recoverCatching { e ->
            if (e is FirstValueReceivedException) {
                @Suppress("UNCHECKED_CAST")
                e.value as List<TrackedFileInfo>
            } else {
                throw e
            }
        }
    }

    companion object {
        private const val TAG = "ConvexService"
        const val DEPLOYMENT_URL = "https://kindhearted-bloodhound-95.convex.cloud"
    }
}

/**
 * Internal exception used to break out of subscription collection after first value.
 */
private class FirstValueReceivedException(val value: Any?) : Exception()
