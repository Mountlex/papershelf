package com.carrel.app.core.di

import android.content.Context
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.auth.OAuthHandler
import com.carrel.app.core.auth.TokenStorage
import com.carrel.app.core.network.ConvexClient

class AppContainer(
    val authManager: AuthManager,
    val convexClient: ConvexClient,
    val oAuthHandler: OAuthHandler
)

fun appModule(context: Context): AppContainer {
    val tokenStorage = TokenStorage(context)
    val authManager = AuthManager(tokenStorage)
    val convexClient = ConvexClient(authManager)
    val oAuthHandler = OAuthHandler(context)

    return AppContainer(
        authManager = authManager,
        convexClient = convexClient,
        oAuthHandler = oAuthHandler
    )
}
