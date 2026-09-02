import { describe, expect, it } from 'vitest';

import {
  appStateFromIdentity,
  identityPhaseNeedsAuthGate,
  identityReducer,
  type IdentityPhase,
} from '../kernel/identityLifecycle';
import { lifecycleNeedsSessionRevalidation } from './useAppLifecycle';

describe('desktop app lifecycle auth gate', () => {
  it('revalidates only when the ready shell loses its session mirror', () => {
    expect(lifecycleNeedsSessionRevalidation('ready', false)).toBe(true);
    expect(lifecycleNeedsSessionRevalidation('ready', true)).toBe(false);
    expect(lifecycleNeedsSessionRevalidation('resuming', false)).toBe(false);
    expect(lifecycleNeedsSessionRevalidation('onboarding', false)).toBe(false);
  });

  it('does not restore a live Rust session after logout resets the store', () => {
    const authenticated: IdentityPhase = {
      kind: 'authenticated',
      source: 'login',
      user: {
        accountId: 'password:actor-1',
        email: 'u@example.com',
        hasSession: true,
        name: 'User',
        provider: 'password',
      },
      readiness: {
        accountCache: 'ready',
        avatar: 'unknown',
        profile: 'ready',
      },
    };
    const logout = identityReducer(authenticated, {
      type: 'LOGOUT_REQUESTED',
    });
    const appState = appStateFromIdentity(logout);

    expect(logout).toEqual({ kind: 'loggingOut' });
    expect(identityPhaseNeedsAuthGate(logout)).toBe(false);
    expect(appState).toBe('resuming');
    expect(lifecycleNeedsSessionRevalidation(appState, false)).toBe(false);
  });
});
