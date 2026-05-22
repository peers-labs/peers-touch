import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppletManager from './AppletManager'
import { parseAppletIndex, parseAppletInfo } from './schema'
import { APPLET_BRIDGE_PROTOCOL } from './types'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function createValidManifest(id = 'web-search') {
  return {
    id,
    name: 'Web Search',
    version: '1.0.0',
    description: 'Search the web',
    author: 'Peers Touch',
    icon: 'https://example.com/icon.png',
    permissions: ['network'],
    targetPlatforms: ['desktop'],
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
      version: 'invalid' as any,
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
})
