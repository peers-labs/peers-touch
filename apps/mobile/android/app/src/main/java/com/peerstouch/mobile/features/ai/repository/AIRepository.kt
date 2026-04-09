package com.peerstouch.mobile.features.ai.repository

import com.peerstouch.mobile.core.network.StationApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AIRepository @Inject constructor(
    private val stationApi: StationApi
)
