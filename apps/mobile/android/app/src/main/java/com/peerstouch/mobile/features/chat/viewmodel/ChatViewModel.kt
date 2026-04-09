package com.peerstouch.mobile.features.chat.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.chat.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository
) : ViewModel()
