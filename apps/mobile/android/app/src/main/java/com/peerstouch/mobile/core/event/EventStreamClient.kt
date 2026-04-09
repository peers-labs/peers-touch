package com.peerstouch.mobile.core.event

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

data class ServerEvent(
    val type: String,
    val data: String,
    val id: String? = null
)

class EventStreamClient(
    private val okHttpClient: OkHttpClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _events = MutableSharedFlow<ServerEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<ServerEvent> = _events.asSharedFlow()

    private var eventSource: EventSource? = null
    private var reconnectJob: Job? = null
    private var baseUrl: String = ""
    private var token: String = ""

    fun connect(baseUrl: String, token: String) {
        this.baseUrl = baseUrl
        this.token = token
        startConnection()
    }

    fun disconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
        eventSource?.cancel()
        eventSource = null
    }

    private fun startConnection() {
        eventSource?.cancel()

        val request = Request.Builder()
            .url("$baseUrl/events/stream")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Accept", "text/event-stream")
            .build()

        val factory = EventSources.createFactory(okHttpClient)
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                scope.launch {
                    _events.emit(ServerEvent(type = type ?: "message", data = data, id = id))
                }
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                scheduleReconnect()
            }

            override fun onClosed(eventSource: EventSource) {
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            delay(5000)
            startConnection()
        }
    }
}
