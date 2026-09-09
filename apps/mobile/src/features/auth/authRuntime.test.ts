// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyAuthRuntimeProjection,
  authRuntimeTestContract,
  readActiveAuthSession,
} from '../../runtimes/authRuntime';
import { useAuthStore } from './authStore';

describe('station-scoped authRuntime public projection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears an invalid persisted session and retries once without it', async () => {
    const decision = {
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'fresh-attempt',
      gates: [],
    };
    const startAttempt = vi.fn()
      .mockRejectedValueOnce(new Error('access session invalid: session not found'))
      .mockResolvedValueOnce(decision);
    const clearSession = vi.fn().mockResolvedValue(undefined);

    await expect(
      authRuntimeTestContract.startAccessAttemptWithInvalidSessionRecovery(
        'stale-session',
        startAttempt,
        clearSession,
      ),
    ).resolves.toBe(decision);

    expect(clearSession).toHaveBeenCalledOnce();
    expect(startAttempt).toHaveBeenNthCalledWith(1, 'stale-session');
    expect(startAttempt).toHaveBeenNthCalledWith(2);
  });

  it('does not retry a non-session access failure', async () => {
    const startAttempt = vi.fn().mockRejectedValue(
      new Error('station network unavailable'),
    );
    const clearSession = vi.fn().mockResolvedValue(undefined);

    await expect(
      authRuntimeTestContract.startAccessAttemptWithInvalidSessionRecovery(
        'persisted-session',
        startAttempt,
        clearSession,
      ),
    ).rejects.toThrow('station network unavailable');

    expect(clearSession).not.toHaveBeenCalled();
    expect(startAttempt).toHaveBeenCalledOnce();
  });

  it('reports bounded remote session revocation without leaking credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const session = {
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example/',
      sessionId: 'session-1',
      accessToken: 'test-token',
      actorRef: { ptid: 'ptid:alice' },
      authenticatedAt: 1,
    };

    await expect(
      authRuntimeTestContract.revokeStationSession(session),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://station.example/actor/logout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ session_id: 'session-1' }),
      }),
    );
  });

  it('keeps local logout possible when remote revocation is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    await expect(authRuntimeTestContract.revokeStationSession({
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example',
      sessionId: 'session-1',
      accessToken: 'test-token',
      actorRef: { ptid: 'ptid:alice' },
      authenticatedAt: 1,
    })).resolves.toBe(false);
  });

  it('preserves the Rust-owned snake_case lifecycle phases', () => {
    const snapshot = authRuntimeTestContract.snapshotFromProjection({
      phase: 'awaiting_provider',
      stationPeerId: '12D3KooWStation',
      provider: 'github',
      accessAttemptId: 'access-attempt',
      gateId: 'auth.login',
      expiresAtUnixMs: 42,
    });

    expect(snapshot).toMatchObject({
      phase: 'awaiting_provider',
      stationPeerId: '12D3KooWStation',
      provider: 'github',
      accessAttemptId: 'access-attempt',
      gateId: 'auth.login',
      expiresAtUnixMs: 42,
      candidatePtid: null,
      errorKey: null,
      recovery: 'none',
    });
  });

  it('maps public terminal results to localized recovery state', () => {
    expect(authRuntimeTestContract.snapshotFromProjection({
      phase: 'expired',
      result: 'OAUTH_ATTEMPT_RESULT_EXPIRED',
    })).toMatchObject({
      errorKey: 'mobile.auth.oauthExpired',
      recovery: 'restart',
    });
    expect(authRuntimeTestContract.snapshotFromProjection({
      phase: 'failed',
      result: 'OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH',
    })).toMatchObject({
      errorKey: 'mobile.auth.oauthBindingMismatch',
      recovery: 'restart',
    });
    expect(authRuntimeTestContract.snapshotFromProjection({
      phase: 'credential_delivery',
      result: 'OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED',
    })).toMatchObject({
      errorKey: null,
      recovery: 'check-status',
    });
  });

  it('applies only the public access decision shape used by the gate UI', () => {
    const decision = authRuntimeTestContract.sanitizeAccessDecision({
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'access-attempt',
      currentGateId: 'terms',
      accessGrantId: '',
      message: '',
      gates: [{
        gateId: 'terms',
        gateType: 'ACCESS_GATE_TYPE_TERMS',
        state: 'ACCESS_GATE_STATE_REQUIRED',
        title: 'terms.title',
        description: 'terms.description',
        blockingReason: '',
        submitAction: '/actor/access/submit',
        inputSchemaJson: '{}',
        alternativeActions: [],
      }],
    });

    expect(decision).toEqual({
      state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
      attemptId: 'access-attempt',
      currentGateId: 'terms',
      accessGrantId: '',
      message: '',
      gates: [{
        gateId: 'terms',
        type: 'ACCESS_GATE_TYPE_TERMS',
        state: 'ACCESS_GATE_STATE_REQUIRED',
        title: 'terms.title',
        description: 'terms.description',
        blockingReason: '',
        submitAction: '/actor/access/submit',
        inputSchemaJson: '{}',
      }],
    });
  });

  it('projects the sanitized access decision into authStore', () => {
    useAuthStore.getState().setAccessDecision(null);
    applyAuthRuntimeProjection({
      phase: 'following_gate',
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
        attemptId: 'access-attempt',
        currentGateId: 'invite.code',
        accessGrantId: '',
        message: '',
        gates: [{
          gateId: 'invite.code',
          gateType: 'ACCESS_GATE_TYPE_INVITE_CODE',
          state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
          title: 'invite.title',
          description: 'invite.description',
          blockingReason: '',
          submitAction: '/actor/access/submit',
          inputSchemaJson: '{}',
          alternativeActions: [],
        }],
      },
    });

    expect(useAuthStore.getState().accessDecision).toMatchObject({
      attemptId: 'access-attempt',
      currentGateId: 'invite.code',
      gates: [{ gateId: 'invite.code', type: 'ACCESS_GATE_TYPE_INVITE_CODE' }],
    });
  });

  it('keeps only declared public projection fields', () => {
    const projection = authRuntimeTestContract.sanitizeProjection({
      phase: 'active_session',
      stationPeerId: '12D3KooWStation',
      session: {
        sessionId: 'session-id',
        actorPtid: 'ptid:alice',
        expiresAt: '2026-08-29T00:00:00Z',
      },
      unexpectedPrivateMaterial: 'must-not-cross',
    });

    expect(projection).toEqual({
      phase: 'active_session',
      stationPeerId: '12D3KooWStation',
      provider: undefined,
      accessAttemptId: undefined,
      gateId: undefined,
      expiresAtUnixMs: undefined,
      result: undefined,
      errorCode: undefined,
      candidate: undefined,
      accessDecision: undefined,
      session: {
        sessionId: 'session-id',
        actorPtid: 'ptid:alice',
        expiresAt: '2026-08-29T00:00:00Z',
      },
    });
  });

  it('maps Rust projection phases onto existing localized copy keys', () => {
    expect(authRuntimeTestContract.oauthPhaseMessageKey('following_gate'))
      .toBe('mobile.auth.oauthState.following-gate');
    expect(authRuntimeTestContract.oauthPhaseMessageKey('credential_delivery'))
      .toBe('mobile.auth.oauthState.exchanging');
  });

  it('binds auth bootstrap and resume to persisted restore plus Station revalidation', () => {
    const runtimeSource = readFileSync(
      new URL('../../runtimes/authRuntime.ts', import.meta.url),
      'utf8',
    );
    const registrySource = readFileSync(
      new URL('../../runtimes/runtimeRegistry.ts', import.meta.url),
      'utf8',
    );

    expect(runtimeSource).toMatch(
      /restoreAndRevalidateAuthRuntime[\s\S]*restoreAuthSession\(\)[\s\S]*verifyStationIdentity\([\s\S]*requireMatchingStationIdentity\([\s\S]*startAccessAttemptWithInvalidSessionRecovery\([\s\S]*restoreAuthRuntimeProjection\(\)/,
    );
    expect(registrySource).toMatch(
      /createAuthRuntimeDescriptor[\s\S]*bootstrap[\s\S]*restoreAndRevalidateAuthRuntime\(\)[\s\S]*resume[\s\S]*restoreAndRevalidateAuthRuntime\(\)/,
    );
  });

  it('keeps business runtimes closed until the Station grants access', () => {
    const session = {
      stationPeerId: 'station-peer',
      stationUrl: 'https://station.example',
      sessionId: 'session-1',
      accessToken: 'test-token',
      actorRef: { ptid: 'ptid:alice' },
      authenticatedAt: 1,
    };
    useAuthStore.setState({
      session,
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    expect(readActiveAuthSession()).toBeNull();

    useAuthStore.setState({
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-1',
        gates: [],
      },
    });
    expect(readActiveAuthSession()).toBe(session);
  });
});
