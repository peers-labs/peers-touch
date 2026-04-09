package com.peerstouch.mobile.features.settings.repository

import com.peerstouch.mobile.core.storage.PreferenceStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SettingsRepository @Inject constructor(
    private val preferenceStore: PreferenceStore
)
