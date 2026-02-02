package com.carrel.app.core.di

import android.content.Context
import com.carrel.app.core.auth.AuthManager
import com.carrel.app.core.auth.OAuthHandler
import com.carrel.app.core.auth.TokenStorage
import com.carrel.app.core.network.ConvexClient
import com.carrel.app.core.network.ConvexService

class AppContainer(
    val authManager: AuthManager,
    val convexClient: ConvexClient,
    val convexService: ConvexService,
    val oAuthHandler: OAuthHandler
)

fun appModule(context: Context): AppContainer {
    val tokenStorage = TokenStorage(context)
    val authManager = AuthManager(tokenStorage)
    val convexClient = ConvexClient(authManager)
    val convexService = ConvexService(context)
    val oAuthHandler = OAuthHandler(context)

    return AppContainer(
        authManager = authManager,
        convexClient = convexClient,
        convexService = convexService,
        oAuthHandler = oAuthHandler
    )
}
