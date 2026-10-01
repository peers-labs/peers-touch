import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  AGENT_REPLAY_RETRY_DELAYS_MS,
  AGENT_SSE_IDLE_TIMEOUT_MS,
  agentTurnStreamErrorFromData,
  api,
  classifyAgentTurnTerminalEvent,
  createAgentTurnSourceDelivery,
  normalizeAgentTurnStreamError,
  streamAgentTurn,
  streamAgentTurnReplay,
  toAgentTurnReplayWireInput,
} from './desktop_api'
import { eventBus } from '../kernel/events/bus'
import { EVENT } from '../kernel/events/catalog'
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

describe('agentTurnStreamErrorFromData', () => {
  it('preserves the Station attachment rejection contract', () => {
    const error = agentTurnStreamErrorFromData({
      type: 'error',
      error: 'agent.errors.attachmentRejected',
      error_type: 'CONTEXT_ATTACHMENT_REJECTED',
      locale_key: 'agent.errors.attachmentRejected',
      retryable: false,
      terminal: true,
      details: {
        attachment_id: 'attachment-1',
        reason_code: 'attachment_content_does_not_match_mime',
      },
    })

    expect(error.message).toBe('agent.errors.attachmentRejected')
    expect(error.typedError).toEqual({
      error: 'agent.errors.attachmentRejected',
      error_type: 'CONTEXT_ATTACHMENT_REJECTED',
      locale_key: 'agent.errors.attachmentRejected',
      retryable: false,
      terminal: true,
      details: {
        attachment_id: 'attachment-1',
        reason_code: 'attachment_content_does_not_match_mime',
      },
    })
  })

  it('adds the credential settings recovery without changing the typed payload', () => {
    const error = agentTurnStreamErrorFromData({
      type: 'error',
      error: 'agent.errors.providerCredentialMissing',
      error_type: 'PROVIDER_CREDENTIAL_MISSING',
      locale_key: 'agent.errors.providerCredentialMissing',
      retryable: true,
      terminal: true,
      details: {
        provider_id: 'provider-1',
      },
    })

    expect(error.typedError).toEqual({
      error: 'agent.errors.providerCredentialMissing',
      error_type: 'PROVIDER_CREDENTIAL_MISSING',
      locale_key: 'agent.errors.providerCredentialMissing',
      retryable: true,
      terminal: true,
      details: {
        provider_id: 'provider-1',
      },
    })
    expect(error.providerId).toBe('provider-1')
    expect(error.resolution).toEqual({
      type: 'openProviderSettings',
      providerId: 'provider-1',
      label: 'agent.recovery.configureCredential',
    })
  })

  it('adds the original turn recovery for duplicate admission conflicts', () => {
    const error = agentTurnStreamErrorFromData({
      type: 'error',
      error: 'agent.errors.duplicateConflict',
      error_type: 'ADMISSION_DUPLICATE_CONFLICT',
      locale_key: 'agent.errors.duplicateConflict',
      retryable: false,
      terminal: true,
      details: {
        idempotency_key_hash: 'a'.repeat(64),
        existing_command_id: 'turn-original',
      },
    })

    expect(error.typedError).toEqual({
      error: 'agent.errors.duplicateConflict',
      error_type: 'ADMISSION_DUPLICATE_CONFLICT',
      locale_key: 'agent.errors.duplicateConflict',
      retryable: false,
      terminal: true,
      details: {
        idempotency_key_hash: 'a'.repeat(64),
        existing_command_id: 'turn-original',
      },
    })
    expect(error.resolution).toEqual({
      type: 'openOriginal',
      existingCommandId: 'turn-original',
      label: 'agent.recovery.openOriginal',
    })
  })

  it('does not expose original recovery without an authoritative command id', () => {
    const error = agentTurnStreamErrorFromData({
      type: 'error',
      error: 'agent.errors.duplicateConflict',
      error_type: 'ADMISSION_DUPLICATE_CONFLICT',
      locale_key: 'agent.errors.duplicateConflict',
      retryable: false,
      terminal: true,
      details: {
        idempotency_key_hash: 'a'.repeat(64),
      },
    })

    expect(error.resolution).toBeUndefined()
  })

  it('maps the exact forbidden-actor payload to switch-account recovery', () => {
    const error = agentTurnStreamErrorFromData({
      type: 'error',
      error: 'agent.errors.forbiddenActor',
      error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
      locale_key: 'agent.errors.forbiddenActor',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'conversation',
        resource_id: 'conversation-owned-by-bob',
      },
    })

    expect(error.typedError).toEqual({
      error: 'agent.errors.forbiddenActor',
      error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
      locale_key: 'agent.errors.forbiddenActor',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'conversation',
        resource_id: 'conversation-owned-by-bob',
      },
    })
    expect(error.resolution).toEqual({
      type: 'switchAccount',
      resourceKind: 'conversation',
      resourceId: 'conversation-owned-by-bob',
      label: 'agent.recovery.switchAccount',
    })
  })

  it('normalizes an immediate native forbidden-actor rejection without widening details', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent turn rejected'),
      {
        details: {
          error_code: 'OWNERSHIP_FORBIDDEN_ACTOR',
          locale_key: 'agent.errors.forbiddenActor',
          retryable: 'false',
          terminal: 'true',
          resource_kind: 'conversation',
          resource_id: 'conversation-owned-by-bob',
          body: 'must not enter the typed payload',
        },
      },
    ))

    expect(error.typedError).toEqual({
      error: 'Agent turn rejected',
      error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
      locale_key: 'agent.errors.forbiddenActor',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'conversation',
        resource_id: 'conversation-owned-by-bob',
      },
    })
    expect(error.resolution?.type).toBe('switchAccount')
  })

  it('does not map malformed forbidden-actor details to account recovery', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.forbiddenActor',
      error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
      locale_key: 'agent.errors.forbiddenActor',
      retryable: false,
      terminal: true,
      details: {
        resource_kind: 'conversation',
      },
    })

    expect(error.typedError?.details).toEqual({
      resource_kind: 'conversation',
    })
    expect(error.resolution).toBeUndefined()
  })

  it('maps the exact incompatible-capability contract to model recovery', () => {
    const error = agentTurnStreamErrorFromData({
      type: 'error',
      error: 'agent.errors.incompatibleCapability',
      error_type: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
      locale_key: 'agent.errors.incompatibleCapability',
      retryable: false,
      terminal: true,
      details: {
        capability_id: 'tool:skills_list',
        reason_code: 'runtime_capability_unavailable',
      },
    })

    expect(error.typedError).toEqual({
      error: 'agent.errors.incompatibleCapability',
      error_type: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
      locale_key: 'agent.errors.incompatibleCapability',
      retryable: false,
      terminal: true,
      details: {
        capability_id: 'tool:skills_list',
        reason_code: 'runtime_capability_unavailable',
      },
    })
    expect(error.resolution).toEqual({
      type: 'chooseCompatibleModel',
      capabilityId: 'tool:skills_list',
      reasonCode: 'runtime_capability_unavailable',
      label: 'agent.recovery.chooseCompatibleModel',
    })
  })

  it('requires the exact incompatible-capability booleans and safe details', () => {
    const malformed = agentTurnStreamErrorFromData({
      error: 'agent.errors.incompatibleCapability',
      error_type: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
      locale_key: 'agent.errors.incompatibleCapability',
      retryable: true,
      terminal: true,
      details: {
        capability_id: 'tool:skills_list',
        reason_code: 'runtime_capability_unavailable',
        private_detail: 'must-not-enable-recovery',
      },
    })

    expect(malformed.resolution).toBeUndefined()
  })

  it('normalizes an immediate native incompatible-capability rejection', () => {
    const error = normalizeAgentTurnStreamError(Object.assign(
      new Error('Agent turn rejected'),
      {
        details: {
          error_code: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
          locale_key: 'agent.errors.incompatibleCapability',
          retryable: 'false',
          terminal: 'true',
          capability_id: 'tool:skills_list',
          reason_code: 'runtime_capability_unavailable',
          body: 'must not enter the typed payload',
        },
      },
    ))

    expect(error.typedError).toEqual({
      error: 'Agent turn rejected',
      error_type: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
      locale_key: 'agent.errors.incompatibleCapability',
      retryable: false,
      terminal: true,
      details: {
        capability_id: 'tool:skills_list',
        reason_code: 'runtime_capability_unavailable',
      },
    })
    expect(error.resolution).toEqual({
      type: 'chooseCompatibleModel',
      capabilityId: 'tool:skills_list',
      reasonCode: 'runtime_capability_unavailable',
      label: 'agent.recovery.chooseCompatibleModel',
    })
  })

  it('projects the exact nested lifecycle interruption and Recover resolution', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'station_restart_interrupted',
      terminal_reason: 'station_restart_interrupted',
      outcome_error: {
        error: 'agent.errors.lifecycleInterrupted',
        error_type: 'LIFECYCLE_INTERRUPTED',
        locale_key: 'agent.errors.lifecycleInterrupted',
        retryable: true,
        terminal: true,
        details: {
          turn_id: 'turn-interrupted',
          reason_code: 'station_restart_interrupted',
        },
      },
    })

    expect(error.message).toBe('agent.errors.lifecycleInterrupted')
    expect(error.typedError).toEqual({
      error: 'agent.errors.lifecycleInterrupted',
      error_type: 'LIFECYCLE_INTERRUPTED',
      locale_key: 'agent.errors.lifecycleInterrupted',
      retryable: true,
      terminal: true,
      details: {
        turn_id: 'turn-interrupted',
        reason_code: 'station_restart_interrupted',
      },
    })
    expect(error.resolution).toEqual({
      type: 'recover',
      turnId: 'turn-interrupted',
      reasonCode: 'station_restart_interrupted',
      label: 'agent.recovery.recover',
    })
  })

  it.each([
    ['non-retryable', {
      turn_id: 'turn-interrupted',
      reason_code: 'station_restart_interrupted',
    }, false, true],
    ['non-terminal', {
      turn_id: 'turn-interrupted',
      reason_code: 'station_restart_interrupted',
    }, true, false],
    ['missing turn id', {
      reason_code: 'station_restart_interrupted',
    }, true, true],
    ['unsafe extra detail', {
      turn_id: 'turn-interrupted',
      reason_code: 'station_restart_interrupted',
      internal_error: 'must-not-enable-recovery',
    }, true, true],
    ['unsafe non-string detail', {
      turn_id: 'turn-interrupted',
      reason_code: 'station_restart_interrupted',
      internal_error: { diagnostic: 'must-not-enable-recovery' },
    }, true, true],
  ])('rejects %s lifecycle interruption recovery', (_case, details, retryable, terminal) => {
    const error = agentTurnStreamErrorFromData({
      outcome_error: {
        error: 'agent.errors.lifecycleInterrupted',
        error_type: 'LIFECYCLE_INTERRUPTED',
        locale_key: 'agent.errors.lifecycleInterrupted',
        retryable,
        terminal,
        details,
      },
      resolution: {
        type: 'recover',
        label: 'agent.recovery.recover',
      },
    })

    expect(error.resolution).toBeUndefined()
  })
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

  it('does not revoke the local session for an unrelated unauthorized response', async () => {
    const publish = vi.spyOn(eventBus, 'publish').mockImplementation(() => undefined)
    vi.mocked(invoke).mockResolvedValue({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'invalid federation token audience',
        details: { code: 'federation_token_invalid' },
      },
    })

    await expect(api.health()).rejects.toThrow('invalid federation token audience')
    expect(publish).not.toHaveBeenCalledWith(
      EVENT.AUTH_SESSION_REVOKED,
      expect.anything(),
    )
  })

  it('revokes the local session only for an explicit session_revoked response', async () => {
    const publish = vi.spyOn(eventBus, 'publish').mockImplementation(() => undefined)
    vi.mocked(invoke).mockResolvedValue({
      ok: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'session revoked',
        details: { code: 'session_revoked', reason: 'expired' },
      },
    })

    await expect(api.health()).rejects.toThrow('session revoked')
    expect(publish).toHaveBeenCalledWith(
      EVENT.AUTH_SESSION_REVOKED,
      expect.objectContaining({
        reason: 'expired',
      }),
    )
  })
})

describe('Agent turn stream completion', () => {
  it('does not treat replay catch-up as terminal completion', () => {
    expect(classifyAgentTurnTerminalEvent({ event: 'catchup_done', data: {} })).toBeNull()
    expect(classifyAgentTurnTerminalEvent({ event: 'done', data: {} })).toBe('completed')
    expect(classifyAgentTurnTerminalEvent({ event: 'cancelled', data: {} })).toBe('cancelled')
  })

  it('classifies only a strict nested lifecycle interruption as interrupted', () => {
    const interruption = {
      error: 'agent.errors.lifecycleInterrupted',
      error_type: 'LIFECYCLE_INTERRUPTED',
      locale_key: 'agent.errors.lifecycleInterrupted',
      retryable: true,
      terminal: true,
      details: {
        turn_id: 'turn-interrupted',
        reason_code: 'station_restart_interrupted',
      },
    }

    expect(classifyAgentTurnTerminalEvent({
      event: 'error',
      data: { outcome_error: interruption },
    })).toBe('interrupted')
    expect(classifyAgentTurnTerminalEvent({
      event: 'error',
      data: interruption,
    })).toBe('failed')
    expect(classifyAgentTurnTerminalEvent({
      event: 'error',
      data: {
        outcome_error: {
          ...interruption,
          details: {
            ...interruption.details,
            internal_error: 'must-not-enable-interrupted',
          },
        },
      },
    })).toBe('failed')
    expect(classifyAgentTurnTerminalEvent({
      event: 'error',
      data: {
        error: 'provider failed',
        error_type: 'PROVIDER_FAILURE',
      },
    })).toBe('failed')
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

  it('keeps a Browser lifecycle interruption out of the failed callback', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
    vi.stubGlobal('window', browserWindow)
    ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
      'http://127.0.0.1:3030'
    const rawData = {
      error: 'station_restart_interrupted',
      terminal_reason: 'station_restart_interrupted',
      conversation_id: 'conversation-1',
      turn_id: 'turn-interrupted',
      seq: 9,
      outcome_error: {
        error: 'agent.errors.lifecycleInterrupted',
        error_type: 'LIFECYCLE_INTERRUPTED',
        locale_key: 'agent.errors.lifecycleInterrupted',
        retryable: true,
        terminal: true,
        details: {
          turn_id: 'turn-interrupted',
          reason_code: 'station_restart_interrupted',
        },
      },
    }
    mockFetch.mockResolvedValue(new Response(
      `event: error\ndata: ${JSON.stringify(rawData)}\n\n`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    ))
    const onEvent = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    streamAgentTurn(
      {
        client_idempotency_key: 'request-browser-interrupted',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'resume after restart',
      },
      onEvent,
      onDone,
      onError,
      'ptid:person:owner',
    )

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      event: 'error',
      data: {
        ...rawData,
        streamGeneration: expect.any(Number),
      },
    })
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('settles a Native lifecycle interruption without reporting failure', async () => {
    type NativeStreamEvent = {
      payload: {
        streamId: string
        ptid: string
        event: string
        data: Record<string, unknown>
      }
    }
    let listener: ((event: NativeStreamEvent) => void) | undefined
    let startedStreamId = ''
    const unlisten = vi.fn()
    mockListen.mockImplementation(async (_event, callback) => {
      listener = callback as (event: NativeStreamEvent) => void
      return unlisten
    })
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command !== 'agent_execute_turn_stream') {
        return Promise.reject(new Error(`unexpected command: ${command}`))
      }
      startedStreamId = String(
        (args as { input: { stream_id: string } }).input.stream_id,
      )
      return Promise.resolve({
        ok: true,
        data: {
          command,
          status: JSON.stringify({ stream_id: startedStreamId }),
        },
      })
    })
    const onEvent = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    streamAgentTurn(
      {
        client_idempotency_key: 'request-native-interrupted',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'resume after restart',
      },
      onEvent,
      onDone,
      onError,
      'ptid:person:owner',
    )
    await vi.waitFor(() => {
      expect(listener).toBeTypeOf('function')
      expect(startedStreamId).not.toBe('')
    })

    listener?.({
      payload: {
        streamId: startedStreamId,
        ptid: 'ptid:person:owner',
        event: 'error',
        data: {
          error: 'station_restart_interrupted',
          terminal_reason: 'station_restart_interrupted',
          conversation_id: 'conversation-1',
          turn_id: 'turn-interrupted',
          seq: 9,
          outcome_error: {
            error: 'agent.errors.lifecycleInterrupted',
            error_type: 'LIFECYCLE_INTERRUPTED',
            locale_key: 'agent.errors.lifecycleInterrupted',
            retryable: true,
            terminal: true,
            details: {
              turn_id: 'turn-interrupted',
              reason_code: 'station_restart_interrupted',
            },
          },
        },
      },
    })

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('source-binds a Browser pre-admission error before projection metadata', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
    vi.stubGlobal('window', browserWindow)
    ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
      'http://127.0.0.1:3030'
    const rawData = {
      type: 'error',
      error: 'agent.errors.contextOverflow',
      error_type: 'CONTEXT_OVERFLOW',
      locale_key: 'agent.errors.contextOverflow',
      retryable: false,
      terminal: true,
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      details: {
        limit_tokens: '64',
        actual_tokens: '65',
      },
    }
    mockFetch.mockResolvedValue(new Response(
      `event: error\ndata: ${JSON.stringify(rawData)}\n\n`,
      {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      },
    ))
    const onEvent = vi.fn()
    const onError = vi.fn()

    streamAgentTurn(
      {
        client_idempotency_key: 'request-browser-context-overflow',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'oversized',
      },
      onEvent,
      vi.fn(),
      onError,
      'ptid:person:owner',
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'error',
      data: {
        ...rawData,
        streamGeneration: expect.any(Number),
      },
      sourceDelivery: {
        transport: 'station-sse',
        ptid: 'ptid:person:owner',
        conversationId: 'conversation-1',
        turnId: '',
        sequence: 0,
        rawPayload: {
          eventType: 'error',
          data: rawData,
        },
      },
    }))
  })

  it('source-binds an immediate Browser typed HTTP rejection', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
    vi.stubGlobal('window', browserWindow)
    ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
      'http://127.0.0.1:3030'
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ error: 'agent.errors.forbiddenActor' }),
      {
        status: 403,
        headers: {
          'x-peers-error-code': 'OWNERSHIP_FORBIDDEN_ACTOR',
          'x-peers-error-locale-key': 'agent.errors.forbiddenActor',
          'x-peers-error-retryable': 'false',
          'x-peers-error-terminal': 'true',
          'x-peers-error-details': JSON.stringify({
            resource_kind: 'conversation',
            resource_id: 'conversation-owned-by-bob',
          }),
        },
      },
    ))
    const onEvent = vi.fn()
    const onError = vi.fn()

    streamAgentTurn(
      {
        client_idempotency_key: 'request-browser-forbidden',
        conversation_id: 'conversation-owned-by-bob',
        agent_id: 'agent-1',
        user_input: 'forbidden',
      },
      onEvent,
      vi.fn(),
      onError,
      'ptid:person:alice',
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'error',
      data: expect.objectContaining({
        error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
        locale_key: 'agent.errors.forbiddenActor',
        retryable: false,
        terminal: true,
      }),
    }))
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      typedError: {
        error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
        details: {
          resource_kind: 'conversation',
          resource_id: 'conversation-owned-by-bob',
        },
      },
      resolution: {
        type: 'switchAccount',
      },
    })
  })

  it('preserves incompatible-capability details from an immediate Browser rejection', async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    })
    vi.stubGlobal('window', browserWindow)
    ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
      'http://127.0.0.1:3030'
    mockFetch.mockResolvedValue(new Response(
      JSON.stringify({ error: 'agent.errors.incompatibleCapability' }),
      {
        status: 409,
        headers: {
          'x-peers-error-code': 'RUNTIME_INCOMPATIBLE_CAPABILITY',
          'x-peers-error-locale-key': 'agent.errors.incompatibleCapability',
          'x-peers-error-retryable': 'false',
          'x-peers-error-terminal': 'true',
          'x-peers-error-details': JSON.stringify({
            capability_id: 'tool:skills_list',
            reason_code: 'runtime_capability_unavailable',
          }),
        },
      },
    ))
    const onEvent = vi.fn()
    const onError = vi.fn()

    streamAgentTurn(
      {
        client_idempotency_key: 'request-browser-incompatible-capability',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'inspect this image',
      },
      onEvent,
      vi.fn(),
      onError,
      'ptid:person:alice',
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'error',
      data: expect.objectContaining({
        error_type: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
        locale_key: 'agent.errors.incompatibleCapability',
        retryable: false,
        terminal: true,
        details: {
          capability_id: 'tool:skills_list',
          reason_code: 'runtime_capability_unavailable',
        },
      }),
    }))
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      typedError: {
        error_type: 'RUNTIME_INCOMPATIBLE_CAPABILITY',
        details: {
          capability_id: 'tool:skills_list',
          reason_code: 'runtime_capability_unavailable',
        },
      },
      resolution: {
        type: 'chooseCompatibleModel',
        label: 'agent.recovery.chooseCompatibleModel',
      },
    })
  })

  it('source-binds a native pre-admission error before projection metadata', async () => {
    type NativeTurnEvent = {
      payload: {
        streamId: string
        ptid: string
        event: string
        data: Record<string, unknown>
      }
    }
    let listener: ((event: NativeTurnEvent) => void) | undefined
    let startedStreamId = ''
    const unlisten = vi.fn()
    mockListen.mockImplementation(async (_event, callback) => {
      listener = callback as (event: NativeTurnEvent) => void
      return unlisten
    })
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command !== 'agent_execute_turn_stream') {
        return Promise.reject(new Error(`unexpected command: ${command}`))
      }
      startedStreamId = String(
        (args as { input: { stream_id: string } }).input.stream_id,
      )
      return Promise.resolve({
        ok: true,
        data: {
          command,
          status: JSON.stringify({ stream_id: startedStreamId }),
        },
      })
    })
    const rawData = {
      type: 'error',
      error: 'agent.errors.contextOverflow',
      error_type: 'CONTEXT_OVERFLOW',
      locale_key: 'agent.errors.contextOverflow',
      retryable: false,
      terminal: true,
      conversationId: 'conversation-1',
      agentId: 'agent-1',
      details: {
        limit_tokens: '64',
        actual_tokens: '65',
      },
    }
    const onEvent = vi.fn()
    const onError = vi.fn()

    streamAgentTurn(
      {
        client_idempotency_key: 'request-native-context-overflow',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'oversized',
      },
      onEvent,
      vi.fn(),
      onError,
      'ptid:person:owner',
    )
    await vi.waitFor(() => {
      expect(listener).toBeTypeOf('function')
      expect(startedStreamId).not.toBe('')
    })

    listener?.({
      payload: {
        streamId: startedStreamId,
        ptid: 'ptid:person:owner',
        event: 'error',
        data: rawData,
      },
    })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'error',
      data: {
        ...rawData,
        streamGeneration: expect.any(Number),
      },
      sourceDelivery: {
        transport: 'station-sse',
        ptid: 'ptid:person:owner',
        conversationId: 'conversation-1',
        turnId: '',
        sequence: 0,
        rawPayload: {
          eventType: 'error',
          data: rawData,
        },
      },
    }))
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  it('source-binds an immediate native typed rejection from the start command', async () => {
    mockListen.mockResolvedValue(() => undefined)
    vi.mocked(invoke).mockImplementation((command) => {
      if (command !== 'agent_execute_turn_stream') {
        return Promise.reject(new Error(`unexpected command: ${command}`))
      }
      return Promise.resolve({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'agent.errors.forbiddenActor',
          details: {
            error_code: 'OWNERSHIP_FORBIDDEN_ACTOR',
            locale_key: 'agent.errors.forbiddenActor',
            retryable: 'false',
            terminal: 'true',
            resource_kind: 'conversation',
            resource_id: 'conversation-owned-by-bob',
          },
        },
      })
    })
    const onEvent = vi.fn()
    const onError = vi.fn()

    streamAgentTurn(
      {
        client_idempotency_key: 'request-native-forbidden',
        conversation_id: 'conversation-owned-by-bob',
        agent_id: 'agent-1',
        user_input: 'forbidden',
      },
      onEvent,
      vi.fn(),
      onError,
      'ptid:person:alice',
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'error',
      data: expect.objectContaining({
        error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
        locale_key: 'agent.errors.forbiddenActor',
        retryable: false,
        terminal: true,
        conversationId: 'conversation-owned-by-bob',
        agentId: 'agent-1',
        streamGeneration: expect.any(Number),
      }),
      sourceDelivery: {
        transport: 'station-sse',
        ptid: 'ptid:person:alice',
        conversationId: 'conversation-owned-by-bob',
        turnId: '',
        sequence: 0,
        rawPayload: {
          eventType: 'error',
          data: {
            error: 'agent.errors.forbiddenActor',
            error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
            locale_key: 'agent.errors.forbiddenActor',
            retryable: false,
            terminal: true,
            details: {
              resource_kind: 'conversation',
              resource_id: 'conversation-owned-by-bob',
            },
            conversationId: 'conversation-owned-by-bob',
            agentId: 'agent-1',
          },
        },
      },
    }))
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      typedError: {
        error_type: 'OWNERSHIP_FORBIDDEN_ACTOR',
        details: {
          resource_kind: 'conversation',
          resource_id: 'conversation-owned-by-bob',
        },
      },
      resolution: {
        type: 'switchAccount',
      },
    })
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
    expect(controller.streamId).toMatch(/^agent-turn-/)
    expect(controller.streamId).toBe(startedStreamId)

    controller.abort()
    resolveStart?.()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_cancel_turn_stream', {
        input: { stream_id: startedStreamId },
      })
    })
    expect(invoke).not.toHaveBeenCalledWith('agent_cancel_turn', expect.anything())
  })

  it('keeps native stream abort transport-only after observing the turn', async () => {
    type NativeTurnEvent = {
      payload: {
        streamId: string
        ptid: string
        event: string
        data: Record<string, unknown>
      }
    }
    let listener: ((event: NativeTurnEvent) => void) | undefined
    let startedStreamId = ''
    mockListen.mockImplementation(async (_event, callback) => {
      listener = callback as (event: NativeTurnEvent) => void
      return () => undefined
    })
    vi.mocked(invoke).mockImplementation((command, args) => {
      const streamId = String(
        (args as { input?: { stream_id?: string } })?.input?.stream_id || '',
      )
      if (command === 'agent_execute_turn_stream') startedStreamId = streamId
      if (command === 'agent_execute_turn_stream' || command === 'agent_cancel_turn_stream') {
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
        client_idempotency_key: 'request-native-transport-only',
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
    listener?.({
      payload: {
        streamId: startedStreamId,
        ptid: 'ptid:person:owner',
        event: 'text',
        data: {
          turnId: 'turn-1',
          conversationId: 'conversation-1',
          seq: 1,
          text: 'partial',
        },
      },
    })

    controller.abort()

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_cancel_turn_stream', {
        input: { stream_id: startedStreamId },
      })
    })
    expect(invoke).not.toHaveBeenCalledWith('agent_cancel_turn', expect.anything())
  })

  it('disconnects a native transport without cancelling the durable turn', async () => {
    type NativeTurnEvent = {
      payload: {
        streamId: string
        ptid: string
        event: string
        data: Record<string, unknown>
      }
    }
    let listener: ((event: NativeTurnEvent) => void) | undefined
    let startedStreamId = ''
    mockListen.mockImplementation(async (_event, callback) => {
      listener = callback as (event: NativeTurnEvent) => void
      return () => undefined
    })
    vi.mocked(invoke).mockImplementation((command, args) => {
      const streamId = String((args as { input?: { stream_id?: string } })?.input?.stream_id || '')
      if (command === 'agent_execute_turn_stream') startedStreamId = streamId
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

    const onEvent = vi.fn()
    const onDone = vi.fn()
    const controller = streamAgentTurn(
      {
        client_idempotency_key: 'request-transport-disconnect',
        conversation_id: 'conversation-1',
        agent_id: 'agent-1',
        user_input: 'hello',
      },
      onEvent,
      onDone,
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

    let disconnectSettled = false
    const disconnect = controller.disconnectTransport().then(() => {
      disconnectSettled = true
    })

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('agent_disconnect_turn_stream', {
        input: { stream_id: expect.any(String) },
      })
    })
    listener?.({
      payload: {
        streamId: startedStreamId,
        ptid: 'ptid:person:owner',
        event: 'done',
        data: {
          turnId: 'turn-1',
          conversationId: 'conversation-1',
          seq: 4,
        },
      },
    })
    expect(onDone).not.toHaveBeenCalled()
    expect(disconnectSettled).toBe(false)

    listener?.({
      payload: {
        streamId: startedStreamId,
        ptid: 'ptid:person:owner',
        event: 'connection_lost',
        data: {
          turnId: 'turn-1',
          conversationId: 'conversation-1',
          seq: 3,
          recoveryHandoff: true,
        },
      },
    })
    await disconnect
    expect(disconnectSettled).toBe(true)
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'connection_lost',
    }))
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
    expect(invoke).not.toHaveBeenCalledWith('agent_cancel_turn', expect.anything())
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

  it('retries an untyped Browser HTTP failure instead of projecting a terminal error', async () => {
    vi.useFakeTimers()
    try {
      const browserWindow = Object.assign(new EventTarget(), {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      })
      vi.stubGlobal('window', browserWindow)
      ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
        'http://127.0.0.1:3030'
      mockFetch.mockImplementation(() => Promise.resolve(
        new Response('upstream unavailable', { status: 502 }),
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

      await vi.runAllTimersAsync()
      expect(mockFetch).toHaveBeenCalledTimes(AGENT_REPLAY_RETRY_DELAYS_MS.length + 1)
      expect(onEvent.mock.calls.some(([event]) => event.event === 'error')).toBe(false)
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Agent stream returned HTTP 502' }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails a Browser replay when the Station SSE tail stops producing heartbeats', async () => {
    vi.useFakeTimers()
    try {
      const browserWindow = Object.assign(new EventTarget(), {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
      })
      vi.stubGlobal('window', browserWindow)
      ;(window as typeof window & { __PT_GATEWAY_BASE__?: string }).__PT_GATEWAY_BASE__ =
        'http://127.0.0.1:3030'
      mockFetch.mockImplementation(() => Promise.resolve(new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(
              'event: catchup_done\ndata: {"turnId":"turn-1","conversationId":"conversation-1","seq":4}\n\n',
            ))
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )))
      const onError = vi.fn()

      streamAgentTurnReplay(
        {
          conversation_id: 'conversation-1',
          turn_id: 'turn-1',
          after_seq: 4,
        },
        vi.fn(),
        onError,
        'ptid:person:owner',
      )

      await vi.advanceTimersByTimeAsync(
        AGENT_SSE_IDLE_TIMEOUT_MS * (AGENT_REPLAY_RETRY_DELAYS_MS.length + 1)
        + AGENT_REPLAY_RETRY_DELAYS_MS.reduce((total, delay) => total + delay, 0),
      )
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'agent.error.streamIdleTimeout' }),
      )
      expect(mockFetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
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

  it('selects a retained source attempt only when replay requests it', () => {
    expect(toAgentTurnReplayWireInput({
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      after_seq: 0,
      attempt_id: 'attempt-1',
    })).toEqual({
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
      afterSequence: 0,
      attempt_id: 'attempt-1',
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
        ': gateway-connected\n\n',
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

  it('keeps the native listener through a catch-up terminal until the snapshot', async () => {
    type NativeReplayEvent = {
      payload: {
        streamId: string
        ptid: string
        event: string
        data: Record<string, unknown>
      }
    }
    let listener: ((event: NativeReplayEvent) => void) | undefined
    let startedStreamId = ''
    const unlisten = vi.fn()
    mockListen.mockImplementation(async (_event, callback) => {
      listener = callback as (event: NativeReplayEvent) => void
      return unlisten
    })
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command !== 'agent_replay_turn_stream') {
        return Promise.reject(new Error(`unexpected command: ${command}`))
      }
      startedStreamId = String((args as { input: { stream_id: string } }).input.stream_id)
      return Promise.resolve({
        ok: true,
        data: {
          command,
          status: JSON.stringify({ stream_id: startedStreamId }),
        },
      })
    })
    const onEvent = vi.fn()

    streamAgentTurnReplay(
      {
        conversation_id: 'conversation-1',
        turn_id: 'turn-1',
        after_seq: 4,
      },
      onEvent,
      vi.fn(),
      'ptid:person:owner',
    )
    await vi.waitFor(() => expect(listener).toBeTypeOf('function'))

    listener?.({
      payload: {
        streamId: startedStreamId,
        ptid: 'ptid:person:owner',
        event: 'error',
        data: {
          turnId: 'turn-1',
          conversationId: 'conversation-1',
          seq: 5,
          error: 'station_restart_interrupted',
        },
      },
    })
    expect(unlisten).not.toHaveBeenCalled()

    listener?.({
      payload: {
        streamId: startedStreamId,
        ptid: 'ptid:person:owner',
        event: 'snapshot',
        data: {
          turnId: 'turn-1',
          conversationId: 'conversation-1',
          seq: 5,
          status: 'interrupted',
        },
      },
    })

    expect(onEvent.mock.calls.map(([event]) => event.event)).toEqual([
      'error',
      'snapshot',
    ])
    expect(unlisten).toHaveBeenCalledOnce()
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

  it('submits delete-for-me as the canonical actor-scoped hide interaction', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command_id: 'command-hide-1',
        state: 'pending',
      },
    })

    await api.messagingMetadataInteraction(
      'conversation-1',
      'message-1',
      'hideForActor',
    )

    expect(invoke).toHaveBeenCalledWith(
      'messaging_submit_metadata_interaction',
      {
        input: {
          conversation_id: 'conversation-1',
          message_id: 'message-1',
          kind: 'hideForActor',
          reaction: '',
          remove: false,
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

describe('api.resetAgentConversationRuntime', () => {
  it('sends a confirmed, version-fenced, idempotent reset command', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ok: true,
      data: {
        command: 'agent_conversation_runtime_reset',
        status: JSON.stringify({
          conversation: {
            conversation_id: 'conversation-1',
            version: 8,
          },
          closed_external_session_epoch: 1,
          replayed: false,
        }),
      },
    })

    const result = await api.resetAgentConversationRuntime({
      conversation_id: 'conversation-1',
      expected_conversation_version: 7,
      client_idempotency_key: 'external-runtime-reset:conversation-1:7',
      destructive_confirmed: true,
    })

    expect(result.closed_external_session_epoch).toBe(1)
    expect(result.conversation.version).toBe(8)
    expect(invoke).toHaveBeenCalledWith('agent_conversation_runtime_reset', {
      input: {
        conversation_id: 'conversation-1',
        expected_conversation_version: 7,
        client_idempotency_key: 'external-runtime-reset:conversation-1:7',
        destructive_confirmed: true,
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
