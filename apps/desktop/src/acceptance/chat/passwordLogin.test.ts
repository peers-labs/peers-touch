import { describe, expect, it, vi } from 'vitest';
import {
  isChatAccountGateReady,
  isChatAuthenticatedReady,
  isChatLoginPreconditionReady,
  runChatPasswordLogin,
  type ChatIdentityLoginState,
  type ChatPasswordLoginLifecycle,
} from './passwordLogin';

function accountGateState(): ChatIdentityLoginState {
  return {
    phaseKind: 'accountGate',
    lifecycleState: 'resuming',
    dataReady: true,
    authenticated: false,
  };
}

function authenticatedState(): ChatIdentityLoginState {
  return {
    phaseKind: 'authenticated',
    lifecycleState: 'ready',
    dataReady: true,
    authenticated: true,
  };
}

describe('runChatPasswordLogin', () => {
  it('preserves the fresh account-gate login path without logging out', async () => {
    let state = accountGateState();
    const calls: string[] = [];
    const lifecycle: ChatPasswordLoginLifecycle = {
      boot: () => calls.push('boot'),
      readState: () => state,
      waitFor: async (predicate, description) => {
        calls.push(`wait:${description}`);
        expect(predicate(state)).toBe(true);
      },
      logout: vi.fn(),
      loginWithPassword: async (account, password) => {
        calls.push(`login:${account}:${password}`);
        state = {
          ...state,
          phaseKind: 'authenticatedPendingCompletion',
          authenticated: true,
        };
      },
      completeCurrentSession: async () => {
        calls.push('complete');
        state = authenticatedState();
      },
    };

    await runChatPasswordLogin(lifecycle, 'alice@p.t', '1');

    expect(calls).toEqual([
      'boot',
      'wait:identity login precondition',
      'wait:identity account gate before login',
      'login:alice@p.t:1',
      'complete',
      'wait:authenticated identity lifecycle',
    ]);
    expect(lifecycle.logout).not.toHaveBeenCalled();
  });

  it('logs out every restored session before the requested explicit login', async () => {
    let state = authenticatedState();
    const calls: string[] = [];
    const lifecycle: ChatPasswordLoginLifecycle = {
      boot: () => calls.push('boot'),
      readState: () => state,
      waitFor: async (predicate, description) => {
        calls.push(`wait:${description}`);
        expect(predicate(state)).toBe(true);
      },
      logout: async () => {
        calls.push('logout:restored-bob');
        state = accountGateState();
      },
      loginWithPassword: async (account) => {
        calls.push(`login:${account}`);
        state = {
          ...state,
          phaseKind: 'authenticatedPendingCompletion',
          authenticated: true,
        };
      },
      completeCurrentSession: async () => {
        calls.push('complete');
        state = authenticatedState();
      },
    };

    await runChatPasswordLogin(lifecycle, 'alice@p.t', '1');

    expect(calls).toEqual([
      'boot',
      'wait:identity login precondition',
      'logout:restored-bob',
      'wait:identity account gate before login',
      'login:alice@p.t',
      'complete',
      'wait:authenticated identity lifecycle',
    ]);
  });

  it('does not admit an incomplete boot or unauthenticated ready state', () => {
    expect(isChatLoginPreconditionReady({
      phaseKind: 'resolvingSession',
      lifecycleState: 'resuming',
      dataReady: false,
      authenticated: false,
    })).toBe(false);
    expect(isChatLoginPreconditionReady({
      phaseKind: 'authenticated',
      lifecycleState: 'ready',
      dataReady: true,
      authenticated: false,
    })).toBe(false);
    expect(isChatAccountGateReady(authenticatedState())).toBe(false);
    expect(isChatAuthenticatedReady(accountGateState())).toBe(false);
  });

  it('propagates restored-session logout failure before credential login', async () => {
    const loginWithPassword = vi.fn();
    const completeCurrentSession = vi.fn();
    const lifecycle: ChatPasswordLoginLifecycle = {
      boot: vi.fn(),
      readState: authenticatedState,
      waitFor: async (predicate) => {
        expect(predicate(authenticatedState())).toBe(true);
      },
      logout: async () => {
        throw new Error('logout failed');
      },
      loginWithPassword,
      completeCurrentSession,
    };

    await expect(
      runChatPasswordLogin(lifecycle, 'alice@p.t', '1'),
    ).rejects.toThrow('logout failed');
    expect(loginWithPassword).not.toHaveBeenCalled();
    expect(completeCurrentSession).not.toHaveBeenCalled();
  });
});
