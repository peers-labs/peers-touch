import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from './api'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockOk(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  })
}

function mockError(status: number, body: { error: string }) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
  })
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('api.health', () => {
  it('returns status on success', async () => {
    mockOk({ status: 'ok' })
    const result = await api.health()
    expect(result).toEqual({ status: 'ok' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/health'),
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' } })
    )
  })

  it('throws on HTTP error', async () => {
    mockError(500, { error: 'db down' })
    await expect(api.health()).rejects.toThrow('db down')
  })
})

describe('api.listSessions', () => {
  it('returns sessions array', async () => {
    mockOk({ sessions: [{ id: '1', key: 'chat:main' }] })
    const sessions = await api.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].key).toBe('chat:main')
  })
})

describe('api.getPreferences', () => {
  it('returns preferences', async () => {
    mockOk({ pinned_applets: ['web-search'], wide_screen: true })
    const prefs = await api.getPreferences()
    expect(prefs.pinned_applets).toEqual(['web-search'])
    expect(prefs.wide_screen).toBe(true)
  })
})

describe('api.setPreferences', () => {
  it('sends PUT with body', async () => {
    mockOk({ ok: true })
    await api.setPreferences({ wide_screen: true })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/preferences'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ wide_screen: true }),
      })
    )
  })
})

describe('api.listApplets', () => {
  it('returns applets array', async () => {
    mockOk({
      applets: [
        { manifest: { id: 'web-search', name: 'Web Search' }, status: 'active' },
      ],
    })
    const applets = await api.listApplets()
    expect(applets).toHaveLength(1)
    expect(applets[0].manifest.id).toBe('web-search')
  })
})

describe('api.appletAction', () => {
  it('sends POST with params', async () => {
    mockOk({ sites: [] })
    await api.appletAction('web-search', 'list-sites', { query: 'test' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/applets/web-search/action/list-sites'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'test' }),
      })
    )
  })

  it('sends POST without body when no params', async () => {
    mockOk({ result: 'ok' })
    await api.appletAction('web-search', 'list-sites')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/applets/web-search/action/list-sites'),
      expect.objectContaining({
        method: 'POST',
        body: undefined,
      })
    )
  })
})

describe('api.listSkills', () => {
  it('returns skills and builtin', async () => {
    mockOk({ skills: [], builtin: [{ identifier: 'go-testing', name: 'Go Testing' }] })
    const result = await api.listSkills()
    expect(result.builtin).toHaveLength(1)
  })

  it('passes source query param', async () => {
    mockOk({ skills: [], builtin: [] })
    await api.listSkills('user')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/skills?source=user'),
      expect.anything()
    )
  })
})

describe('api.deleteSession', () => {
  it('sends DELETE request', async () => {
    mockOk(undefined)
    await api.deleteSession('chat:main')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/sessions/chat:main'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})

describe('api.updateProvider', () => {
  it('sends PUT with provider data', async () => {
    mockOk({ ok: true })
    await api.updateProvider('openai', { api_key: 'sk-test', base_url: '', enabled: true })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/providers/openai'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ api_key: 'sk-test', base_url: '', enabled: true }),
      })
    )
  })
})

describe('error handling', () => {
  it('falls back to statusText when JSON parse fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.reject(new Error('not json')),
    })
    await expect(api.health()).rejects.toThrow('Service Unavailable')
  })
})
