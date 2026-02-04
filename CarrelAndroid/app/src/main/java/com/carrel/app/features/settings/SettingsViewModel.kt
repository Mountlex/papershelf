package com.carrel.app.features.settings

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.network.ConvexService
import com.carrel.app.core.network.models.User
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class SettingsUiState(
    val user: User? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

class SettingsViewModel(
    private val convexService: ConvexService,
    private val authManager: AuthManager
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadUser()
    }

    fun loadUser() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)

            convexService.getCurrentUser()
                .onSuccess { user ->
                    Log.d(TAG, "Loaded user: ${user?.email}")
                    _uiState.value = _uiState.value.copy(
                        user = user,
                        isLoading = false
                    )
                }
                .onFailure { exception ->
                    Log.e(TAG, "Failed to load user: ${exception.message}")
                    _uiState.value = _uiState.value.copy(
                        error = exception.message,
                        isLoading = false
                    )
                }
        }
    }

    fun logout() {
        viewModelScope.launch {
            convexService.clearAuth()
            authManager.logout()
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    companion object {
        private const val TAG = "SettingsViewModel"
    }
}
