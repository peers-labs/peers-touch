import type { SessionUser } from '../types/navigation';

export type IdentityBootReason = 'cold_launch' | 'renderer_reload' | 'applet_launch';

export type IdentityAuthGateReason =
  | 'cold_policy'
  | 'pin_required'
  | 'session_missing'
  | 'restore_failed'
  | 'revoked'
  | 'logout';

export type IdentityPhase =
  | { kind: 'booting'; reason: IdentityBootReason }
  | { kind: 'checkingLaunchContext'; reason: IdentityBootReason }
  | { kind: 'resolvingSession'; reason: IdentityBootReason; source: 'live' | 'disk' | 'applet' }
  | { kind: 'accountGate'; reason: IdentityAuthGateReason }
  | { kind: 'pinGate'; accountId: string }
  | { kind: 'authenticated'; user: SessionUser; source: 'login' | 'restore' | 'unlock' | 'switch' | 'applet' }
  | { kind: 'revoked'; reason: IdentityAuthGateReason };

export type IdentityEvent =
  | { type: 'BOOT_STARTED'; reason: IdentityBootReason }
  | { type: 'LAUNCH_CONTEXT_CHECK_STARTED' }
  | { type: 'APPLET_LAUNCH_AUTHENTICATED'; user: SessionUser }
  | { type: 'SESSION_RESOLVE_STARTED'; source: 'live' | 'disk' | 'applet' }
  | { type: 'SESSION_RESTORED'; user: SessionUser; source: 'restore' | 'unlock' | 'switch' | 'applet' }
  | { type: 'SESSION_RESTORE_FAILED'; reason: IdentityAuthGateReason }
  | { type: 'ACCOUNT_GATE_READY'; reason: IdentityAuthGateReason }
  | { type: 'PIN_REQUIRED'; accountId: string }
  | { type: 'LOGIN_SUCCEEDED'; user: SessionUser }
  | { type: 'SESSION_REVOKED'; reason: IdentityAuthGateReason }
  | { type: 'LOGOUT_REQUESTED' };

export interface IdentityPolicy {
  allowRestoreOnColdLaunch: boolean;
  allowRestoreOnRendererReload: boolean;
}

export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = {
  allowRestoreOnColdLaunch: false,
  allowRestoreOnRendererReload: true,
};

function bootReasonFromPhase(state: IdentityPhase): IdentityBootReason {
  if (
    state.kind === 'booting'
    || state.kind === 'checkingLaunchContext'
    || state.kind === 'resolvingSession'
  ) {
    return state.reason;
  }
  return 'cold_launch';
}

export function shouldResolveSessionOnBoot(
  reason: IdentityBootReason,
  policy: IdentityPolicy = DEFAULT_IDENTITY_POLICY,
): boolean {
  if (reason === 'renderer_reload') return policy.allowRestoreOnRendererReload;
  if (reason === 'cold_launch') return policy.allowRestoreOnColdLaunch;
  return true;
}

export function identityReducer(state: IdentityPhase, event: IdentityEvent): IdentityPhase {
  switch (event.type) {
    case 'BOOT_STARTED':
      return { kind: 'booting', reason: event.reason };
    case 'LAUNCH_CONTEXT_CHECK_STARTED':
      return {
        kind: 'checkingLaunchContext',
        reason: bootReasonFromPhase(state),
      };
    case 'APPLET_LAUNCH_AUTHENTICATED':
      return { kind: 'authenticated', user: event.user, source: 'applet' };
    case 'SESSION_RESOLVE_STARTED':
      return {
        kind: 'resolvingSession',
        reason: bootReasonFromPhase(state),
        source: event.source,
      };
    case 'SESSION_RESTORED':
      return { kind: 'authenticated', user: event.user, source: event.source };
    case 'SESSION_RESTORE_FAILED':
    case 'ACCOUNT_GATE_READY':
      return { kind: 'accountGate', reason: event.reason };
    case 'PIN_REQUIRED':
      return { kind: 'pinGate', accountId: event.accountId };
    case 'LOGIN_SUCCEEDED':
      return { kind: 'authenticated', user: event.user, source: 'login' };
    case 'SESSION_REVOKED':
      return { kind: 'revoked', reason: event.reason };
    case 'LOGOUT_REQUESTED':
      return { kind: 'accountGate', reason: 'logout' };
    default:
      return state;
  }
}

export function identityPhaseAllowsReady(phase: IdentityPhase): boolean {
  return phase.kind === 'authenticated';
}

export function identityPhaseNeedsAuthGate(phase: IdentityPhase): boolean {
  return phase.kind === 'accountGate' || phase.kind === 'pinGate' || phase.kind === 'revoked';
}
