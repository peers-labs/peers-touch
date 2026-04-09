package com.peerstouch.mobile.features.timeline.repository

import com.peerstouch.mobile.core.network.StationApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TimelineRepository @Inject constructor(
    private val stationApi: StationApi
)
