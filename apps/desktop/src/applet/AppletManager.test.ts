import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppletManager from './AppletManager'
import { parseAppletIndexV2, parseAppletInfoV2 } from './schema'
import { APPLET_BRIDGE_PROTOCOL_V2, APPLET_MANIFEST_VERSION_V2 } from './types'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createValidManifest(id = 'web-search') {
  return {
    manifestVersion: APPLET_MANIFEST_VERSION_V2,
    id,
    name: 'Web Search',
    version: '1.0.0',
    description: 'Search the web',
    author: 'Peers Touch',
    icon: 'https://example.com/icon.png',
    permissions: ['network'],
    load: {
      type: 'lynx' as const,
      entry: 'https://example.com/index.html',
    },
    bridge: {
      version: APPLET_MANIFEST_VERSION_V2,
      protocol: APPLET_BRIDGE_PROTOCOL_V2,
    },
  }
}

function resetManagerState() {
  const manager = AppletManager.getInstance() as any
  manager.applets.clear()
  manager.appletInstances.clear()
  manager.rejectedDiagnostics.clear()
  manager.indexDiagnostics = []
}

describe('applet schema validation', () => {
  it('validates manifest and index payload', () => {
    const manifest = createValidManifest()
    const manifestCheck = parseAppletInfoV2(manifest, 'index.applets[0]')
    expect(manifestCheck.ok).toBe(true)
    if (!manifestCheck.ok) return
    expect(manifestCheck.value.id).toBe('web-search')
    expect(manifestCheck.value.main).toBe(manifest.load.entry)

    const indexCheck = parseAppletIndexV2({
      indexVersion: 2,
      applets: [manifest],
    })
    expect(indexCheck.ok).toBe(true)
  })

  it('rejects invalid manifest/index payload', () => {
    const invalidManifest = createValidManifest('Bad_ID')
    const manifestCheck = parseAppletInfoV2(invalidManifest, 'index.applets[0]')
    expect(manifestCheck.ok).toBe(false)

    const indexCheck = parseAppletIndexV2({
      indexVersion: 1,
      applets: [],
    })
    expect(indexCheck.ok).toBe(false)
  })

  it('rejects iframe load type to enforce no-iframe runtime', () => {
    const iframeManifest = {
      ...createValidManifest('legacy-iframe'),
      load: {
        type: 'iframe',
        entry: 'https://example.com/index.html',
      },
    }
    const manifestCheck = parseAppletInfoV2(iframeManifest, 'index.applets[0]')
    expect(manifestCheck.ok).toBe(false)
    if (manifestCheck.ok) return
    expect(manifestCheck.issues.some((issue) => issue.includes('不支持 iframe'))).toBe(true)
  })
})

describe('applet runtime loading', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    resetManagerState()
  })

  it('refuses to load invalid applet from index', async () => {
    const invalidManifest = createValidManifest('Invalid_ID')
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        indexVersion: 2,
        applets: [invalidManifest],
      }),
    })

    const manager = AppletManager.getInstance()
    const applets = await manager.scanApplets()
    expect(applets).toHaveLength(0)

    await expect(manager.loadApplet('Invalid_ID')).rejects.toThrow('is invalid')
  })

  it('refuses iframe applet at runtime validation step', async () => {
    const iframeManifest = {
      ...createValidManifest('legacy-iframe'),
      load: {
        type: 'iframe',
        entry: 'https://example.com/index.html',
      },
    }
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        indexVersion: 2,
        applets: [iframeManifest],
      }),
    })

    const manager = AppletManager.getInstance()
    const applets = await manager.scanApplets()
    expect(applets).toHaveLength(0)
    await expect(manager.loadApplet('legacy-iframe')).rejects.toThrow('is invalid')
  })

  it('loads valid applet successfully', async () => {
    const manifest = createValidManifest('remote-cli')
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        indexVersion: 2,
        applets: [manifest],
      }),
    })

    const manager = AppletManager.getInstance()
    const applets = await manager.scanApplets()
    expect(applets).toHaveLength(1)

    const loaded = await manager.loadApplet('remote-cli')
    expect(loaded.id).toBe('remote-cli')
    expect(manager.getLoadedApplets()).toContain('remote-cli')
  })
})
