package com.peerstouch.mobile.features.timeline.viewmodel

import androidx.lifecycle.ViewModel
import com.peerstouch.mobile.features.timeline.repository.TimelineRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

@HiltViewModel
class TimelineViewModel @Inject constructor(
    private val timelineRepository: TimelineRepository
) : ViewModel()
