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
import { api } from '../services/desktop_api'
import { log } from '../utils/logger'

// ── Capability routing ──

interface RoutedCapability {
  capability: string
  action: string
  params?: Record<string, unknown>
}

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
    return ['url', 'applet-id']
  }

  private lynxView: LynxViewElement | null = null

  get appletId(): string {
    return this.getAttribute('applet-id') || ''
  }

  set appletId(value: string) {
    this.setAttribute('applet-id', value)
  }

  get url(): string {
    return this.getAttribute('url') || ''
  }

  set url(value: string) {
    this.setAttribute('url', value)
  }

  // ── Lifecycle ──

  connectedCallback(): void {
    // Styling: fill container
    this.style.display = 'block'
    this.style.width = '100%'
    this.style.height = '100%'
    this.style.overflow = 'hidden'

    if (this.url) {
      this.mountLynxView(this.url)
    }
  }

  disconnectedCallback(): void {
    this.destroyLynxView()
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return

    if (name === 'url' && newValue && this.isConnected) {
      this.mountLynxView(newValue)
    }
  }

  // ── LynxView management ──

  private mountLynxView(bundleUrl: string): void {
    this.destroyLynxView()

    const view = document.createElement('lynx-view') as LynxViewElement
    view.style.width = '100%'
    view.style.height = '100%'

    // Pass applet metadata as globalProps so the applet SDK can read them
    view.globalProps = {
      appletId: this.appletId,
      protocol: APPLET_BRIDGE_PROTOCOL,
    }

    // Bridge: intercept all NativeModules calls from the applet
    view.onNativeModulesCall = (methodName: string, data: any, moduleName: string) => {
      return this.handleNativeModulesCall(moduleName, methodName, data)
    }

    // Set URL last — this triggers the bundle load
    view.url = bundleUrl

    this.lynxView = view
    this.appendChild(view)

    log.info('lynx-host', `Mounted lynx-view for applet: ${this.appletId}`)
    this.dispatchEvent(new CustomEvent('load', { detail: { appletId: this.appletId } }))
  }

  private destroyLynxView(): void {
    if (!this.lynxView) return

    this.lynxView.remove()
    this.lynxView = null
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
    data: any,
  ): Promise<any> {
    const appletId = this.appletId

    // Only handle calls to the "bridge" module
    if (moduleName !== 'bridge') {
      log.warn('lynx-host', `Unknown NativeModule: ${moduleName}`, { appletId })
      return { error: { code: 'UNKNOWN_MODULE', message: `Module "${moduleName}" not supported` } }
    }

    // The bridge module exposes a single "invoke" method
    if (methodName !== 'invoke') {
      log.warn('lynx-host', `Unknown bridge method: ${methodName}`, { appletId })
      return { error: { code: 'UNKNOWN_METHOD', message: `Method "${methodName}" not supported` } }
    }

    // Parse the capability call
    const { method, params } = data as { method: string; params?: unknown }
    if (!method || typeof method !== 'string') {
      return { error: { code: 'INVALID_ARGS', message: 'Missing "method" in bridge.invoke call' } }
    }

    try {
      const routed = parseMethod(method, params)
      const result = await api.appletInvoke(
        appletId,
        routed.capability,
        routed.action || undefined,
        routed.params as Record<string, any> | undefined,
      )
      return { result }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('lynx-host', `Bridge call failed: ${method}`, { appletId, error: message })
      return { error: { code: 'INVOKE_ERROR', message } }
    }
  }

  // ── Host → Applet communication ──

  /**
   * Send an event to the running applet via Lynx globalEvent.
   */
  sendEvent(topic: string, payload?: unknown): void {
    if (!this.lynxView) return
    this.lynxView.sendGlobalEvent(topic, [payload] as any)
  }
}
