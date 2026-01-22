package com.carrel.app

import android.app.Application
import com.carrel.app.core.di.appModule
import com.carrel.app.core.di.AppContainer

class CarrelApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = appModule(this)
    }
}
