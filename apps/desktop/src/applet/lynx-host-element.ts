/**
 * lynx-host-element.ts — Custom Element wrapping a <lynx-view> for applet rendering.
 *
 * Uses Lynx for Web runtime instead of iframe. Bridge calls from the applet's
 * NativeModules are intercepted via `onNativeModulesCall` and forwarded to
 * Tauri's `applets_invoke` command through the Capability Gateway.
 *
 * Architecture contract:
 *   - No iframe, no postMessage.
 *   - Applet bundle loaded by <lynx-view url="...">.
 *   - Bridge: NativeModules.bridge.invoke({method, params}) → Tauri.
 *   - Host → Applet events via lynxView.sendGlobalEvent().
 */
import type { LynxViewElement } from '@lynx-js/web-core/client'
import { APPLET_BRIDGE_PROTOCOL } from './types'
import { ensureLynxWebRuntime } from './lynx-web-runtime'
import { api } from '../services/desktop_api'
import AppletManager from './AppletManager'
import { log } from '../utils/logger'
import type { LynxDebugEvent, LynxDebugLevel } from './LynxDebugPanel'

// ── Capability routing ──

interface RoutedCapability {
  capability: string
  action: string
  params?: Record<string, unknown>
}

type NativeModulesPayload = {
  requestId?: unknown
  method?: unknown
  params?: unknown
}

type LynxGlobalEventPayload = Record<string, unknown>
type LynxSendGlobalEventPayload = Parameters<LynxViewElement['sendGlobalEvent']>[1]
type PollTimer = ReturnType<typeof setInterval>

export interface AppletHostNavigationRequest {
  action: string
  params: Record<string, unknown>
}

export interface AppletHostUiRequest {
  action: string
  params: Record<string, unknown>
  returnsResult: boolean
}

export interface AppletHostDeviceRequest {
  action: string
  params: Record<string, unknown>
  returnsResult: boolean
}

interface BridgeResponseOptions {
  requestId: string
  ok: boolean
  result?: unknown
  error?: {
    code: AppletBridgeErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

type AppletBridgeErrorCode =
  | 'APPLET_NOT_FOUND'
  | 'INVALID_MANIFEST'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_RUNTIME'
  | 'INVALID_SESSION'
  | 'PERMISSION_DENIED'
  | 'INVALID_PARAMS'
  | 'CAPABILITY_NOT_FOUND'
  | 'CAPABILITY_FAILED'
  | 'INTEGRITY_CHECK_FAILED'
  | 'RUNTIME_LOAD_FAILED'
  | 'POLICY_DENIED'
  | 'SERVICE_NOT_FOUND'
  | 'TASK_CANCELLED'
  | 'QUOTA_EXCEEDED'

const APPLET_ERROR_CODES = new Set<AppletBridgeErrorCode>([
  'APPLET_NOT_FOUND',
  'INVALID_MANIFEST',
  'UNSUPPORTED_PLATFORM',
  'UNSUPPORTED_RUNTIME',
  'INVALID_SESSION',
  'PERMISSION_DENIED',
  'INVALID_PARAMS',
  'CAPABILITY_NOT_FOUND',
  'CAPABILITY_FAILED',
  'INTEGRITY_CHECK_FAILED',
  'RUNTIME_LOAD_FAILED',
  'POLICY_DENIED',
  'SERVICE_NOT_FOUND',
  'TASK_CANCELLED',
  'QUOTA_EXCEEDED',
])
const GATEWAY_EVENT_POLL_INTERVAL_MS = 1000

/**
 * Parses a dot-notation method string (e.g. "storage.get") into capability + action.
 * Falls back to treating the whole string as capability with empty action.
 */
function parseMethod(method: string, params: unknown): RoutedCapability {
  const dotIndex = method.indexOf('.')
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>

  if (dotIndex > 0) {
    return {
      capability: method.slice(0, dotIndex),
      action: method.slice(dotIndex + 1),
      params: p,
    }
  }

  return { capability: method, action: '', params: p }
}

// ── Custom Element ──

export class LynxHostElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['url', 'applet-id', 'session-id']
  }

  private lynxView: LynxViewElement | null = null
  private activeSessionId = ''
  private destroyed = false
  private readyEventSent = false
  private visibleEventSent = false
  private pausedEventSent = false
  private visibilityListenersInstalled = false
  private eventPollTimer: PollTimer | null = null
  private mountSequence = 0
  private mountStartedAt = 0
  private pendingEventSubscribers: Array<(event: Record<string, unknown>) => void> = []
  private queuedEvents: Array<Record<string, unknown>> = []
  navigationHandler?: (request: AppletHostNavigationRequest) => void
  uiHandler?: (request: AppletHostUiRequest) => unknown | Promise<unknown>
  deviceHandler?: (request: AppletHostDeviceRequest) => unknown | Promise<unknown>

  get appletId(): string {
    return this.getAttribute('applet-id') || ''
  }

  set appletId(value: string) {
    this.setAttribute('applet-id', value)
  }

  get sessionId(): string {
    return this.getAttribute('session-id') || this.activeSessionId
  }

  set sessionId(value: string) {
    this.setAttribute('session-id', value)
  }

  get url(): string {
    return this.getAttribute('url') || ''
  }

  set url(value: string) {
    this.setAttribute('url', value)
  }

  // ── Lifecycle ──

  connectedCallback(): void {
    this.destroyed = false
    this.activeSessionId = this.getAttribute('session-id') || ''
    this.emitDebug('host.connected', { url: this.url })
    // Styling: fill container
    this.style.display = 'block'
    this.style.width = '100%'
    this.style.height = '100%'
    this.style.overflow = 'hidden'

    if (this.url && this.sessionId) {
      this.mountLynxView(this.url)
    }
    this.installProductVisibilityListeners()
  }

  disconnectedCallback(): void {
    this.emitDebug('host.disconnected')
    this.destroyed = true
    this.removeProductVisibilityListeners()
    this.destroyLynxView()
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return

    if (name === 'session-id') {
      this.activeSessionId = newValue || ''
    }

    if ((name === 'url' || name === 'session-id') && this.url && this.sessionId && this.isConnected) {
      this.emitDebug('host.attribute.changed', { name })
      this.mountLynxView(this.url)
    }
  }

  // ── LynxView management ──

  private async mountLynxView(bundleUrl: string): Promise<void> {
    const sequence = ++this.mountSequence
    this.mountStartedAt = performance.now()
    this.emitDebug('lynx.mount.start', { bundleUrl, sequence })
    this.destroyLynxView()
    this.readyEventSent = false
    this.visibleEventSent = false

    try {
      this.emitDebug('lynx.runtime.ensure.start')
      await ensureLynxWebRuntime()
      this.emitDebug('lynx.runtime.ensure.done')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('lynx-host', 'Failed to load Lynx Web runtime', { appletId: this.appletId, error: message })
      this.emitDebug('lynx.runtime.ensure.error', { error: message }, 'error')
      this.dispatchEvent(new CustomEvent('error', { detail: { appletId: this.appletId, message } }))
      return
    }

    if (!this.isConnected || sequence !== this.mountSequence) {
      this.emitDebug('lynx.mount.cancelled', { sequence }, 'warn')
      return
    }
    this.destroyed = false

    const view = document.createElement('lynx-view') as LynxViewElement
    view.style.width = '100%'
    view.style.height = '100%'
    view.style.display = 'block'

    // Pass applet metadata as globalProps so the applet SDK can read them
    view.globalProps = {
      appletId: this.appletId,
      sessionId: this.sessionId,
      protocol: APPLET_BRIDGE_PROTOCOL,
    }

    // Bridge: intercept all NativeModules calls from the applet
    view.onNativeModulesCall = (methodName: string, data: unknown, moduleName: string) => {
      return this.handleNativeModulesCall(moduleName, methodName, data)
    }

    this.lynxView = view
    this.appendChild(view)
    this.emitDebug('lynx.view.appended', { sequence })
    view.url = bundleUrl
    this.emitDebug('lynx.bundle.url.assigned', { bundleUrl })
    this.startGatewayEventPolling()

    log.info('lynx-host', `Mounted lynx-view for applet: ${this.appletId}`)
    this.dispatchEvent(new CustomEvent('load', { detail: { appletId: this.appletId } }))
  }

  private destroyLynxView(): void {
    if (this.lynxView) {
      this.emitDebug('lynx.view.destroy')
    }
    this.stopGatewayEventPolling()
    this.pendingEventSubscribers = []
    this.queuedEvents = []
    if (!this.lynxView) return

    if (this.visibleEventSent) {
      if (this.pausedEventSent) {
        this.pausedEventSent = false
      }
      this.sendEvent('hide', { sessionId: this.sessionId, reason: 'host-unmount' })
      this.visibleEventSent = false
    }
    this.sendEvent('destroy', { sessionId: this.sessionId })
    void AppletManager.getInstance().unloadApplet(this.appletId)
    this.destroyed = true
    this.lynxView.remove()
    this.lynxView = null
  }

  private startGatewayEventPolling(): void {
    this.stopGatewayEventPolling()
    const manifest = AppletManager.getInstance().getAppletInfo(this.appletId)
    if (!manifest?.permissions?.includes('events.poll')) return

    this.emitDebug('events.poll.start')
    this.eventPollTimer = setInterval(() => {
      void this.pollGatewayEvents()
    }, GATEWAY_EVENT_POLL_INTERVAL_MS)
    ;(this.eventPollTimer as { unref?: () => void }).unref?.()
  }

  private stopGatewayEventPolling(): void {
    if (!this.eventPollTimer) return
    clearInterval(this.eventPollTimer)
    this.eventPollTimer = null
  }

  private async pollGatewayEvents(): Promise<void> {
    if (!this.lynxView || this.destroyed || !this.appletId || !this.sessionId) return
    const manifest = AppletManager.getInstance().getAppletInfo(this.appletId)
    if (!manifest?.permissions?.includes('events.poll')) return

    try {
      const result = await api.appletInvoke<unknown>({
        id: this.appletId,
        sessionId: this.sessionId,
        capability: 'events',
        action: 'poll',
        params: {},
        manifest: {
          id: manifest.id,
          permissions: manifest.permissions,
          services: manifest.services,
          skills: manifest.skills,
        },
      })
      if (!result || typeof result !== 'object' || Array.isArray(result)) return
      const events = Array.isArray((result as Record<string, unknown>).events)
        ? (result as { events: unknown[] }).events
        : []
      for (const event of events) {
        if (!event || typeof event !== 'object' || Array.isArray(event)) continue
        const envelope = event as { topic?: unknown; payload?: unknown }
        if (typeof envelope.topic === 'string') {
          this.emitDebug('events.poll.deliver', { topic: envelope.topic }, 'debug')
          this.sendEvent(envelope.topic, envelope.payload)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('lynx-host', 'Failed to poll applet gateway events', { appletId: this.appletId, error: message })
      this.emitDebug('events.poll.error', { error: message }, 'warn')
    }
  }

  // ── Bridge handler ──

  /**
   * Routes NativeModules calls from applet to Tauri Capability Gateway.
   *
   * Expected calling convention from applet SDK:
   *   NativeModules.bridge.invoke({ method: 'storage.get', params: { key: 'x' } })
   *
   * This maps to:
   *   moduleName = 'bridge', methodName = 'invoke', data = { method, params }
   */
  private async handleNativeModulesCall(
    moduleName: string,
    methodName: string,
    data: unknown,
  ): Promise<Record<string, unknown>> {
    const appletId = this.appletId
    const requestId = this.resolveRequestId(data)
    const bridgeStartedAt = performance.now()

    if (this.destroyed) {
      return this.createBridgeResponse({
        requestId,
        ok: false,
        error: { code: 'INVALID_SESSION', message: 'Applet session is no longer valid' },
      })
    }

    // Only handle calls to the "bridge" module
    if (moduleName !== 'bridge') {
      log.warn('lynx-host', `Unknown NativeModule: ${moduleName}`, { appletId })
      return this.createBridgeResponse({
        requestId,
        ok: false,
        error: { code: 'CAPABILITY_NOT_FOUND', message: `Module "${moduleName}" not supported` },
      })
    }

    // The bridge module exposes a single "invoke" method
    if (methodName !== 'invoke') {
      log.warn('lynx-host', `Unknown bridge method: ${methodName}`, { appletId })
      return this.createBridgeResponse({
        requestId,
        ok: false,
        error: { code: 'CAPABILITY_NOT_FOUND', message: `Method "${methodName}" not supported` },
      })
    }

    // Parse the capability call
    const { method, params } = this.parseNativeModulesPayload(data)
    if (!method || typeof method !== 'string') {
      this.emitDebug('bridge.invoke.invalid', { requestId }, 'warn')
      return this.createBridgeResponse({
        requestId,
        ok: false,
        error: { code: 'INVALID_PARAMS', message: 'Missing "method" in bridge.invoke call' },
      })
    }

    // Local handler: events.subscribe — SDK long-polls for host→applet events
    if (method === 'events.subscribe') {
      this.emitDebug('bridge.invoke.events.subscribe', { requestId }, 'debug')
      return this.handleEventSubscribe(requestId)
    }

    try {
      const routed = parseMethod(method, params)
      this.emitDebug('bridge.invoke.start', {
        requestId,
        method,
        capability: routed.capability,
        action: routed.action,
      }, 'debug')
      const manifest = AppletManager.getInstance().getAppletInfo(appletId)
      if (!manifest) {
        return this.createBridgeResponse({
          requestId,
          ok: false,
          error: { code: 'INVALID_PARAMS', message: `Applet manifest not loaded: ${appletId}` },
        })
      }
      const result = await api.appletInvoke<unknown>({
        id: appletId,
        sessionId: this.sessionId,
        capability: routed.capability,
        action: routed.action || undefined,
        params: routed.params,
        manifest: {
          id: manifest.id,
          permissions: manifest.permissions,
          services: manifest.services,
          skills: manifest.skills,
        },
      })
      const bridgeResult = await this.dispatchGatewaySideEffects(result)
      this.dispatchLifecycleSideEffects(method)
      this.emitDebug('bridge.invoke.done', {
        requestId,
        method,
        elapsedMs: Math.round(performance.now() - bridgeStartedAt),
      }, 'debug')
      return this.createBridgeResponse({
        requestId,
        ok: true,
        result: bridgeResult,
      })
    } catch (error) {
      const appletError = this.normalizeBridgeError(error)
      log.error('lynx-host', `Bridge call failed: ${method}`, { appletId, error: appletError.message })
      this.emitDebug('bridge.invoke.error', {
        requestId,
        method,
        error: appletError.message,
      }, 'error')
      return this.createBridgeResponse({
        requestId,
        ok: false,
        error: appletError,
      })
    }
  }

  private normalizeBridgeError(error: unknown): { code: AppletBridgeErrorCode; message: string; details?: Record<string, unknown> } {
    const message = error instanceof Error ? error.message : String(error)
    const details = typeof error === 'object' && error !== null && 'details' in error
      ? (error as { details?: unknown }).details
      : undefined
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const record = details as Record<string, unknown>
      const appletErrorCode = record.appletErrorCode
      if (typeof appletErrorCode === 'string' && APPLET_ERROR_CODES.has(appletErrorCode as AppletBridgeErrorCode)) {
        return { code: appletErrorCode as AppletBridgeErrorCode, message, details: record }
      }
    }
    return { code: 'CAPABILITY_FAILED', message, details: details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : undefined }
  }

  private resolveRequestId(data: unknown): string {
    if (data && typeof data === 'object' && 'requestId' in data) {
      const requestId = (data as { requestId?: unknown }).requestId
      if (typeof requestId === 'string' && requestId.length > 0) return requestId
    }
    return `desktop-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  private parseNativeModulesPayload(data: unknown): NativeModulesPayload {
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as NativeModulesPayload
    }
    return {}
  }

  private createBridgeResponse(options: BridgeResponseOptions): Record<string, unknown> {
    return {
      protocol: APPLET_BRIDGE_PROTOCOL,
      appletId: this.appletId,
      sessionId: this.sessionId,
      requestId: options.requestId,
      kind: 'response',
      ok: options.ok,
      ...(options.ok ? { result: options.result } : {}),
      ...(!options.ok && options.error
        ? { error: { ...options.error, requestId: options.requestId } }
        : {}),
    }
  }

  private async dispatchGatewaySideEffects(result: unknown): Promise<unknown> {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return result
    }
    const record = result as Record<string, unknown>
    const events = Array.isArray(record.__events) ? record.__events : []
    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      const envelope = event as { topic?: unknown; payload?: unknown }
      if (typeof envelope.topic === 'string') {
        this.emitDebug('gateway.sideEffect.event', { topic: envelope.topic }, 'debug')
        this.sendEvent(envelope.topic, envelope.payload)
      }
    }

    const hostCommands = Array.isArray(record.__hostCommands) ? record.__hostCommands : []
    let hostResult: unknown
    for (const command of hostCommands) {
      const commandResult = await this.dispatchHostCommand(command)
      if (commandResult !== undefined) {
        hostResult = commandResult
      }
    }

    if (!('__events' in record) && !('__hostCommands' in record)) return result
    if (hostResult !== undefined) return hostResult
    const cleanResult = { ...record }
    delete cleanResult.__events
    delete cleanResult.__hostCommands
    return cleanResult
  }

  private dispatchLifecycleSideEffects(method: string): void {
    if (method !== 'lifecycle.reportReady') return

    if (!this.readyEventSent) {
      this.emitDebug('lifecycle.ready', { method })
      this.sendEvent('ready', { sessionId: this.sessionId, state: 'active' })
      this.dispatchEvent(new CustomEvent('ready', { detail: { appletId: this.appletId, sessionId: this.sessionId } }))
      this.readyEventSent = true
    }
    if (!this.visibleEventSent) {
      this.sendEvent('show', { sessionId: this.sessionId, reason: 'host-visible' })
      this.visibleEventSent = true
    }
    this.syncProductVisibility()
  }

  private readonly handleDocumentVisibilityChange = (): void => {
    this.syncProductVisibility()
  }

  private readonly handleWindowBlur = (): void => {
    this.pauseForProductVisibility('window-blur')
  }

  private readonly handleWindowFocus = (): void => {
    this.resumeForProductVisibility('window-focus')
  }

  private installProductVisibilityListeners(): void {
    if (this.visibilityListenersInstalled) return
    this.visibilityListenersInstalled = true
    globalThis.document?.addEventListener?.('visibilitychange', this.handleDocumentVisibilityChange)
    globalThis.window?.addEventListener?.('blur', this.handleWindowBlur)
    globalThis.window?.addEventListener?.('focus', this.handleWindowFocus)
  }

  private removeProductVisibilityListeners(): void {
    if (!this.visibilityListenersInstalled) return
    this.visibilityListenersInstalled = false
    globalThis.document?.removeEventListener?.('visibilitychange', this.handleDocumentVisibilityChange)
    globalThis.window?.removeEventListener?.('blur', this.handleWindowBlur)
    globalThis.window?.removeEventListener?.('focus', this.handleWindowFocus)
  }

  private syncProductVisibility(): void {
    const documentState = globalThis.document as Document | undefined
    const hidden = documentState?.hidden === true || documentState?.visibilityState === 'hidden'
    if (hidden) {
      this.pauseForProductVisibility('document-hidden')
      return
    }
    this.resumeForProductVisibility('document-visible')
  }

  private pauseForProductVisibility(reason: string): void {
    if (!this.lynxView || !this.visibleEventSent || this.pausedEventSent) return
    this.emitDebug('lifecycle.pause', { reason }, 'debug')
    this.sendEvent('pause', { sessionId: this.sessionId, reason })
    this.pausedEventSent = true
  }

  private resumeForProductVisibility(reason: string): void {
    if (!this.lynxView || !this.visibleEventSent || !this.pausedEventSent) return
    this.emitDebug('lifecycle.resume', { reason }, 'debug')
    this.sendEvent('resume', { sessionId: this.sessionId, reason })
    this.pausedEventSent = false
  }

  private async dispatchHostCommand(command: unknown): Promise<unknown> {
    if (!command || typeof command !== 'object' || Array.isArray(command)) return undefined
    const record = command as Record<string, unknown>
    const action = typeof record.action === 'string' ? record.action : ''
    const params = record.params && typeof record.params === 'object' && !Array.isArray(record.params)
      ? record.params as Record<string, unknown>
      : {}
    if (!action) return undefined

    if (record.type === 'navigation') {
      this.emitDebug('host.command.navigation', { action }, 'debug')
      const request = { action, params }
      if (this.navigationHandler) {
        this.navigationHandler(request)
        return undefined
      }
      this.dispatchEvent(new CustomEvent('applet-navigation', {
        detail: request,
        bubbles: true,
        composed: true,
      }))
      return undefined
    }

    if (record.type === 'ui') {
      this.emitDebug('host.command.ui', { action }, 'debug')
      const request = {
        action,
        params,
        returnsResult: record.returnsResult === true,
      }
      if (this.uiHandler) {
        const result = await this.uiHandler(request)
        return request.returnsResult ? result : undefined
      }
      this.dispatchEvent(new CustomEvent('applet-ui', {
        detail: request,
        bubbles: true,
        composed: true,
      }))
      return undefined
    }

    if (record.type === 'device') {
      this.emitDebug('host.command.device', { action }, 'debug')
      const request = {
        action,
        params,
        returnsResult: record.returnsResult === true,
      }
      if (this.deviceHandler) {
        const result = await this.deviceHandler(request)
        return request.returnsResult ? result : undefined
      }
      this.dispatchEvent(new CustomEvent('applet-device', {
        detail: request,
        bubbles: true,
        composed: true,
      }))
      return undefined
    }

    return undefined
  }

  // ── Host → Applet communication ──

  /**
   * Handle the SDK's events.subscribe long-poll.
   * If there's a queued event, resolve immediately; otherwise hold the promise
   * until sendEvent is called.
   */
  private handleEventSubscribe(requestId: string): Promise<Record<string, unknown>> {
    const queued = this.queuedEvents.shift()
    if (queued) {
      return Promise.resolve(this.createBridgeResponse({ requestId, ok: true, result: queued }))
    }
    return new Promise<Record<string, unknown>>((resolve) => {
      this.pendingEventSubscribers.push((event) => {
        resolve(this.createBridgeResponse({ requestId, ok: true, result: event }))
      })
    })
  }

  /**
   * Send an event to the running applet via Lynx globalEvent.
   * Also resolves any pending events.subscribe long-poll from the SDK.
   */
  sendEvent(topic: string, payload?: unknown): void {
    if (!this.lynxView) return
    this.emitDebug('host.event.send', { topic }, 'debug')
    const eventPayload: LynxGlobalEventPayload = {
      protocol: APPLET_BRIDGE_PROTOCOL,
      appletId: this.appletId,
      sessionId: this.sessionId,
      requestId: `desktop-event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      kind: 'event',
      topic,
      event: topic,
      payload,
    }

    // Deliver via bridge long-poll channel (primary path for web-core)
    const subscriber = this.pendingEventSubscribers.shift()
    if (subscriber) {
      subscriber(eventPayload)
    } else {
      this.queuedEvents.push(eventPayload)
    }

    // Also send via sendGlobalEvent for forward-compatibility if web-core
    // ever implements GlobalEventEmitter in the future
    this.lynxView.sendGlobalEvent('applet.event', [eventPayload] as unknown as LynxSendGlobalEventPayload)
  }

  private emitDebug(stage: string, data?: Record<string, unknown>, level: LynxDebugLevel = 'info'): void {
    if (!import.meta.env.DEV) return
    const event: LynxDebugEvent = {
      appletId: this.appletId,
      data,
      elapsedMs: this.mountStartedAt > 0 ? performance.now() - this.mountStartedAt : undefined,
      level,
      sessionId: this.sessionId,
      stage,
      timestamp: Date.now(),
    }
    this.dispatchEvent(new CustomEvent<LynxDebugEvent>('applet-debug', {
      detail: event,
      bubbles: true,
      composed: true,
    }))
  }
}
