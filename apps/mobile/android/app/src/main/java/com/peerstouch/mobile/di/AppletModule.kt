package com.peerstouch.mobile.di

import android.content.Context
import com.peerstouch.mobile.core.applet.AppletBundleStorage
import com.peerstouch.mobile.core.applet.AppletManager
import com.peerstouch.mobile.core.applet.kernel.AppletSurfaceCache
import com.peerstouch.mobile.core.lynx.LynxEngineManager
import com.peerstouch.mobile.core.lynx.LynxViewFactory
import com.peerstouch.mobile.core.lynx.bridge.BridgeDispatcher
import com.peerstouch.mobile.core.lynx.bridge.BridgeModule
import com.peerstouch.mobile.core.lynx.bridge.DeviceBridgeModule
import com.peerstouch.mobile.core.lynx.bridge.NetworkBridgeModule
import com.peerstouch.mobile.core.lynx.bridge.NotificationBridgeModule
import com.peerstouch.mobile.core.lynx.bridge.StorageBridgeModule
import com.peerstouch.mobile.core.lynx.bridge.SystemBridgeModule
import com.peerstouch.mobile.core.lynx.bridge.UIBridgeModule
import dagger.Module
import dagger.Provides
import dagger.multibindings.IntoSet
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppletModule {

    @Provides
    @Singleton
    fun provideLynxEngineManager(): LynxEngineManager {
        return LynxEngineManager()
    }

    @Provides
    @Singleton
    fun provideLynxViewFactory(lynxEngineManager: LynxEngineManager): LynxViewFactory {
        return LynxViewFactory(lynxEngineManager)
    }

    @Provides
    @Singleton
    fun provideAppletSurfaceCache(lynxViewFactory: LynxViewFactory): AppletSurfaceCache {
        return AppletSurfaceCache(lynxViewFactory)
    }

    @Provides
    @IntoSet
    fun provideSystemBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return SystemBridgeModule(context)
    }

    @Provides
    @IntoSet
    fun provideStorageBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return StorageBridgeModule(context)
    }

    @Provides
    @IntoSet
    fun provideNetworkBridgeModule(okHttpClient: okhttp3.OkHttpClient): BridgeModule {
        return NetworkBridgeModule(okHttpClient)
    }

    @Provides
    @IntoSet
    fun provideNotificationBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return NotificationBridgeModule(context)
    }

    @Provides
    @IntoSet
    fun provideDeviceBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return DeviceBridgeModule(context)
    }

    @Provides
    @IntoSet
    fun provideUIBridgeModule(@ApplicationContext context: Context): BridgeModule {
        return UIBridgeModule(context)
    }

    @Provides
    @Singleton
    fun provideBridgeDispatcher(modules: Set<@JvmSuppressWildcards BridgeModule>): BridgeDispatcher {
        return BridgeDispatcher(modules)
    }

    @Provides
    @Singleton
    fun provideAppletBundleStorage(@ApplicationContext context: Context): AppletBundleStorage {
        return AppletBundleStorage(context)
    }

    @Provides
    @Singleton
    fun provideAppletManager(
        appletBundleStorage: AppletBundleStorage,
        bridgeDispatcher: BridgeDispatcher,
        appletSurfaceCache: AppletSurfaceCache
    ): AppletManager {
        return AppletManager(appletBundleStorage, bridgeDispatcher, appletSurfaceCache)
    }
}
