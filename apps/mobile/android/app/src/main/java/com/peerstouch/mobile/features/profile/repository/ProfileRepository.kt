package com.peerstouch.mobile.features.profile.repository

import com.peerstouch.mobile.core.network.StationApi
import com.peerstouch.mobile.core.storage.PreferenceStore
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProfileRepository @Inject constructor(
    private val stationApi: StationApi,
    private val preferenceStore: PreferenceStore
)
