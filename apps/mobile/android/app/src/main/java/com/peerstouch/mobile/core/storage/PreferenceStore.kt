package com.peerstouch.mobile.core.storage

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class PreferenceStore(
    private val dataStore: DataStore<Preferences>
) {
    companion object {
        private val KEY_ACCESS_TOKEN = stringPreferencesKey("access_token")
        private val KEY_REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        private val KEY_STATION_URL = stringPreferencesKey("station_url")
        private val KEY_USER_ID = stringPreferencesKey("user_id")
        private val KEY_DARK_MODE = booleanPreferencesKey("dark_mode")
    }

    fun getAccessToken(): Flow<String?> = dataStore.data.map { it[KEY_ACCESS_TOKEN] }

    fun getRefreshToken(): Flow<String?> = dataStore.data.map { it[KEY_REFRESH_TOKEN] }

    fun getStationUrl(): Flow<String?> = dataStore.data.map { it[KEY_STATION_URL] }

    fun getUserId(): Flow<String?> = dataStore.data.map { it[KEY_USER_ID] }

    fun getDarkMode(): Flow<Boolean> = dataStore.data.map { it[KEY_DARK_MODE] ?: false }

    suspend fun setAccessToken(token: String) {
        dataStore.edit { it[KEY_ACCESS_TOKEN] = token }
    }

    suspend fun setRefreshToken(token: String) {
        dataStore.edit { it[KEY_REFRESH_TOKEN] = token }
    }

    suspend fun setStationUrl(url: String) {
        dataStore.edit { it[KEY_STATION_URL] = url }
    }

    suspend fun setUserId(userId: String) {
        dataStore.edit { it[KEY_USER_ID] = userId }
    }

    suspend fun setDarkMode(enabled: Boolean) {
        dataStore.edit { it[KEY_DARK_MODE] = enabled }
    }

    suspend fun clearAuth() {
        dataStore.edit {
            it.remove(KEY_ACCESS_TOKEN)
            it.remove(KEY_REFRESH_TOKEN)
            it.remove(KEY_USER_ID)
        }
    }
}
