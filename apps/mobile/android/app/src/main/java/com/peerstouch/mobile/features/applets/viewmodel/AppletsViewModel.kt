package com.peerstouch.mobile.features.applets.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.applets.repository.AppletsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AppletsViewModel @Inject constructor(
    private val appletsRepository: AppletsRepository
) : ViewModel()
