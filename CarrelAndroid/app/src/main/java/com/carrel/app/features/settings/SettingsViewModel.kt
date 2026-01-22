package com.carrel.app.features.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.network.ConvexClient
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
    private val convexClient: ConvexClient,
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

            convexClient.user()
                .onSuccess { user ->
                    _uiState.value = _uiState.value.copy(
                        user = user,
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

    fun logout() {
        viewModelScope.launch {
            authManager.logout()
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }
}
