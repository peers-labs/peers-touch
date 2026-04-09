package com.peerstouch.mobile.features.profile.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.profile.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val profileRepository: ProfileRepository
) : ViewModel()
