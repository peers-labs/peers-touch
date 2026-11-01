import { createDesktopStore } from './createDesktopStore';
import { api, AuthCommandException, type AuthSessionResponse, type NativeAvatarState } from '../services/desktop_api';
import { markLocalIdentityAction } from '../services/identity_event';
import { runIdentityPipeline } from '../services/identityPipeline';
import { sessionIdentityScope } from '../kernel/sessionIdentity';
import { avatarAssets } from '../services/avatarAssets';
import {
  accessSubmissionDescriptor,
  completeAccessSubmission,
  currentGate,
  isLoginGate,
  normalizeDecision,
  requireSupportedAccessDecision,
  stationAccessError,
  type AccessDecision,
  type AccessGate,
} from '../services/accessGate';

// ── Types ──

// TODO(unified-actor): align with AccountIdentity (desktop_api) for cross-layer consistency.
export interface CurrentUser {
  actorPtid: string;
  name: string;
  email: string;
  /**
   * Canonical avatar identity (raw Station path / external URL / data URI).
   * The single piece of avatar identity the session mirror tracks; local
   * file caching and decode readiness belong to services/avatarAssets.
   */
  avatarUrl?: string;
  /** Persisted local avatar file (from the native account identity). Used as
   *  the local decode fast lane on login / restore edges. */
  avatarLocalPath?: string;
  /** Typed native avatar state from the latest authoritative sync. */
  avatarState?: NativeAvatarState;
  /** Canonical profile revision; drives same-URL content swaps. */
  profileRevision?: number;
  loginMethod: string;
  loginProvider?: string;
}

const initialState = {
  currentUser: null as CurrentUser | null,
  authenticated: false,
  restoring: false,
  sessionEpoch: 0,
  stationPeerId: null as string | null,
};

interface SessionStore {
  currentUser: CurrentUser | null;
  authenticated: boolean;
  restoring: boolean;
  /** Monotonic owner signal for every accepted or cleared native session. */
  sessionEpoch: number;
  /** Canonical Station identity from the completed native binding. */
  stationPeerId: string | null;

  reset: () => void;
  hydrate: (actorPtid: string) => Promise<void>;

  loginWithPassword: (account: string, password: string) => Promise<void>;
  loginWithOAuth: (providerId: string) => Promise<void>;
  /** Open an interactive access attempt and return the Station's first decision. */
  accessStart: () => Promise<AccessDecision>;
  /** Redeem an invite code against a live attempt; returns the re-evaluated decision. */
  accessSubmitInviteCode: (attemptId: string, gate: AccessGate, code: string) => Promise<AccessDecision>;
  /** Submit the login gate for a live attempt; on grant lands the session. */
  accessSubmitLogin: (attemptId: string, gate: AccessGate, account: string, password: string) => Promise<void>;
  accessCancel: (attemptId: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  logout: () => Promise<void>;
  activateAuthenticatedSession: (response: AuthSessionResponse, stationPeerId: string | null) => void;
  activateAppletLaunchSession: (user: CurrentUser) => void;
  /**
   * Update the current actor profile projection. `fence` is captured by the
   * caller before an await; when the current session epoch/actor no longer
   * matches (a newer login/switch happened), the late update is dropped.
   */
  updateProfile: (
    profile: Partial<Pick<CurrentUser, 'name' | 'email' | 'avatarUrl' | 'avatarLocalPath' | 'avatarState' | 'profileRevision'>>,
    fence?: { epoch: number; actorPtid: string },
  ) => void;
  /** Update the remote avatar URL after upload or profile sync. */
  updateAvatar: (avatarUrl: string) => void;
}

type SessionMirrorState = Pick<ReturnType<typeof useSessionStore.getState>,
  'currentUser' | 'authenticated' | 'restoring' | 'sessionEpoch' | 'stationPeerId'>;

/**
 * Commit an authenticated actor mirror and bind the React-free AvatarAssets
 * owner to the new session epoch. The binding fences late responses from any
 * previous actor/session and seeds the local decode fast lane.
 */
function commitAuthenticatedSession(
  set: (updater: (state: SessionMirrorState) => Partial<SessionMirrorState>) => void,
  user: CurrentUser | null,
  restoring: boolean,
  stationPeerId: string | null,
): void {
  set((state) => {
    const sessionEpoch = state.sessionEpoch + 1;
    if (user) {
      avatarAssets.bindSession({
        epoch: sessionEpoch,
        actorPtid: user.actorPtid,
        stationScope: null,
        identity: user.avatarUrl ?? '',
        revision: user.profileRevision ?? null,
        localPath: user.avatarLocalPath ?? null,
        state: user.avatarState,
      });
    }
    return { currentUser: user, authenticated: Boolean(user), restoring, sessionEpoch, stationPeerId };
  });
}

// ── Helpers (exported for tests; mapping mirrors `restoreSession`) ──

async function completeStationBindingOrRollback(): Promise<string | null> {
  try {
    const binding = await api.stationBindingComplete();
    return binding?.phase === 'bound' ? binding.station_peer_id ?? null : null;
  } catch (error) {
    const bindingError = stationAccessError(error);
    try {
      await api.authLogout();
    } catch (rollbackError) {
      const rollbackMessage = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(`${bindingError.message}; session rollback failed: ${rollbackMessage}`);
    }
    throw bindingError;
  }
}

function userFromAuthResponse(resp: AuthSessionResponse, fallbackMethod: 'password' | 'oauth', provider?: string): CurrentUser | null {
  if (!resp.actor_ptid?.startsWith('ptid:')) return null;
  return {
    actorPtid: resp.actor_ptid,
    name: resp.name || '',
    email: resp.email || '',
    avatarUrl: resp.avatar_url || undefined,
    avatarLocalPath: resp.avatar_local_path || undefined,
    loginMethod: (resp.login_method as 'password' | 'oauth') || fallbackMethod,
    loginProvider: provider,
  };
}

// ── Store ──

export const useSessionStore = createDesktopStore<SessionStore>('session', (set, get) => ({
  ...initialState,

  reset: () => set((state) => {
    avatarAssets.unbindSession();
    return {
      ...initialState,
      sessionEpoch: state.sessionEpoch + 1,
    };
  }),

  hydrate: async () => {
    await get().restoreSession();
  },

  loginWithPassword: async (account, password) => {
    const decision = await get().accessStart();
    const gate = currentGate(decision);
    if (!gate || !isLoginGate(gate)) throw new Error('auth.gate.unsupported');
    await get().accessSubmitLogin(decision.attemptId, gate, account, password);
  },

  accessStart: async () => {
    try {
      const resp = await api.accessStart();
      return requireSupportedAccessDecision(normalizeDecision(resp.decision));
    } catch (error) {
      throw stationAccessError(error);
    }
  },

  accessSubmitInviteCode: async (attemptId, gate, code) => {
    const { key, ...descriptor } = accessSubmissionDescriptor(attemptId, gate);
    try {
      const resp = await api.accessSubmitInviteCode({
        attempt_id: attemptId,
        ...descriptor,
        invite_code: code,
      });
      completeAccessSubmission(key);
      return requireSupportedAccessDecision(normalizeDecision(resp.decision));
    } catch (error) {
      throw stationAccessError(error);
    }
  },

  accessSubmitLogin: async (attemptId, gate, account, password) => {
    const previousScope = sessionIdentityScope(get());
    markLocalIdentityAction();
    const { key, ...descriptor } = accessSubmissionDescriptor(attemptId, gate);
    let resp;
    try {
      resp = await api.accessSubmitLogin({
        attempt_id: attemptId,
        ...descriptor,
        account,
        password,
      });
    } catch (error) {
      throw stationAccessError(error);
    }
    const stationPeerId = await completeStationBindingOrRollback();
    completeAccessSubmission(key);
    get().activateAuthenticatedSession(resp, stationPeerId);
    await runIdentityPipeline({
      reason: 'login',
      actorPtid: resp.actor_ptid ?? null,
      loginMethod: 'password',
    }, previousScope);
  },

  accessCancel: async (attemptId) => {
    try {
      await api.accessCancel(attemptId);
    } catch (error) {
      throw stationAccessError(error);
    }
  },

  loginWithOAuth: async (_providerId: string) => {
    const previousScope = sessionIdentityScope(get());
    markLocalIdentityAction();
    const resp = await api.ensureStationSession();
    const stationPeerId = await completeStationBindingOrRollback();
    get().activateAuthenticatedSession(resp, stationPeerId);
    const method = (resp.login_method as string) || 'oauth';
    await runIdentityPipeline({
      reason: 'oauth_bridge',
      actorPtid: resp.actor_ptid ?? null,
      loginMethod: method,
    }, previousScope);
  },

  restoreSession: async () => {
    set({ restoring: true });
    try {
      const resp = await api.authRestoreSession();
      const stationPeerId = await completeStationBindingOrRollback();
      const method = resp.login_method || 'password';
      const isOAuth = method !== 'password';
      const user = userFromAuthResponse(resp, isOAuth ? 'oauth' : 'password', isOAuth ? method : undefined);
      commitAuthenticatedSession(set, user, false, stationPeerId);
    } catch (error) {
      if (error instanceof AuthCommandException && error.code === 'UNAUTHORIZED') {
        if (error.details?.reason === 'oauth_acknowledgement_pending') {
          set({ restoring: false });
          throw error;
        }
        set((state) => {
          avatarAssets.unbindSession();
          return {
            currentUser: null,
            authenticated: false,
            restoring: false,
            sessionEpoch: state.sessionEpoch + 1,
            stationPeerId: null,
          };
        });
        return;
      }
      set({ restoring: false });
      throw error;
    }
  },

  logout: async () => {
    markLocalIdentityAction();
    const previousScope = sessionIdentityScope(get());
    let cleanupError: unknown;
    try {
      await api.authLogout();
    } catch (error) {
      cleanupError = error;
    }
    const result = await runIdentityPipeline({
      reason: 'logout',
      actorPtid: null,
      loginMethod: null,
    }, previousScope);
    if (!result.ok && !cleanupError) cleanupError = result.failures[0]?.error;
    if (cleanupError) {
      throw cleanupError;
    }
  },

  activateAuthenticatedSession: (response, stationPeerId) => {
    const method = response.login_method || 'password';
    const isOAuth = method !== 'password';
    const user = userFromAuthResponse(
      response,
      isOAuth ? 'oauth' : 'password',
      isOAuth ? method : undefined,
    );
    commitAuthenticatedSession(set, user, false, stationPeerId);
  },

  activateAppletLaunchSession: (user) => {
    // Synthetic applet actors carry no avatar; bind only the epoch fence.
    avatarAssets.bindSession({
      epoch: useSessionStore.getState().sessionEpoch + 1,
      actorPtid: user.actorPtid,
      stationScope: 'applet',
      identity: '',
      revision: null,
      localPath: null,
      state: 'absent',
    });
    set((state) => ({
      currentUser: user,
      authenticated: true,
      restoring: false,
      sessionEpoch: state.sessionEpoch + 1,
      stationPeerId: null,
    }));
  },

  updateProfile: (profile, fence) => {
    set((state) => {
      if (!state.currentUser) return state;
      // Drop late writes from an older session/actor; a newer edge owns state.
      if (
        fence
        && (state.sessionEpoch !== fence.epoch || state.currentUser.actorPtid !== fence.actorPtid)
      ) {
        return state;
      }
      const currentUser = {
        ...state.currentUser,
        ...profile,
      };
      if (
        profile.avatarUrl !== undefined
        || profile.avatarLocalPath !== undefined
        || profile.avatarState !== undefined
        || profile.profileRevision !== undefined
      ) {
        avatarAssets.bindSession({
          epoch: state.sessionEpoch,
          actorPtid: currentUser.actorPtid,
          stationScope: null,
          identity: currentUser.avatarUrl ?? '',
          revision: currentUser.profileRevision ?? null,
          localPath: currentUser.avatarLocalPath ?? null,
          state: currentUser.avatarState,
        });
      }
      return { currentUser };
    });
  },

  updateAvatar: (avatarUrl: string) => {
    set((state) => {
      if (!state.currentUser) return state;
      return {
        currentUser: { ...state.currentUser, avatarUrl },
      };
    });
  },
}));

export function currentAuthenticatedActorPtid(): string | null {
  const session = useSessionStore.getState();
  if (!session.authenticated) return null;
  return session.currentUser?.actorPtid ?? null;
}
