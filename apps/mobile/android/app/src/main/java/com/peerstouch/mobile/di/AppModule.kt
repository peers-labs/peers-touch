package com.peerstouch.mobile.di

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.preferencesDataStore
import com.peerstouch.mobile.core.event.EventStreamClient
import com.peerstouch.mobile.core.storage.AppDatabase
import com.peerstouch.mobile.core.storage.PreferenceStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import okhttp3.OkHttpClient
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "peers_touch_prefs")

@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideDataStore(@ApplicationContext context: Context): DataStore<Preferences> {
        return context.dataStore
    }

    @Provides
    @Singleton
    fun providePreferenceStore(dataStore: DataStore<Preferences>): PreferenceStore {
        return PreferenceStore(dataStore)
    }

    @Provides
    @Singleton
    fun provideEventStreamClient(okHttpClient: OkHttpClient): EventStreamClient {
        return EventStreamClient(okHttpClient)
    }
}
