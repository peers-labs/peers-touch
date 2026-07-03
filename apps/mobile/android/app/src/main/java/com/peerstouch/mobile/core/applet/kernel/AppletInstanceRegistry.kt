package com.peerstouch.mobile.core.applet.kernel

import com.peerstouch.mobile.core.applet.AppletState

class AppletInstanceRegistry {
    private val records = linkedMapOf<AppletInstanceKey, AppletInstanceRecord>()

    fun create(
        appletId: String,
        instanceId: String,
        sessionId: String,
        manifestVersion: String,
        timestampMs: Long
    ): AppletInstanceRecord {
        val key = AppletInstanceKey(appletId, instanceId)
        val record = AppletInstanceRecord(
            appletId = appletId,
            instanceId = instanceId,
            sessionId = sessionId,
            state = AppletState.MATERIALIZING,
            createdAtMs = timestampMs,
            lastVisibleAtMs = 0L,
            lastHiddenAtMs = 0L,
            lastTouchedAtMs = timestampMs,
            memoryEstimateBytes = 0L,
            crashCount = 0,
            manifestVersion = manifestVersion
        )
        records[key] = record
        return record
    }

    fun get(appletId: String, instanceId: String): AppletInstanceRecord? =
        records[AppletInstanceKey(appletId, instanceId)]

    fun getByAppletId(appletId: String): AppletInstanceRecord? =
        records.values.firstOrNull { it.appletId == appletId }

    fun all(): List<AppletInstanceRecord> = records.values.toList()

    fun update(record: AppletInstanceRecord) {
        records[AppletInstanceKey(record.appletId, record.instanceId)] = record
    }

    fun remove(appletId: String, instanceId: String) {
        records.remove(AppletInstanceKey(appletId, instanceId))
    }

    fun clear() {
        records.clear()
    }
}
