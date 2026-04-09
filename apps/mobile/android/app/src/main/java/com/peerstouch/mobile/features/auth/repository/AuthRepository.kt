package com.peerstouch.mobile.features.auth.repository

import com.peerstouch.mobile.core.network.StationApi
import com.peerstouch.mobile.core.storage.PreferenceStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AuthRepository @Inject constructor(
    private val stationApi: StationApi,
    private val preferenceStore: PreferenceStore
)
