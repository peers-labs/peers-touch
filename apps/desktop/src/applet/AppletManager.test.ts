import { beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import AppletManager from './AppletManager'
import { parseAppletIndex, parseAppletInfo } from './schema'
import { APPLET_BRIDGE_PROTOCOL } from './types'

const mockFetch = vi.fn()
const { mockAppletCreateSession, mockAppletInvoke } = vi.hoisted(() => ({
  mockAppletCreateSession: vi.fn(),
  mockAppletInvoke: vi.fn(),
}))
vi.stubGlobal('fetch', mockFetch)
vi.stubGlobal('crypto', webcrypto)

vi.mock('../services/desktop_api', () => ({
  api: {
    appletCreateSession: mockAppletCreateSession,
    appletInvoke: mockAppletInvoke,
  },
}))

const EMPTY_SHA256 = 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

function createValidManifest(id = 'web-search') {
  return {
    id,
    name: 'Web Search',
    version: '1.0.0',
    description: 'Search the web',
    author: 'Peers Touch',
    icon: 'https://example.com/icon.png',
    permissions: ['network.request'],
    targets: ['desktop'],
    targetPlatforms: ['desktop'],
    entries: { lynx: 'main.lynx.bundle' },
    load: {
      desktop: {
        type: 'lynx-web' as const,
        entry: 'main.lynx.bundle',
      },
    },
    bridge: {
      version: '1.0.0',
      protocol: APPLET_BRIDGE_PROTOCOL,
    },
    services: [
      {
        id: 'primary-api',
        kind: 'http' as const,
        binding: 'station-resolved' as const,
        allowedMethods: ['GET'],
        allowedPaths: ['/api/v1/*'],
      },
    ],
    skills: [],
    integrity: {
      algorithm: 'sha256' as const,
      files: {
        'main.lynx.bundle': EMPTY_SHA256,
      },
    },
  }
}

function createComplexManifest(id = 'generic-complex-applet') {
  return {
    ...createValidManifest(id),
    name: 'Generic Complex Applet',
    description: 'Producer-independent complex applet fixture',
    author: 'Peers Touch',
    permissions: [
      'app.getContext',
      'lifecycle.destroy',
      'network.request',
      'skills.register',
      'skills.list',
      'skills.invoke',
      'tasks.start',
      'tasks.get',
      'tasks.cancel',
      'agent.startSession',
      'agent.stream',
      'ai.generate',
      'ai.chat',
      'telemetry.track',
    ],
    targets: ['desktop'],
    entries: { lynx: 'main.lynx.bundle' },
    services: [
      {
        id: 'primary-api',
        kind: 'http' as const,
        binding: 'host-resolved' as const,
        allowedMethods: ['GET', 'POST'],
        allowedPaths: ['/api/v1/*'],
        streaming: true,
      },
    ],
    skills: [
      {
        id: 'generic-skill',
        inputSchema: 'schemas/skill.input.json',
        streaming: true,
      },
    ],
    integrity: {
      algorithm: 'sha256' as const,
      files: {
        'main.lynx.bundle': EMPTY_SHA256,
        'schemas/skill.input.json': EMPTY_SHA256,
      },
    },
  }
}

function createNoteManifest() {
  return {
    ...createValidManifest('peers.note'),
    name: 'Note',
    description: 'Note official applet',
    author: 'Peers Touch',
    permissions: [
      'app.getContext',
      'lifecycle.reportReady',
      'network.request',
      'storage.get',
      'storage.set',
      'storage.remove',
      'ui.showToast',
      'ui.showLoading',
      'ui.hideLoading',
      'ui.showModal',
      'navigation.navigateTo',
      'navigation.back',
      'events.emit',
      'events.subscribe',
      'events.unsubscribe',
      'telemetry.track',
      'telemetry.reportError',
    ],
    targets: ['desktop', 'android', 'ios', 'web'],
    load: {
      desktop: {
        type: 'lynx-web' as const,
        entry: 'main.lynx.bundle',
      },
      android: {
        type: 'lynx-native' as const,
        entry: 'main.lynx.bundle',
      },
      ios: {
        type: 'lynx-native' as const,
        entry: 'main.lynx.bundle',
      },
      web: {
        type: 'lynx-web' as const,
        entry: 'main.lynx.bundle',
      },
    },
    services: [
      {
        id: 'note',
        kind: 'http' as const,
        binding: 'station-resolved' as const,
        allowedMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
        allowedPaths: ['/v1/notes', '/v1/notes/*', '/v1/notes:search'],
        publicPathPrefix: '/v1',
        stationPathPrefix: '/applets/note/v1',
        streaming: false,
      },
    ],
    skills: [],
    integrity: {
      algorithm: 'sha256' as const,
      files: {
        'main.lynx.bundle': EMPTY_SHA256,
      },
    },
  }
}

function indexResponse(manifest: unknown) {
  return {
    ok: true,
    json: async () => ({
      version: 1,
      applets: [manifest],
    }),
  }
}

function fileResponse(content = '') {
  return {
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  }
}

function mockAppletPackage(manifest: unknown, files: Record<string, string> = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url === '/applets-dist/index.json') {
      return indexResponse(manifest)
    }
    const relativePath = url
      .replace('/applets-dist/generic-complex-applet/', '')
      .replace('/applets-dist/web-search/', '')
      .replace('/applets-dist/peers.note/', '')
    return fileResponse(files[relativePath] ?? '')
  })
}

function resetManagerState() {
  const manager = AppletManager.getInstance() as unknown as {
    applets: Map<string, unknown>
    appletInstances: Map<string, unknown>
    rejectedDiagnostics: Map<string, string[]>
    indexDiagnostics: string[]
  }
  manager.applets.clear()
  manager.appletInstances.clear()
  manager.rejectedDiagnostics.clear()
  manager.indexDiagnostics = []
}

describe('applet schema validation', () => {
  it('validates manifest and index payload', () => {
    const manifest = createValidManifest()
    const manifestCheck = parseAppletInfo(manifest, 'index.applets[0]')
    expect(manifestCheck.ok).toBe(true)
    if (!manifestCheck.ok) return
    expect(manifestCheck.value.id).toBe('web-search')
    expect(manifestCheck.value.load.desktop?.entry).toBe('main.lynx.bundle')

    const indexCheck = parseAppletIndex({
      version: 1,
      applets: [manifest],
    })
    expect(indexCheck.ok).toBe(true)
  })

  it('rejects invalid manifest/index payload', () => {
    const invalidManifest = createValidManifest('Bad_ID')
    const manifestCheck = parseAppletInfo(invalidManifest, 'index.applets[0]')
    expect(manifestCheck.ok).toBe(false)

    const indexCheck = parseAppletIndex({
      version: 'invalid' as unknown,
      applets: [],
    })
    expect(indexCheck.ok).toBe(false)
  })

  it('rejects invalid load type', () => {
    const badManifest = {
      ...createValidManifest('bad-load'),
      load: {
        desktop: {
          type: 'iframe',
          entry: 'index.html',
        },
      },
    }
    const manifestCheck = parseAppletInfo(badManifest, 'index.applets[0]')
    expect(manifestCheck.ok).toBe(false)
    if (manifestCheck.ok) return
    expect(manifestCheck.issues.some((issue) => issue.includes('lynx-web'))).toBe(true)
  })

  it('accepts producer-independent complex desktop manifest fields', () => {
    const manifestCheck = parseAppletInfo(createComplexManifest(), 'index.applets[0]')
    expect(manifestCheck.ok).toBe(true)
    if (!manifestCheck.ok) return

    expect(manifestCheck.value.targets).toEqual(['desktop'])
    expect(manifestCheck.value.entries?.lynx).toBe('main.lynx.bundle')
    expect(manifestCheck.value.services?.[0]?.binding).toBe('host-resolved')
    expect(manifestCheck.value.skills?.[0]?.id).toBe('generic-skill')
    expect(manifestCheck.value.integrity?.algorithm).toBe('sha256')
  })

  it('accepts official applet ids and service bindings', () => {
    const manifestCheck = parseAppletInfo(createNoteManifest(), 'index.applets[0]')
    expect(manifestCheck.ok).toBe(true)
    if (!manifestCheck.ok) return

    expect(manifestCheck.value.id).toBe('peers.note')
    expect(manifestCheck.value.path).toBe('/applets-dist/peers.note')
    expect(manifestCheck.value.services?.[0]).toEqual(expect.objectContaining({
      id: 'note',
      binding: 'station-resolved',
      publicPathPrefix: '/v1',
      stationPathPrefix: '/applets/note/v1',
    }))
  })
})

describe('applet runtime loading', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockAppletCreateSession.mockReset()
    mockAppletInvoke.mockReset()
    mockAppletCreateSession.mockResolvedValue({
      ok: true,
      appletId: 'generic-complex-applet',
      sessionId: 'desktop-session-generic-complex-applet',
    })
    mockAppletInvoke.mockResolvedValue({ ok: true })
    resetManagerState()
  })

  it('refuses to load invalid applet from index', async () => {
    const invalidManifest = createValidManifest('Invalid_ID')
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 1,
        applets: [invalidManifest],
      }),
    })

    const manager = AppletManager.getInstance()
    const applets = await manager.scanApplets()
    expect(applets).toHaveLength(0)

    await expect(manager.loadApplet('Invalid_ID')).rejects.toThrow('is invalid')
  })

  it('refuses applet with invalid load config at runtime validation', async () => {
    const badManifest = {
      ...createValidManifest('bad-load'),
      load: {
        desktop: {
          type: 'iframe',
          entry: 'index.html',
        },
      },
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        version: 1,
        applets: [badManifest],
      }),
    })

    const manager = AppletManager.getInstance()
    const applets = await manager.scanApplets()
    expect(applets).toHaveLength(0)
    await expect(manager.loadApplet('bad-load')).rejects.toThrow('is invalid')
  })

  it('loads a complex external package manifest through the Desktop package reader', async () => {
    const complexManifest = createComplexManifest()
    mockAppletPackage(complexManifest)

    const manager = AppletManager.getInstance()
    const applets = await manager.scanApplets()
    expect(applets).toHaveLength(1)

    const loaded = await manager.loadApplet('generic-complex-applet')
    expect(loaded.path).toBe('/applets-dist/generic-complex-applet')
    expect(loaded.load.desktop?.entry).toBe('main.lynx.bundle')
    expect(loaded.services?.[0]?.allowedPaths).toContain('/api/v1/*')
    expect(manager.getLoadedApplets()).toContain('generic-complex-applet')
    expect(manager.getSessionId('generic-complex-applet')).toBe('desktop-session-generic-complex-applet')
    expect(mockAppletCreateSession).toHaveBeenCalledWith({
      id: 'generic-complex-applet',
      manifest: expect.objectContaining({
        id: 'generic-complex-applet',
        permissions: expect.arrayContaining(['network.request']),
      }),
    })
  })

  it('loads the official Note applet manifest through the Desktop package reader', async () => {
    const noteManifest = createNoteManifest()
    mockAppletPackage(noteManifest)
    mockAppletCreateSession.mockResolvedValueOnce({
      ok: true,
      appletId: 'peers.note',
      sessionId: 'desktop-session-peers-note',
    })

    const manager = AppletManager.getInstance()
    const applets = await manager.scanApplets()
    expect(applets).toHaveLength(1)

    const loaded = await manager.loadApplet('peers.note')
    expect(loaded.path).toBe('/applets-dist/peers.note')
    expect(loaded.load.desktop?.entry).toBe('main.lynx.bundle')
    expect(loaded.services?.[0]?.id).toBe('note')
    expect(loaded.services?.[0]?.stationPathPrefix).toBe('/applets/note/v1')
    expect(manager.getSessionId('peers.note')).toBe('desktop-session-peers-note')
    expect(mockAppletCreateSession).toHaveBeenCalledWith({
      id: 'peers.note',
      manifest: expect.objectContaining({
        id: 'peers.note',
        permissions: expect.arrayContaining(['network.request']),
        services: expect.arrayContaining([
          expect.objectContaining({
            id: 'note',
            binding: 'station-resolved',
          }),
        ]),
      }),
    })
  })

  it('destroys the Gateway session when unloading an active applet', async () => {
    const complexManifest = createComplexManifest()
    mockAppletPackage(complexManifest)

    const manager = AppletManager.getInstance()
    await manager.scanApplets()
    await manager.loadApplet('generic-complex-applet')
    await manager.unloadApplet('generic-complex-applet')

    expect(mockAppletInvoke).toHaveBeenCalledWith({
      id: 'generic-complex-applet',
      sessionId: 'desktop-session-generic-complex-applet',
      capability: 'lifecycle',
      action: 'destroy',
      manifest: expect.objectContaining({
        id: 'generic-complex-applet',
        permissions: expect.arrayContaining(['lifecycle.destroy']),
      }),
    })
    expect(manager.getLoadedApplets()).not.toContain('generic-complex-applet')

    await manager.unloadApplet('generic-complex-applet')
    expect(mockAppletInvoke).toHaveBeenCalledTimes(1)
  })

  it('rejects desktop package files whose sha256 integrity does not match the manifest', async () => {
    const complexManifest = createComplexManifest()
    mockAppletPackage(complexManifest, {
      'main.lynx.bundle': 'tampered bundle',
    })

    const manager = AppletManager.getInstance()
    await manager.scanApplets()

    await expect(manager.loadApplet('generic-complex-applet')).rejects.toThrow('failed integrity validation')
    expect(manager.getLoadedApplets()).not.toContain('generic-complex-applet')
    expect(manager.getDiagnostics().some((diag) => diag.issues.some((issue) => issue.includes('integrity mismatch')))).toBe(true)
  })
})
