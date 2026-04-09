package com.peerstouch.mobile.features.channels.repository

import com.peerstouch.mobile.core.network.StationApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ChannelsRepository @Inject constructor(
    private val stationApi: StationApi
)
