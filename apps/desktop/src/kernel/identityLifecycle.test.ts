import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IDENTITY_POLICY,
  identityAuthenticatedEdge,
  identityPhaseAllowsReady,
  identityPhaseNeedsAuthGate,
  identityReducer,
  resolveBootSessionPolicy,
  type IdentityPhase,
} from './identityLifecycle';

const user = {
  accountId: 'password:actor-1',
  avatar: 'https://example.test/avatar.png',
  email: 'u@example.com',
  hasSession: true,
  name: 'User',
  provider: 'password',
};

describe('identity lifecycle state machine', () => {
  it('restores a cold launch by default', () => {
    expect(resolveBootSessionPolicy('cold_launch', DEFAULT_IDENTITY_POLICY)).toEqual({
      kind: 'resolveSession',
      source: 'live',
    });
  });

  it('does restore a renderer reload by default', () => {
    expect(resolveBootSessionPolicy('renderer_reload', DEFAULT_IDENTITY_POLICY)).toEqual({
      kind: 'resolveSession',
      source: 'live',
    });
  });

  it('resolves boot restore policy as an explicit decision', () => {
    expect(resolveBootSessionPolicy('cold_launch', DEFAULT_IDENTITY_POLICY)).toEqual({
      kind: 'resolveSession',
      source: 'live',
    });
    expect(resolveBootSessionPolicy('cold_launch', {
      ...DEFAULT_IDENTITY_POLICY,
      coldLaunch: 'auth_gate',
    })).toEqual({
      kind: 'authGate',
      reason: 'cold_policy',
    });
  });

  it('models authenticated edges with completion semantics', () => {
    expect(identityAuthenticatedEdge('fresh_login', user)).toMatchObject({
      completion: 'pending',
      event: { type: 'FRESH_LOGIN_AUTHENTICATED' },
      kind: 'fresh_login',
    });
    expect(identityAuthenticatedEdge('completed_login', user)).toMatchObject({
      completion: 'ready',
      event: { type: 'LOGIN_SUCCEEDED' },
      kind: 'completed_login',
    });
    expect(identityAuthenticatedEdge('pin_unlock', user)).toMatchObject({
      completion: 'ready',
      event: { source: 'unlock', type: 'SESSION_RESTORED' },
      kind: 'pin_unlock',
    });
  });

  it('keeps ready behind authenticated only', () => {
    const booting: IdentityPhase = { kind: 'booting', reason: 'cold_launch' };
    const resolving = identityReducer(booting, { type: 'SESSION_RESOLVE_STARTED', source: 'live' });
    const authenticated = identityReducer(resolving, {
      type: 'SESSION_RESTORED',
      source: 'restore',
      user,
    });

    expect(identityPhaseAllowsReady(resolving)).toBe(false);
    expect(identityPhaseAllowsReady(authenticated)).toBe(true);
    expect(authenticated).toMatchObject({
      readiness: {
        accountCache: 'unknown',
        avatar: 'remoteKnown',
        profile: 'unknown',
      },
    });
  });

  it('routes failed restores to the account gate with a reason', () => {
    const booting: IdentityPhase = { kind: 'booting', reason: 'renderer_reload' };
    const resolving = identityReducer(booting, { type: 'SESSION_RESOLVE_STARTED', source: 'live' });
    const gate = identityReducer(resolving, {
      type: 'SESSION_RESTORE_FAILED',
      reason: 'session_missing',
    });

    expect(gate).toEqual({ kind: 'accountGate', reason: 'session_missing' });
    expect(identityPhaseNeedsAuthGate(gate)).toBe(true);
  });

  it('treats revoked sessions as a terminal identity event', () => {
    const authenticated = identityReducer(
      { kind: 'booting', reason: 'renderer_reload' },
      { type: 'SESSION_RESTORED', source: 'restore', user },
    );
    const revoked = identityReducer(authenticated, {
      type: 'SESSION_REVOKED',
      reason: 'revoked',
    });

    expect(revoked).toEqual({ kind: 'revoked', reason: 'revoked' });
    expect(identityPhaseAllowsReady(revoked)).toBe(false);
  });

  it('tracks profile and account cache substates inside authenticated phase', () => {
    const authenticated = identityReducer(
      { kind: 'booting', reason: 'renderer_reload' },
      { type: 'LOGIN_SUCCEEDED', user },
    );
    const syncing = identityReducer(authenticated, { type: 'PROFILE_SYNC_STARTED' });
    const synced = identityReducer(syncing, {
      type: 'PROFILE_SYNC_SUCCEEDED',
      user: { ...user, avatar: 'https://example.test/new-avatar.png' },
    });
    const refreshing = identityReducer(synced, { type: 'ACCOUNT_CACHE_REFRESH_STARTED' });
    const ready = identityReducer(refreshing, { type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED' });

    expect(syncing).toMatchObject({ readiness: { profile: 'syncing' } });
    expect(synced).toMatchObject({
      readiness: { avatar: 'remoteKnown', profile: 'ready' },
      user: { avatar: 'https://example.test/new-avatar.png' },
    });
    expect(refreshing).toMatchObject({ readiness: { accountCache: 'refreshing' } });
    expect(ready).toMatchObject({ readiness: { accountCache: 'ready' } });
  });

  it('keeps fresh login reconciliation observable before login completion', () => {
    const pending = identityReducer(
      { kind: 'accountGate', reason: 'session_missing' },
      { type: 'FRESH_LOGIN_AUTHENTICATED', user },
    );
    const syncing = identityReducer(pending, { type: 'PROFILE_SYNC_STARTED' });
    const synced = identityReducer(syncing, {
      type: 'PROFILE_SYNC_SUCCEEDED',
      user: { ...user, avatar: 'https://example.test/fresh-avatar.png' },
    });
    const completed = identityReducer(synced, { type: 'LOGIN_COMPLETED' });

    expect(identityPhaseAllowsReady(pending)).toBe(false);
    expect(syncing).toMatchObject({ readiness: { profile: 'syncing' } });
    expect(synced).toMatchObject({
      kind: 'authenticatedPendingCompletion',
      readiness: { avatar: 'remoteKnown', profile: 'ready' },
      user: { avatar: 'https://example.test/fresh-avatar.png' },
    });
    expect(completed).toMatchObject({
      kind: 'authenticated',
      source: 'login',
      readiness: { profile: 'ready' },
      user: { avatar: 'https://example.test/fresh-avatar.png' },
    });
    expect(identityPhaseAllowsReady(completed)).toBe(true);
  });
});
