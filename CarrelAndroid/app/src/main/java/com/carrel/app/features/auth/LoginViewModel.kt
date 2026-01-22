package com.carrel.app.features.auth

import androidx.lifecycle.ViewModel
import com.carrel.app.core.auth.OAuthHandler
import com.carrel.app.core.auth.OAuthProvider

class LoginViewModel(
    private val oAuthHandler: OAuthHandler
) : ViewModel() {

    fun signIn(provider: OAuthProvider) {
        oAuthHandler.launchOAuth(provider)
    }
}
