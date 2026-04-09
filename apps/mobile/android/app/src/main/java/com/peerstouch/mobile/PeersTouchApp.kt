package com.peerstouch.mobile

import android.app.Application
import com.peerstouch.mobile.core.lynx.LynxEngineManager
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class PeersTouchApp : Application() {

    @Inject
    lateinit var lynxEngineManager: LynxEngineManager

    override fun onCreate() {
        super.onCreate()
        lynxEngineManager.initialize(this)
    }

    override fun onTerminate() {
        lynxEngineManager.shutdown()
        super.onTerminate()
    }
}
