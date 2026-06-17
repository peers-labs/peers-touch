import { describe, expect, it } from 'vitest';

import {
  DEFAULT_IDENTITY_POLICY,
  identityPhaseAllowsReady,
  identityPhaseNeedsAuthGate,
  identityReducer,
  shouldResolveSessionOnBoot,
  type IdentityPhase,
} from './identityLifecycle';

const user = {
  accountId: 'password:actor-1',
  email: 'u@example.com',
  hasSession: true,
  name: 'User',
  provider: 'password',
};

describe('identity lifecycle state machine', () => {
  it('does not restore a cold launch by default', () => {
    expect(shouldResolveSessionOnBoot('cold_launch', DEFAULT_IDENTITY_POLICY)).toBe(false);
  });

  it('does restore a renderer reload by default', () => {
    expect(shouldResolveSessionOnBoot('renderer_reload', DEFAULT_IDENTITY_POLICY)).toBe(true);
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
    const authenticated: IdentityPhase = { kind: 'authenticated', source: 'restore', user };
    const revoked = identityReducer(authenticated, {
      type: 'SESSION_REVOKED',
      reason: 'revoked',
    });

    expect(revoked).toEqual({ kind: 'revoked', reason: 'revoked' });
    expect(identityPhaseAllowsReady(revoked)).toBe(false);
  });
});
