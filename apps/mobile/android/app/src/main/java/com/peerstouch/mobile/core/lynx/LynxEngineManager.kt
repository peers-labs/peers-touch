package com.peerstouch.mobile.core.lynx

import android.content.Context
import android.app.Application
import com.lynx.tasm.LynxEnv

class LynxEngineManager constructor() {
    var isInitialized: Boolean = false
        private set

    private var applicationContext: Context? = null

    fun initialize(context: Context) {
        if (isInitialized) return
        applicationContext = context.applicationContext
        LynxEnv.inst().init(
            context.applicationContext as Application,
            null,
            null,
            null
        )
        isInitialized = true
    }

    fun shutdown() {
        if (!isInitialized) return
        isInitialized = false
        applicationContext = null
    }

    fun getApplicationContext(): Context {
        return applicationContext ?: throw IllegalStateException("LynxEngineManager not initialized")
    }
}
