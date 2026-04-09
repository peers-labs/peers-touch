package com.peerstouch.mobile.features.skills.repository

import com.peerstouch.mobile.core.network.StationApi
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SkillsRepository @Inject constructor(
    private val stationApi: StationApi
)
