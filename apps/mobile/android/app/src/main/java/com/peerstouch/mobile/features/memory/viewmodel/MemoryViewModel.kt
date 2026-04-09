package com.peerstouch.mobile.features.memory.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.memory.repository.MemoryRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class MemoryViewModel @Inject constructor(
    private val memoryRepository: MemoryRepository
) : ViewModel()
