package com.peerstouch.mobile.features.ai.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.ai.repository.AIRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class AIViewModel @Inject constructor(
    private val aiRepository: AIRepository
) : ViewModel()
