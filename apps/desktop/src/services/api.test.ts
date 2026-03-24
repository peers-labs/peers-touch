import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { api } from './desktop_api'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

beforeEach(() => {
  mockFetch.mockReset()
  vi.mocked(invoke).mockReset()
})

describe('api.health', () => {
  it('returns status on success', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'system_health',
        status: JSON.stringify({ status: 'ok' }),
      },
    })
    const result = await api.health()
    expect(result).toEqual({ status: 'ok' })
    expect(invoke).toHaveBeenCalledWith('system_health', undefined)
  })

  it('throws on HTTP error', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('db down'))
    await expect(api.health()).rejects.toThrow('db down')
  })
})

describe('api.listSessions', () => {
  it('returns sessions array', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'chat_list_conversations',
        status: JSON.stringify({
          conversations: [{ id: 'chat:main' }],
        }),
      },
    })
    const sessions = await api.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].key).toBe('chat:main')
  })
})

describe('api.getPreferences', () => {
  it('returns preferences', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'preferences_get',
        status: JSON.stringify({ pinned_applets: ['web-search'], wide_screen: true }),
      },
    })
    const prefs = await api.getPreferences()
    expect(prefs.pinned_applets).toEqual(['web-search'])
    expect(prefs.wide_screen).toBe(true)
  })
})

describe('api.setPreferences', () => {
  it('sends PUT with body', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'preferences_set',
        status: JSON.stringify({ ok: true }),
      },
    })
    await api.setPreferences({ wide_screen: true })
    expect(invoke).toHaveBeenCalledWith('preferences_set', {
      input: { prefs: { wide_screen: true } },
    })
  })
})

describe('api.listApplets', () => {
  it('returns applets array', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'applets_list',
        status: JSON.stringify({
          applets: [
            { manifest: { id: 'web-search', name: 'Web Search' }, status: 'active' },
          ],
        }),
      },
    })
    const applets = await api.listApplets()
    expect(applets).toHaveLength(1)
    expect(applets[0].manifest.id).toBe('web-search')
  })
})

describe('api.appletAction', () => {
  it('sends POST with params', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'applets_action',
        status: JSON.stringify({ sites: [] }),
      },
    })
    await api.appletAction('web-search', 'list-sites', { query: 'test' })
    expect(invoke).toHaveBeenCalledWith('applets_action', {
      input: { id: 'web-search', action: 'list-sites', params: { query: 'test' } },
    })
  })

  it('sends POST without body when no params', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'applets_action',
        status: JSON.stringify({ result: 'ok' }),
      },
    })
    await api.appletAction('web-search', 'list-sites')
    expect(invoke).toHaveBeenCalledWith('applets_action', {
      input: { id: 'web-search', action: 'list-sites', params: undefined },
    })
  })
})

describe('api.listSkills', () => {
  it('returns skills and builtin', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'skills_list',
        status: JSON.stringify({
          skills: [],
          builtin: [{ identifier: 'go-testing', name: 'Go Testing' }],
        }),
      },
    })
    const result = await api.listSkills()
    expect(result.builtin).toHaveLength(1)
  })

  it('passes source query param', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'skills_list',
        status: JSON.stringify({ skills: [], builtin: [] }),
      },
    })
    await api.listSkills('user')
    expect(invoke).toHaveBeenCalledWith('skills_list', {
      input: { source: 'user' },
    })
  })
})

describe('api.deleteSession', () => {
  it('sends delete session request', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'chat_delete_conversation',
        status: JSON.stringify({ ok: true }),
      },
    })
    await api.deleteSession('chat:main')
    expect(invoke).toHaveBeenCalledWith('chat_delete_conversation', {
      input: { conversation_id: 'chat:main' },
    })
  })
})

describe('api.updateProvider', () => {
  it('sends provider update request', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'provider_update',
        status: JSON.stringify({ provider: { id: 'openai' } }),
      },
    })
    await api.updateProvider('openai', { api_key: 'sk-test', base_url: '', enabled: true })
    expect(invoke).toHaveBeenCalledWith('provider_update', {
      input: {
          id: 'openai',
          enabled: true,
          key_vaults: '{"api_key":"sk-test"}',
          config_json: '{"base_url":""}',
      },
    })
  })
})

describe('error handling', () => {
  it('falls back to statusText when JSON parse fails', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Service Unavailable'))
    await expect(api.health()).rejects.toThrow('Service Unavailable')
  })
})
