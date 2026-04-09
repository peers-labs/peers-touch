package com.peerstouch.mobile.features.applets.repository

import com.peerstouch.mobile.core.applet.AppletManager
import com.peerstouch.mobile.core.network.StationApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class AppletsRepository @Inject constructor(
    private val stationApi: StationApi,
    private val appletManager: AppletManager
)
