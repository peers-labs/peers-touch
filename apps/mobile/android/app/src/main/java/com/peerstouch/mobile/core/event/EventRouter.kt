package com.peerstouch.mobile.core.event

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

typealias EventHandler = suspend (data: String) -> Unit

@Singleton
class EventRouter @Inject constructor(
    private val eventStreamClient: EventStreamClient
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val handlers = mutableMapOf<String, MutableList<EventHandler>>()

    fun register(eventType: String, handler: EventHandler) {
        handlers.getOrPut(eventType) { mutableListOf() }.add(handler)
    }

    fun unregister(eventType: String, handler: EventHandler) {
        handlers[eventType]?.remove(handler)
    }

    fun startListening() {
        scope.launch {
            eventStreamClient.events.collect { event ->
                val typeHandlers = handlers[event.type]
                typeHandlers?.forEach { handler ->
                    launch {
                        handler(event.data)
                    }
                }
            }
        }
    }
}
