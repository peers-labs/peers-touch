package com.peerstouch.mobile.features.auth.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.auth.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AuthViewModel @Inject constructor(
    private val authRepository: AuthRepository
) : ViewModel()
