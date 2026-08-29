import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { create, toBinary } from '@bufbuild/protobuf'
import {
  AGENT_REPLAY_RETRY_DELAYS_MS,
  api,
  classifyAgentTurnTerminalEvent,
  createAgentTurnSourceDelivery,
  streamAgentTurn,
  streamAgentTurnReplay,
  toAgentTurnReplayWireInput,
} from './desktop_api'
import {
  DissolveGroupResponseSchema,
  TransferGroupOwnershipResponseSchema,
  UpdateMyNicknameResponseSchema,
} from '../gen/proto/domain/chat/group_chat_pb'

const mockFetch = vi.fn()
const { mockListen } = vi.hoisted(() => ({ mockListen: vi.fn() }))
const hadWindow = typeof window !== 'undefined'
vi.stubGlobal('fetch', mockFetch)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: mockListen,
}))

beforeEach(() => {
  mockFetch.mockReset()
  mockListen.mockReset()
  vi.mocked(invoke).mockReset()
  if (typeof window !== 'undefined') {
    delete (window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__
  }
})

afterEach(() => {
  if (!hadWindow && typeof window !== 'undefined') {
    delete (globalThis as unknown as { window?: Window }).window
  }
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

describe('Agent turn stream completion', () => {
  it('does not treat replay catch-up as terminal completion', () => {
    expect(classifyAgentTurnTerminalEvent({ event: 'catchup_done', data: {} })).toBeNull()
    expect(classifyAgentTurnTerminalEvent({ event: 'done', data: {} })).toBe('completed')
    expect(classifyAgentTurnTerminalEvent({ event: 'cancelled', data: {} })).toBe('cancelled')
  })

  it('uses replay snapshot status as the terminal authority', () => {
    expect(classifyAgentTurnTerminalEvent({
      event: 'snapshot',
      data: { status: 'running' },
    })).toBeNull()
    expect(classifyAgentTurnTerminalEvent({
      event: 'snapshot',
      data: { status: 'completed' },
    })).toBe('completed')
    expect(classifyAgentTurnTerminalEvent({
      event: 'snapshot',
      data: { status: 'failed', terminal_reason: 'provider_failed' },
    })).toBe('failed')
    expect(classifyAgentTurnTerminalEvent({
      event: 'snapshot',
      data: { status: 'interrupted', terminal_reason: 'station_restart' },
    })).toBe('interrupted')
  })

  it('preserves the Station replay payload before projection aliases are added', () => {
    const rawData = {
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      seq: 7,
      text: 'source text',
    }

    const source = createAgentTurnSourceDelivery(
      'text',
      rawData,
      'ptid:person:owner',
      'fallback-conversation',
      'fallback-turn',
    )

    expect(source).toEqual({
      transport: 'station-sse',
      ptid: 'ptid:person:owner',
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      sequence: 7,
      rawPayload: {
        eventType: 'text',
        data: rawData,
      },
    })
    expect(source.rawPayload.data).not.toHaveProperty('content')
    expect(source.rawPayload.data).not.toHaveProperty('streamGeneration')
  })

  it('does not synthesize source identity from caller fallbacks', () => {
    const source = createAgentTurnSourceDelivery(
      'text',
      { seq: 7, text: 'source text' },
      'ptid:person:owner',
      'fallback-conversation',
      'fallback-turn',
    )

    expect(source.conversationId).toBe('')
    expect(source.turnId).toBe('')
  })

  it('cancels a native transport aborted while its start command is pending', async () => {
    let resolveStart: (() => void) | undefined
    let startedStreamId = ''
    mockListen.mockResolvedValue(() => undefined)
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === 'agent_execute_turn_stream') {
        startedStreamId = String((args as { input: { stream_id: string } }).input.stream_id)
        return new Promise((resolve) => {
          resolveStart = () => resolve({
            ok: true,
            data: {
              command,
              status: JSON.stringify({ stream_id: startedStreamId }),
            },
          })
        })
      }
      if (command === 'agent_cancel_turn_stream') {
        return Promise.resolve({
          ok: true,
          data: {
            command,
            status: JSON.stringify({ stream_id: startedStreamId }),
          },
        })
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const controller = streamAgentTurn(
      {
        client_idempotency_key: 'request-1',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'hello',
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      'ptid:person:owner',
    )
    await vi.waitFor(() => expect(startedStreamId).not.toBe(''))

    controller.abort()
    resolveStart?.()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_cancel_turn_stream', {
        input: { stream_id: startedStreamId },
      })
    })
  })

  it('disconnects a native transport without cancelling the durable turn', async () => {
    mockListen.mockResolvedValue(() => undefined)
    vi.mocked(invoke).mockImplementation((command, args) => {
      const streamId = String((args as { input?: { stream_id?: string } })?.input?.stream_id || '')
      if (command === 'agent_execute_turn_stream' || command === 'agent_disconnect_turn_stream') {
        return Promise.resolve({
          ok: true,
          data: {
            command,
            status: JSON.stringify({ stream_id: streamId }),
          },
        })
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const controller = streamAgentTurn(
      {
        client_idempotency_key: 'request-transport-disconnect',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'hello',
      },
      vi.fn(),
      vi.fn(),
      vi.fn(),
      'ptid:person:owner',
    )
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_execute_turn_stream', {
        input: expect.objectContaining({
          stream_id: expect.any(String),
        }),
      })
    })

    controller.disconnectTransport()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_disconnect_turn_stream', {
        input: { stream_id: expect.any(String) },
      })
    })
    expect(invoke).not.toHaveBeenCalledWith('agent_cancel_turn', expect.anything())
    expect(invoke).not.toHaveBeenCalledWith('agent_cancel_turn_stream', expect.anything())
  })

  it('hands a disconnected Browser stream to the recovery runtime without cancelling the turn', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
    vi.stubGlobal('window', browserWindow)
    ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
      'http://127.0.0.1:3030'
    let requestCount = 0
    mockFetch.mockImplementation((_url, init) => {
      requestCount += 1
      if (requestCount > 1) {
        return Promise.reject(new Error('Station unavailable'))
      }
      const signal = (init as RequestInit).signal
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(
            'event: text\ndata: {"turnId":"turn-1","conversationId":"conversation-1","seq":1,"text":"partial"}\n\n',
          ))
          signal?.addEventListener('abort', () => {
            streamController.error(new DOMException('transport disconnected', 'AbortError'))
          }, { once: true })
        },
      })
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { 'x-agent-turn-id': 'turn-1' },
      }))
    })
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'agent_cancel_turn',
        status: JSON.stringify({ turn_id: 'turn-1', status: 'cancelled' }),
      },
    })
    const onEvent = vi.fn()
    const onError = vi.fn()
    const controller = streamAgentTurn(
      {
        client_idempotency_key: 'request-browser-disconnect',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'hello',
      },
      onEvent,
      vi.fn(),
      onError,
      'ptid:person:owner',
    )
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(onEvent.mock.calls.length + onError.mock.calls.length).toBeGreaterThan(0)
    })
    expect(onError).not.toHaveBeenCalled()
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'text' }))

    controller.disconnectTransport()

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
        event: 'connection_lost',
        data: expect.objectContaining({
          reason: 'transport_disconnect_requested',
          recoveryHandoff: true,
        }),
      }))
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalledWith('agent_cancel_turn', expect.anything())
    controller.abort()
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_cancel_turn', {
        input: { turn_id: 'turn-1' },
      })
    })
  })

  it('stops forwarding buffered Browser frames after transport disconnect', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
    vi.stubGlobal('window', browserWindow)
    ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
      'http://127.0.0.1:3030'
    let requestCount = 0
    mockFetch.mockImplementation(() => {
      requestCount += 1
      const body = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(
            'event: text\ndata: {"turnId":"turn-1","conversationId":"conversation-1","seq":1,"text":"first"}\n\n'
            + 'event: text\ndata: {"turnId":"turn-1","conversationId":"conversation-1","seq":2,"text":"buffered"}\n\n',
          ))
        },
      })
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { 'x-agent-turn-id': 'turn-1' },
      }))
    })
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'agent_cancel_turn',
        status: JSON.stringify({ turn_id: 'turn-1', status: 'cancelled' }),
      },
    })
    const events: Array<{ event: string; data: Record<string, unknown> }> = []
    let controller!: ReturnType<typeof streamAgentTurn>
    controller = streamAgentTurn(
      {
        client_idempotency_key: 'request-browser-buffer-boundary',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'hello',
      },
      (event) => {
        events.push(event)
        if (event.event === 'text' && event.data.seq === 1) {
          controller.disconnectTransport()
        }
      },
      vi.fn(),
      vi.fn(),
      'ptid:person:owner',
    )

    await vi.waitFor(() => {
      expect(events.some((event) => event.event === 'connection_lost')).toBe(true)
    })
    expect(
      events
        .filter((event) => event.event === 'text')
        .map((event) => event.data.seq),
    ).toEqual([1])
    expect(events).toContainEqual(expect.objectContaining({
      event: 'connection_lost',
      data: expect.objectContaining({
        seq: 1,
        recoveryHandoff: true,
      }),
    }))
    expect(requestCount).toBe(1)
    controller.abort()
  })
})

describe('api.startAgentTurnReplayStream', () => {
  it('keeps the Browser replay retry schedule aligned with the native transport', () => {
    expect(AGENT_REPLAY_RETRY_DELAYS_MS).toEqual([500, 1_000, 2_000, 4_000, 8_000])
    expect(AGENT_REPLAY_RETRY_DELAYS_MS.length + 1).toBe(6)
  })

  it('serializes the replay cursor with the canonical protojson field name', () => {
    expect(toAgentTurnReplayWireInput({
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      after_seq: 4,
    })).toEqual({
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      afterSequence: 4,
    })
  })

  it('reads the authoritative snapshot after a catch-up terminal event', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
    vi.stubGlobal('window', browserWindow)
    ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
      'http://127.0.0.1:3030'
    const terminalData = {
      turnId: 'turn-1',
      conversationId: 'conversation-1',
      seq: 5,
      error: 'station_restart_interrupted',
    }
    mockFetch.mockResolvedValue(new Response(
      [
        `event: error\ndata: ${JSON.stringify(terminalData)}\n\n`,
        `event: snapshot\ndata: ${JSON.stringify({
          ...terminalData,
          status: 'interrupted',
        })}\n\n`,
      ].join(''),
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    ))
    const onEvent = vi.fn()
    const onError = vi.fn()

    streamAgentTurnReplay(
      {
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        after_seq: 4,
      },
      onEvent,
      onError,
      'ptid:person:owner',
    )

    await vi.waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
        event: 'snapshot',
        data: expect.objectContaining({ status: 'interrupted' }),
      }))
    })
    expect(onEvent.mock.calls.map(([event]) => event.event)).toEqual([
      'reconnecting',
      'replaying',
      'error',
      'reconciling',
      'connected',
      'snapshot',
    ])
    expect(onError).not.toHaveBeenCalled()
  })

  it('starts replay-then-tail without buffering the live response', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'agent_replay_turn_stream',
        status: JSON.stringify({
          stream_id: 'replay-stream-1',
        }),
      },
    })

    const replay = await api.startAgentTurnReplayStream({
      stream_id: 'replay-stream-1',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      after_seq: 4,
    })

    expect(replay.stream_id).toBe('replay-stream-1')
    expect(invoke).toHaveBeenCalledWith('agent_replay_turn_stream', {
      input: {
        stream_id: 'replay-stream-1',
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        after_seq: 4,
      },
    })
  })

  it('cancels a native replay that was aborted while its start command was pending', async () => {
    let resolveStart: (() => void) | undefined
    let startedStreamId = ''
    mockListen.mockResolvedValue(() => undefined)
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === 'agent_replay_turn_stream') {
        startedStreamId = String((args as { input: { stream_id: string } }).input.stream_id)
        return new Promise((resolve) => {
          resolveStart = () => resolve({
            ok: true,
            data: {
              command,
              status: JSON.stringify({ stream_id: startedStreamId }),
            },
          })
        })
      }
      if (command === 'agent_cancel_turn_replay_stream') {
        return Promise.resolve({
          ok: true,
          data: {
            command,
            status: JSON.stringify({ stream_id: startedStreamId }),
          },
        })
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const controller = streamAgentTurnReplay(
      {
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        after_seq: 4,
      },
      vi.fn(),
      vi.fn(),
      'ptid:person:owner',
    )
    await vi.waitFor(() => expect(startedStreamId).not.toBe(''))

    controller.abort()
    resolveStart?.()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_cancel_turn_replay_stream', {
        input: { stream_id: startedStreamId },
      })
    })
  })
})

describe('api.listAgentConversations', () => {
  it('returns Station conversation projections', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'agent_conversation_list',
        status: JSON.stringify({
          ok: true,
          conversations: [{ conversation_id: 'conversation-1' }],
          total: 1,
        }),
      },
    })
    const conversations = await api.listAgentConversations('agent-1')
    expect(conversations).toHaveLength(1)
    expect(conversations[0].conversation_id).toBe('conversation-1')
    expect(invoke).toHaveBeenCalledWith('agent_conversation_list', {
      input: {
        agent_id: 'agent-1',
        status: undefined,
        page: undefined,
        page_size: undefined,
      },
    })
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

describe('api group admin bridge', () => {
  it('transfers group ownership through the typed Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: Array.from(toBinary(
        TransferGroupOwnershipResponseSchema,
        create(TransferGroupOwnershipResponseSchema),
      )),
    })

    await api.groupChatTransferOwnership('group-1', 'did:peer:next-owner')

    expect(invoke).toHaveBeenCalledWith('group_chat_transfer_ownership', {
      input: {
        group_ulid: 'group-1',
        next_owner_did: 'did:peer:next-owner',
      },
    })
  })

  it('dissolves a group through the typed Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: Array.from(toBinary(
        DissolveGroupResponseSchema,
        create(DissolveGroupResponseSchema, { success: true }),
      )),
    })

    await api.groupChatDissolveGroup('group-1')

    expect(invoke).toHaveBeenCalledWith('group_chat_dissolve_group', {
      input: {
        group_ulid: 'group-1',
      },
    })
  })

  it('updates my group nickname through the typed Tauri command', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: Array.from(toBinary(
        UpdateMyNicknameResponseSchema,
        create(UpdateMyNicknameResponseSchema),
      )),
    })

    await api.groupChatUpdateNickname('group-1', 'Desk Owner')

    expect(invoke).toHaveBeenCalledWith('group_chat_update_nickname', {
      input: {
        group_ulid: 'group-1',
        nickname: 'Desk Owner',
      },
    })
  })
})

describe('api messaging interaction bridge', () => {
  it('returns direct command data for an encrypted edit', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command_id: 'command-edit-1',
        state: 'pending',
      },
    })

    const result = await api.messagingEditMessage(
      'conversation-1',
      'message-1',
      'edited text',
    )

    expect(result).toEqual({
      command_id: 'command-edit-1',
      state: 'pending',
    })
    expect(invoke).toHaveBeenCalledWith('messaging_submit_edit', {
      input: {
        conversation_id: 'conversation-1',
        message_id: 'message-1',
        plaintext: 'edited text',
      },
    })
  })

  it('returns direct command data for metadata interactions', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command_id: 'command-reaction-1',
        state: 'pending',
      },
    })

    const result = await api.messagingMetadataInteraction(
      'conversation-1',
      'message-1',
      'reaction',
      { reaction: 'ok', remove: true },
    )

    expect(result.command_id).toBe('command-reaction-1')
    expect(invoke).toHaveBeenCalledWith(
      'messaging_submit_metadata_interaction',
      {
        input: {
          conversation_id: 'conversation-1',
          message_id: 'message-1',
          kind: 'reaction',
          reaction: 'ok',
          remove: true,
        },
      },
    )
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

describe('api.archiveAgentConversation', () => {
  it('sends a version-fenced Station archive command', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'agent_conversation_archive',
        status: JSON.stringify({ ok: true }),
      },
    })
    await api.archiveAgentConversation('conversation-1', 7, true)
    expect(invoke).toHaveBeenCalledWith('agent_conversation_archive', {
      input: {
        conversation_id: 'conversation-1',
        expected_version: 7,
        permanent: true,
      },
    })
  })
})

describe('api.updateProvider', () => {
  it('sends provider update request', async () => {
    const credential = ['test', 'credential'].join('-')
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'provider_update',
        status: JSON.stringify({ provider: { id: 'openai' } }),
      },
    })
    await api.updateProvider('openai', { api_key: credential, base_url: '', enabled: true })
    expect(invoke).toHaveBeenCalledWith('provider_update', {
      input: {
          id: 'openai',
          enabled: true,
          key_vaults: JSON.stringify({ api_key: credential }),
          config_json: '{"base_url":""}',
          version: 0,
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
