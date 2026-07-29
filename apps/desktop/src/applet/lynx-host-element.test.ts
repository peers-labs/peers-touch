import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPLET_BRIDGE_PROTOCOL } from './types'

const mockAppletInvoke = vi.fn()
const mockGetAppletInfo = vi.fn()
const mockUnloadApplet = vi.fn()

vi.mock('../services/desktop_api', () => ({
  api: {
    appletInvoke: mockAppletInvoke,
  },
}))

vi.mock('./AppletManager', () => ({
  default: {
    getInstance: () => ({
      getAppletInfo: mockGetAppletInfo,
      unloadApplet: mockUnloadApplet,
    }),
  },
}))

vi.mock('./lynx-web-runtime', () => ({
  ensureLynxWebRuntime: vi.fn().mockResolvedValue(undefined),
}))

class TestCustomEvent {
  type: string
  detail?: unknown

  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type
    this.detail = init?.detail
  }
}

class TestHTMLElement {
  style: Record<string, string> = {}
  isConnected = true
  appended: unknown[] = []
  dispatched: unknown[] = []
  private attributes = new Map<string, string>()

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  appendChild(child: unknown): unknown {
    this.appended.push(child)
    return child
  }

  dispatchEvent(event: unknown): boolean {
    this.dispatched.push(event)
    return true
  }
}

interface FakeLynxView {
  style: Record<string, string>
  globalProps?: Record<string, unknown>
  url?: string
  onNativeModulesCall?: (methodName: string, data: unknown, moduleName: string) => Promise<Record<string, unknown>>
  sendGlobalEvent: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

interface FakeEventTarget {
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  emit(type: string): void
  innerWidth?: number
  innerHeight?: number
  devicePixelRatio?: number
}

interface HostUnderTest {
  appletId: string
  sessionId: string
  url: string
  navigationHandler?: (request: { action: string; params: Record<string, unknown> }) => void
  uiHandler?: (request: { action: string; params: Record<string, unknown>; returnsResult: boolean }) => unknown | Promise<unknown>
  deviceHandler?: (request: { action: string; params: Record<string, unknown>; returnsResult: boolean }) => unknown | Promise<unknown>
  connectedCallback(): void
}

function manifest() {
  return {
    id: 'bridge-test',
    permissions: ['network.request', 'lifecycle.destroy', 'events.poll'],
    services: [
      {
        id: 'primary-api',
        kind: 'http',
        binding: 'station-resolved',
        allowedMethods: ['GET'],
        allowedPaths: ['/api/v1/*'],
      },
    ],
    skills: [],
  }
}

async function createMountedHost() {
  const fakeView: FakeLynxView = {
    style: {},
    sendGlobalEvent: vi.fn(),
    remove: vi.fn(),
  }
  const documentListeners = new Map<string, Set<() => void>>()
  const windowListeners = new Map<string, Set<() => void>>()
  const addListener = (listeners: Map<string, Set<() => void>>, type: string, listener: () => void) => {
    const set = listeners.get(type) ?? new Set()
    set.add(listener)
    listeners.set(type, set)
  }
  const removeListener = (listeners: Map<string, Set<() => void>>, type: string, listener: () => void) => {
    listeners.get(type)?.delete(listener)
  }
  const emit = (listeners: Map<string, Set<() => void>>, type: string) => {
    for (const listener of listeners.get(type) ?? []) {
      listener()
    }
  }
  const fakeDocument = {
    hidden: false,
    visibilityState: 'visible',
    createElement: vi.fn((name: string) => {
      if (name !== 'lynx-view') {
        throw new Error(`Unexpected element requested: ${name}`)
      }
      return fakeView
    }),
    addEventListener: vi.fn((type: string, listener: () => void) => addListener(documentListeners, type, listener)),
    removeEventListener: vi.fn((type: string, listener: () => void) => removeListener(documentListeners, type, listener)),
    emit: (type: string) => emit(documentListeners, type),
  }
  const fakeWindow: FakeEventTarget = {
    innerWidth: 1440,
    innerHeight: 900,
    devicePixelRatio: 2,
    addEventListener: vi.fn((type: string, listener: () => void) => addListener(windowListeners, type, listener)),
    removeEventListener: vi.fn((type: string, listener: () => void) => removeListener(windowListeners, type, listener)),
    emit: (type: string) => emit(windowListeners, type),
  }

  vi.stubGlobal('HTMLElement', TestHTMLElement)
  vi.stubGlobal('CustomEvent', TestCustomEvent)
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('window', fakeWindow)

  vi.resetModules()
  const { LynxHostElement } = await import('./lynx-host-element')
  const host = new LynxHostElement() as unknown as HostUnderTest
  host.appletId = 'bridge-test'
  host.sessionId = 'desktop-session-bridge-test'
  host.url = '/applets-dist/bridge-test/main.lynx.bundle'
  host.connectedCallback()
  await Promise.resolve()

  return { host, fakeView, fakeDocument, fakeWindow }
}

describe('LynxHostElement bridge integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockAppletInvoke.mockReset()
    mockGetAppletInfo.mockReset()
    mockUnloadApplet.mockReset()
    mockGetAppletInfo.mockReturnValue(manifest())
    mockUnloadApplet.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('routes NativeModules bridge.invoke calls to the Desktop Gateway with session and manifest', async () => {
    const { fakeView } = await createMountedHost()
    mockAppletInvoke.mockResolvedValue({ status: 200, body: { ok: true } })

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-1',
        method: 'network.request',
        params: { service: 'primary-api', path: '/api/v1/e2e' },
      },
      'bridge',
    )

    expect(mockAppletInvoke).toHaveBeenCalledWith(expect.objectContaining({
      id: 'bridge-test',
      capability: 'network',
      action: 'request',
      params: { service: 'primary-api', path: '/api/v1/e2e' },
      manifest: expect.objectContaining({
        id: 'bridge-test',
        permissions: ['network.request', 'lifecycle.destroy', 'events.poll'],
      }),
    }))
    expect(mockAppletInvoke.mock.calls[0]?.[0].sessionId).toBe('desktop-session-bridge-test')
    expect(response).toEqual(expect.objectContaining({
      protocol: APPLET_BRIDGE_PROTOCOL,
      appletId: 'bridge-test',
      requestId: 'request-1',
      kind: 'response',
      ok: true,
      result: { status: 200, body: { ok: true } },
    }))
  })

  it('routes topic event subscriptions to the Desktop Gateway instead of the local long-poll queue', async () => {
    const { fakeView } = await createMountedHost()
    mockAppletInvoke.mockResolvedValue({ ok: true, topic: 'atelier.projection.event', subscribed: true })

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-events-subscribe',
        method: 'events.subscribe',
        params: { topic: 'atelier.projection.event' },
      },
      'bridge',
    )

    expect(mockAppletInvoke).toHaveBeenCalledWith(expect.objectContaining({
      id: 'bridge-test',
      sessionId: 'desktop-session-bridge-test',
      capability: 'events',
      action: 'subscribe',
      params: { topic: 'atelier.projection.event' },
      manifest: expect.objectContaining({
        id: 'bridge-test',
        permissions: ['network.request', 'lifecycle.destroy', 'events.poll'],
      }),
    }))
    expect(response).toEqual(expect.objectContaining({
      protocol: APPLET_BRIDGE_PROTOCOL,
      appletId: 'bridge-test',
      requestId: 'request-events-subscribe',
      kind: 'response',
      ok: true,
      result: { ok: true, topic: 'atelier.projection.event', subscribed: true },
    }))
  })

  it('polls Gateway event outbox and dispatches background task events', async () => {
    vi.useFakeTimers()
    mockAppletInvoke.mockResolvedValue({
      ok: true,
      events: [
        {
          topic: 'task.event',
          payload: {
            taskId: 'task-1',
            state: 'completed',
          },
        },
      ],
    })

    const { fakeView } = await createMountedHost()

    await vi.advanceTimersByTimeAsync(1000)

    expect(mockAppletInvoke).toHaveBeenCalledWith(expect.objectContaining({
      id: 'bridge-test',
      sessionId: 'desktop-session-bridge-test',
      capability: 'events',
      action: 'poll',
      params: {},
      manifest: expect.objectContaining({
        id: 'bridge-test',
        permissions: ['network.request', 'lifecycle.destroy', 'events.poll'],
      }),
    }))
    expect(fakeView.sendGlobalEvent).toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({
        protocol: APPLET_BRIDGE_PROTOCOL,
        appletId: 'bridge-test',
        kind: 'event',
        topic: 'task.event',
        event: 'task.event',
        payload: { taskId: 'task-1', state: 'completed' },
      })],
    )
  })

  it('dispatches Gateway events through the Lynx global event channel', async () => {
    const { fakeView } = await createMountedHost()
    mockAppletInvoke.mockResolvedValue({
      taskId: 'task-1',
      __events: [
        {
          topic: 'task.event',
          payload: {
            taskId: 'task-1',
            state: 'completed',
          },
        },
      ],
    })

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-2',
        method: 'tasks.start',
        params: { taskType: 'fixture', input: {} },
      },
      'bridge',
    )

    expect(fakeView.sendGlobalEvent).toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({
        protocol: APPLET_BRIDGE_PROTOCOL,
        appletId: 'bridge-test',
        kind: 'event',
        topic: 'task.event',
        event: 'task.event',
        payload: { taskId: 'task-1', state: 'completed' },
      })],
    )
    expect(response?.result).toEqual({ taskId: 'task-1' })
  })

  it('executes Gateway-authorized Host navigation commands and hides them from applet result', async () => {
    const { host, fakeView } = await createMountedHost()
    const navigationHandler = vi.fn()
    host.navigationHandler = navigationHandler
    mockAppletInvoke.mockResolvedValue({
      ok: true,
      __hostCommands: [
        {
          type: 'navigation',
          action: 'navigateTo',
          params: { page: 'applets' },
        },
      ],
    })

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-navigation',
        method: 'navigation.navigateTo',
        params: { page: 'applets' },
      },
      'bridge',
    )

    expect(navigationHandler).toHaveBeenCalledWith({
      action: 'navigateTo',
      params: { page: 'applets' },
    })
    expect(response?.result).toEqual({ ok: true })
  })

  it('executes Gateway-authorized Host UI commands and returns Host modal choices', async () => {
    const { host, fakeView } = await createMountedHost()
    const uiHandler = vi.fn().mockResolvedValue({ confirmed: true, cancelled: false })
    host.uiHandler = uiHandler
    mockAppletInvoke.mockResolvedValue({
      ok: true,
      __hostCommands: [
        {
          type: 'ui',
          action: 'showModal',
          params: { title: 'Review', content: 'Proceed' },
          returnsResult: true,
        },
      ],
    })

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-ui',
        method: 'ui.showModal',
        params: { title: 'Review', content: 'Proceed' },
      },
      'bridge',
    )

    expect(uiHandler).toHaveBeenCalledWith({
      action: 'showModal',
      params: { title: 'Review', content: 'Proceed' },
      returnsResult: true,
    })
    expect(response?.result).toEqual({ confirmed: true, cancelled: false })
  })

  it('executes Atelier artifact preview Host UI commands and hides command metadata from applet result', async () => {
    const { host, fakeView } = await createMountedHost()
    const uiHandler = vi.fn().mockResolvedValue({
      ok: true,
      accepted: true,
      opened: true,
      prepared: true,
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      kind: 'markdown',
      mode: 'sandbox_manifest',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      rendererStatus: 'rendered',
      rendererCapabilities: ['host_owned_renderer_session', 'host_visual_renderer_surface'],
      reason: 'Desktop Host rendered a validated Atelier sandbox preview surface.',
    })
    host.uiHandler = uiHandler
    mockAppletInvoke.mockResolvedValue({
      accepted: true,
      opened: true,
      prepared: true,
      taskId: 'task-1',
      artifactId: 'artifact-1',
      sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
      bodyRef: 'artifact://task-1/artifact-1/body',
      kind: 'markdown',
      mode: 'sandbox_manifest',
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      rendererStatus: 'rendered',
      rendererCapabilities: ['host_owned_renderer_session', 'host_visual_renderer_surface'],
      reason: 'prepared',
      __hostCommands: [
        {
          type: 'ui',
          action: 'openAtelierArtifactPreview',
          params: {
            taskId: 'task-1',
            artifactId: 'artifact-1',
            sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
            bodyRef: 'artifact://task-1/artifact-1/body',
            rendererSessionId: 'atelier-preview:task-1:artifact-1',
            rendererOwner: 'desktop_host',
            rendererMode: 'host_sandbox_manifest',
            rendererStatus: 'rendered',
            rendererCapabilities: ['host_owned_renderer_session', 'host_visual_renderer_surface'],
          },
          returnsResult: true,
        },
      ],
    })

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-atelier-preview',
        method: 'atelier.artifact.preview.open',
        params: {
          taskId: 'task-1',
          artifactId: 'artifact-1',
          sandboxRef: 'atelier-sandbox://task-1/artifact-1/preview',
          bodyRef: 'artifact://task-1/artifact-1/body',
        },
      },
      'bridge',
    )

    expect(uiHandler).toHaveBeenCalledWith({
      action: 'openAtelierArtifactPreview',
      params: expect.objectContaining({
        rendererSessionId: 'atelier-preview:task-1:artifact-1',
        rendererOwner: 'desktop_host',
        rendererMode: 'host_sandbox_manifest',
        rendererStatus: 'rendered',
      }),
      returnsResult: true,
    })
    expect(response?.result).toMatchObject({
      accepted: true,
      opened: true,
      prepared: true,
      rendererSessionId: 'atelier-preview:task-1:artifact-1',
      rendererOwner: 'desktop_host',
      rendererMode: 'host_sandbox_manifest',
      rendererStatus: 'rendered',
      rendererCapabilities: ['host_owned_renderer_session', 'host_visual_renderer_surface'],
    })
    expect((response?.result as Record<string, unknown>).__hostCommands).toBeUndefined()
  })

  it('executes Gateway-authorized Host device commands and returns product viewport data', async () => {
    const { host, fakeView } = await createMountedHost()
    const deviceHandler = vi.fn().mockReturnValue({ width: 1440, height: 900, pixelRatio: 2 })
    host.deviceHandler = deviceHandler
    mockAppletInvoke.mockResolvedValue({
      ok: true,
      __hostCommands: [
        {
          type: 'device',
          action: 'getWindowInfo',
          params: {},
          returnsResult: true,
        },
      ],
    })

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-device',
        method: 'device.getWindowInfo',
        params: {},
      },
      'bridge',
    )

    expect(deviceHandler).toHaveBeenCalledWith({
      action: 'getWindowInfo',
      params: {},
      returnsResult: true,
    })
    expect(response?.result).toEqual({ width: 1440, height: 900, pixelRatio: 2 })
  })

  it('emits Host-driven lifecycle ready/show after reportReady and hide on detach', async () => {
    const { host, fakeView } = await createMountedHost()
    mockAppletInvoke.mockResolvedValue({ ok: true, appletId: 'bridge-test', state: 'active' })

    await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-ready',
        method: 'lifecycle.reportReady',
        params: {},
      },
      'bridge',
    )

    expect(fakeView.sendGlobalEvent).toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({
        protocol: APPLET_BRIDGE_PROTOCOL,
        appletId: 'bridge-test',
        sessionId: 'desktop-session-bridge-test',
        kind: 'event',
        topic: 'ready',
        payload: { sessionId: 'desktop-session-bridge-test', state: 'active' },
      })],
    )
    expect(fakeView.sendGlobalEvent).toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({
        protocol: APPLET_BRIDGE_PROTOCOL,
        appletId: 'bridge-test',
        sessionId: 'desktop-session-bridge-test',
        kind: 'event',
        topic: 'show',
        payload: { sessionId: 'desktop-session-bridge-test', reason: 'host-visible' },
      })],
    )

    ;(host as HostUnderTest & { disconnectedCallback(): void }).disconnectedCallback()

    expect(fakeView.sendGlobalEvent).toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({
        protocol: APPLET_BRIDGE_PROTOCOL,
        appletId: 'bridge-test',
        sessionId: 'desktop-session-bridge-test',
        kind: 'event',
        topic: 'hide',
        payload: { sessionId: 'desktop-session-bridge-test', reason: 'host-detach' },
      })],
    )
    expect(fakeView.sendGlobalEvent).not.toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({ topic: 'destroy' })],
    )
  })

  it('accepts kernel-driven surface pause/resume and ignores product visibility directly', async () => {
    const { host, fakeView, fakeDocument, fakeWindow } = await createMountedHost()
    mockAppletInvoke.mockResolvedValue({ ok: true, appletId: 'bridge-test', state: 'active' })

    await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-ready-visibility',
        method: 'lifecycle.reportReady',
        params: {},
      },
      'bridge',
    )

    ;(fakeView.sendGlobalEvent as ReturnType<typeof vi.fn>).mockClear()
    fakeDocument.hidden = true
    fakeDocument.visibilityState = 'hidden'
    fakeDocument.emit('visibilitychange')
    fakeWindow.emit('blur')
    expect(fakeView.sendGlobalEvent).not.toHaveBeenCalled()

    ;(host as HostUnderTest & { surfacePause(): void }).surfacePause()
    expect(fakeView.sendGlobalEvent).toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({
        protocol: APPLET_BRIDGE_PROTOCOL,
        appletId: 'bridge-test',
        sessionId: 'desktop-session-bridge-test',
        kind: 'event',
        topic: 'pause',
        payload: { sessionId: 'desktop-session-bridge-test', reason: 'kernel-pause' },
      })],
    )

    ;(fakeView.sendGlobalEvent as ReturnType<typeof vi.fn>).mockClear()
    fakeDocument.hidden = false
    fakeDocument.visibilityState = 'visible'
    fakeDocument.emit('visibilitychange')
    fakeWindow.emit('focus')
    expect(fakeView.sendGlobalEvent).not.toHaveBeenCalled()

    ;(host as HostUnderTest & { surfaceResume(): void }).surfaceResume()
    expect(fakeView.sendGlobalEvent).toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({
        protocol: APPLET_BRIDGE_PROTOCOL,
        appletId: 'bridge-test',
        sessionId: 'desktop-session-bridge-test',
        kind: 'event',
        topic: 'resume',
        payload: { sessionId: 'desktop-session-bridge-test', reason: 'kernel-resume' },
      })],
    )
  })

  it('returns primitive Gateway results without treating them as event envelopes', async () => {
    const { fakeView } = await createMountedHost()
    mockAppletInvoke.mockResolvedValue('readiness')

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-primitive',
        method: 'clipboard.getText',
        params: {},
      },
      'bridge',
    )

    expect(response).toEqual(expect.objectContaining({
      protocol: APPLET_BRIDGE_PROTOCOL,
      appletId: 'bridge-test',
      requestId: 'request-primitive',
      kind: 'response',
      ok: true,
      result: 'readiness',
    }))
    expect(fakeView.sendGlobalEvent).not.toHaveBeenCalled()
  })

  it('releases render resources without destroying the manager-owned Gateway session when the host unmounts', async () => {
    const { host, fakeView } = await createMountedHost()

    ;(host as HostUnderTest & { disconnectedCallback(): void }).disconnectedCallback()

    expect(fakeView.sendGlobalEvent).not.toHaveBeenCalledWith(
      'applet.event',
      [expect.objectContaining({ topic: 'destroy' })],
    )
    expect(mockUnloadApplet).not.toHaveBeenCalled()
    expect(fakeView.remove).toHaveBeenCalled()
  })

  it('returns canonical error envelopes and preserves Gateway applet error codes', async () => {
    const { fakeView } = await createMountedHost()
    const error = new Error('permission denied') as Error & { details?: Record<string, unknown> }
    error.details = { appletErrorCode: 'PERMISSION_DENIED' }
    mockAppletInvoke.mockRejectedValue(error)

    const response = await fakeView.onNativeModulesCall?.(
      'invoke',
      {
        requestId: 'request-3',
        method: 'network.request',
        params: { service: 'primary-api', path: '/api/v1/e2e' },
      },
      'bridge',
    )

    expect(response).toEqual(expect.objectContaining({
      protocol: APPLET_BRIDGE_PROTOCOL,
      appletId: 'bridge-test',
      requestId: 'request-3',
      kind: 'response',
      ok: false,
      error: expect.objectContaining({
        code: 'PERMISSION_DENIED',
        message: 'permission denied',
        requestId: 'request-3',
      }),
    }))
  })
})
