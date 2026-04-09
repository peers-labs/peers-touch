package com.peerstouch.mobile.features.channels.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.channels.repository.ChannelsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class ChannelsViewModel @Inject constructor(
    private val channelsRepository: ChannelsRepository
) : ViewModel()
