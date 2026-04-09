package com.peerstouch.mobile.features.search.repository

import com.peerstouch.mobile.core.network.StationApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SearchRepository @Inject constructor(
    private val stationApi: StationApi
)
