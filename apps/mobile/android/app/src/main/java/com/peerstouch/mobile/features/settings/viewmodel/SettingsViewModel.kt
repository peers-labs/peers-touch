package com.peerstouch.mobile.features.settings.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.settings.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository
) : ViewModel()
