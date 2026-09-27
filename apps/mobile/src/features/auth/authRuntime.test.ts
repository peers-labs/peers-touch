// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it } from 'vitest';

import {
  applyAuthRuntimeProjection,
  authRuntimeTestContract,
  createAuthRuntimeDescriptor,
} from '../../runtimes/authRuntime';
import { useAuthStore } from './authStore';

describe('station-scoped authRuntime public projection', () => {
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
    expect(JSON.stringify(projection)).not.toMatch(
      /accessToken|refreshToken|authorizationCode|privateKey/,
    );
  });

  it('does not mutate the Access or Session projections', () => {
    useAuthStore.setState(useAuthStore.getInitialState(), true);
    applyAuthRuntimeProjection({
      phase: 'active_session',
      stationPeerId: 'station-a',
      accessDecision: {
        state: 'ACCESS_DECISION_STATE_GRANTED',
        attemptId: 'attempt-a',
        currentGateId: '',
        gates: [],
        accessGrantId: 'grant-a',
        message: '',
      },
      session: {
        sessionId: 'session-a',
        actorPtid: 'ptid:alice',
        expiresAt: '2030-01-02T03:04:05Z',
      },
    });

    expect(useAuthStore.getState().accessDecision).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('maps Rust projection phases onto existing localized copy keys', () => {
    expect(authRuntimeTestContract.oauthPhaseMessageKey('following_gate'))
      .toBe('mobile.auth.oauthState.following-gate');
    expect(authRuntimeTestContract.oauthPhaseMessageKey('credential_delivery'))
      .toBe('mobile.auth.oauthState.exchanging');
  });

  it('declares only the pre-session OAuth runtime boundary', () => {
    const descriptor = createAuthRuntimeDescriptor();
    expect(descriptor.id).toBe('auth');
    expect(descriptor.dependsOn).toEqual(['secure-storage', 'station']);
    expect(descriptor.responsibility).not.toMatch(/active session lifecycle/i);
  });
});
