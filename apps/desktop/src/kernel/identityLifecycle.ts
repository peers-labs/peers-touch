import type { SessionUser } from '../types/navigation';

export type IdentityBootReason = 'cold_launch' | 'renderer_reload' | 'applet_launch';

export type IdentityAuthGateReason =
  | 'cold_policy'
  | 'pin_required'
  | 'session_missing'
  | 'restore_failed'
  | 'revoked'
  | 'logout';

export type IdentityProfileStatus = 'unknown' | 'syncing' | 'ready' | 'stale' | 'failed';
export type IdentityAccountCacheStatus = 'unknown' | 'refreshing' | 'ready' | 'failed';
export type IdentityAvatarStatus = 'unknown' | 'remoteKnown';
export type IdentityBootSessionPolicy = 'restore_session' | 'auth_gate';
export type IdentityAuthenticatedEdgeKind =
  | 'fresh_login'
  | 'completed_login'
  | 'restored_session'
  | 'pin_unlock'
  | 'account_switch'
  | 'applet_launch';

export interface IdentityReadiness {
  profile: IdentityProfileStatus;
  accountCache: IdentityAccountCacheStatus;
  avatar: IdentityAvatarStatus;
}

export type IdentityPhase =
  | { kind: 'booting'; reason: IdentityBootReason }
  | { kind: 'checkingLaunchContext'; reason: IdentityBootReason }
  | { kind: 'resolvingSession'; reason: IdentityBootReason; source: 'live' | 'disk' | 'applet' }
  | { kind: 'accessGateChainPending'; user: SessionUser }
  | { kind: 'accountGate'; reason: IdentityAuthGateReason }
  | { kind: 'pinGate'; accountId: string }
  | {
    kind: 'authenticatedPendingCompletion';
    user: SessionUser;
    readiness: IdentityReadiness;
  }
  | {
    kind: 'authenticated';
    user: SessionUser;
    source: 'login' | 'restore' | 'unlock' | 'switch' | 'applet';
    readiness: IdentityReadiness;
  }
  | { kind: 'revoked'; reason: IdentityAuthGateReason };

export type IdentityEvent =
  | { type: 'BOOT_STARTED'; reason: IdentityBootReason }
  | { type: 'LAUNCH_CONTEXT_CHECK_STARTED' }
  | { type: 'APPLET_LAUNCH_AUTHENTICATED'; user: SessionUser }
  | { type: 'SESSION_RESOLVE_STARTED'; source: 'live' | 'disk' | 'applet' }
  | { type: 'SESSION_RESTORED'; user: SessionUser; source: 'restore' | 'unlock' | 'switch' | 'applet' }
  | { type: 'SESSION_RESTORE_FAILED'; reason: IdentityAuthGateReason }
  | { type: 'ACCESS_GATE_EVALUATING'; user: SessionUser }
  | { type: 'ACCESS_GATE_GRANTED'; user: SessionUser; source: 'restore' | 'unlock' | 'switch' }
  | { type: 'ACCOUNT_GATE_READY'; reason: IdentityAuthGateReason }
  | { type: 'PIN_REQUIRED'; accountId: string }
  | { type: 'FRESH_LOGIN_AUTHENTICATED'; user: SessionUser }
  | { type: 'LOGIN_COMPLETED'; user?: SessionUser }
  | { type: 'LOGIN_SUCCEEDED'; user: SessionUser }
  | { type: 'PROFILE_SYNC_STARTED' }
  | { type: 'PROFILE_SYNC_SUCCEEDED'; user: SessionUser }
  | { type: 'PROFILE_SYNC_FAILED' }
  | { type: 'ACCOUNT_CACHE_REFRESH_STARTED' }
  | { type: 'ACCOUNT_CACHE_REFRESH_SUCCEEDED'; user?: SessionUser }
  | { type: 'ACCOUNT_CACHE_REFRESH_FAILED' }
  | { type: 'SESSION_REVOKED'; reason: IdentityAuthGateReason }
  | { type: 'LOGOUT_REQUESTED' };

export interface IdentityPolicy {
  coldLaunch: IdentityBootSessionPolicy;
  rendererReload: IdentityBootSessionPolicy;
  appletLaunch: IdentityBootSessionPolicy;
}

export const DEFAULT_IDENTITY_POLICY: IdentityPolicy = {
  coldLaunch: 'restore_session',
  rendererReload: 'restore_session',
  appletLaunch: 'restore_session',
};

export type IdentityBootResolution =
  | { kind: 'resolveSession'; source: 'live' | 'applet' }
  | { kind: 'authGate'; reason: IdentityAuthGateReason };

export interface IdentityAuthenticatedEdge {
  kind: IdentityAuthenticatedEdgeKind;
  completion: 'pending' | 'ready';
  user: SessionUser;
  event: IdentityEvent;
}

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

const initialReadiness: IdentityReadiness = {
  profile: 'unknown',
  accountCache: 'unknown',
  avatar: 'unknown',
};

function avatarStatusForUser(user: SessionUser): IdentityAvatarStatus {
  return user.avatar ? 'remoteKnown' : 'unknown';
}

function authenticatedPhase(
  user: SessionUser,
  source: Extract<IdentityPhase, { kind: 'authenticated' }>['source'],
): IdentityPhase {
  return {
    kind: 'authenticated',
    user,
    source,
    readiness: {
      ...initialReadiness,
      avatar: avatarStatusForUser(user),
    },
  };
}

function authenticatedPendingCompletionPhase(user: SessionUser): IdentityPhase {
  return {
    kind: 'authenticatedPendingCompletion',
    user,
    readiness: {
      ...initialReadiness,
      avatar: avatarStatusForUser(user),
    },
  };
}

function updateAuthenticated(
  state: IdentityPhase,
  patch: Partial<Pick<Extract<IdentityPhase, { kind: 'authenticated' }>, 'user'>>,
  readinessPatch?: Partial<IdentityReadiness>,
): IdentityPhase {
  if (state.kind !== 'authenticated' && state.kind !== 'authenticatedPendingCompletion') return state;
  return {
    ...state,
    ...patch,
    readiness: {
      ...state.readiness,
      ...readinessPatch,
    },
  };
}

export function resolveBootSessionPolicy(
  reason: IdentityBootReason,
  policy: IdentityPolicy = DEFAULT_IDENTITY_POLICY,
): IdentityBootResolution {
  if (reason === 'renderer_reload') {
    return policy.rendererReload === 'restore_session'
      ? { kind: 'resolveSession', source: 'live' }
      : { kind: 'authGate', reason: 'cold_policy' };
  }
  if (reason === 'cold_launch') {
    return policy.coldLaunch === 'restore_session'
      ? { kind: 'resolveSession', source: 'live' }
      : { kind: 'authGate', reason: 'cold_policy' };
  }
  return policy.appletLaunch === 'restore_session'
    ? { kind: 'resolveSession', source: 'applet' }
    : { kind: 'authGate', reason: 'cold_policy' };
}

export function identityAuthenticatedEdge(
  kind: IdentityAuthenticatedEdgeKind,
  user: SessionUser,
): IdentityAuthenticatedEdge {
  switch (kind) {
    case 'fresh_login':
      return {
        kind,
        completion: 'pending',
        user,
        event: { type: 'FRESH_LOGIN_AUTHENTICATED', user },
      };
    case 'completed_login':
      return {
        kind,
        completion: 'ready',
        user,
        event: { type: 'LOGIN_SUCCEEDED', user },
      };
    case 'restored_session':
      return {
        kind,
        completion: 'ready',
        user,
        event: { type: 'SESSION_RESTORED', source: 'restore', user },
      };
    case 'pin_unlock':
      return {
        kind,
        completion: 'ready',
        user,
        event: { type: 'SESSION_RESTORED', source: 'unlock', user },
      };
    case 'account_switch':
      return {
        kind,
        completion: 'ready',
        user,
        event: { type: 'SESSION_RESTORED', source: 'switch', user },
      };
    case 'applet_launch':
      return {
        kind,
        completion: 'ready',
        user,
        event: { type: 'APPLET_LAUNCH_AUTHENTICATED', user },
      };
  }
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
      return authenticatedPhase(event.user, 'applet');
    case 'SESSION_RESOLVE_STARTED':
      return {
        kind: 'resolvingSession',
        reason: bootReasonFromPhase(state),
        source: event.source,
      };
    case 'SESSION_RESTORED':
      return authenticatedPhase(event.user, event.source);
    case 'ACCESS_GATE_EVALUATING':
      return { kind: 'accessGateChainPending', user: event.user };
    case 'ACCESS_GATE_GRANTED':
      return authenticatedPhase(event.user, event.source);
    case 'SESSION_RESTORE_FAILED':
    case 'ACCOUNT_GATE_READY':
      return { kind: 'accountGate', reason: event.reason };
    case 'PIN_REQUIRED':
      return { kind: 'pinGate', accountId: event.accountId };
    case 'FRESH_LOGIN_AUTHENTICATED':
      return authenticatedPendingCompletionPhase(event.user);
    case 'LOGIN_COMPLETED':
      if (state.kind === 'authenticatedPendingCompletion') {
        return {
          kind: 'authenticated',
          source: 'login',
          user: event.user ?? state.user,
          readiness: state.readiness,
        };
      }
      return state;
    case 'LOGIN_SUCCEEDED':
      return authenticatedPhase(event.user, 'login');
    case 'PROFILE_SYNC_STARTED':
      return updateAuthenticated(state, {}, { profile: 'syncing' });
    case 'PROFILE_SYNC_SUCCEEDED':
      return updateAuthenticated(
        state,
        { user: event.user },
        { profile: 'ready', avatar: avatarStatusForUser(event.user) },
      );
    case 'PROFILE_SYNC_FAILED':
      return updateAuthenticated(state, {}, { profile: 'failed' });
    case 'ACCOUNT_CACHE_REFRESH_STARTED':
      return updateAuthenticated(state, {}, { accountCache: 'refreshing' });
    case 'ACCOUNT_CACHE_REFRESH_SUCCEEDED':
      return updateAuthenticated(
        state,
        event.user ? { user: event.user } : {},
        {
          accountCache: 'ready',
          ...(event.user ? { avatar: avatarStatusForUser(event.user) } : {}),
        },
      );
    case 'ACCOUNT_CACHE_REFRESH_FAILED':
      return updateAuthenticated(state, {}, { accountCache: 'failed' });
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
