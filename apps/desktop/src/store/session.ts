import { createDesktopStore } from './createDesktopStore';
import { api, AuthCommandException, type AuthSessionResponse } from '../services/desktop_api';
import { markLocalIdentityAction } from '../services/identity_event';
import { runIdentityPipeline } from '../services/identityPipeline';
import { primeResolvedLocal } from '../components/common/SquareAvatar';
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
  /** Remote avatar URL. The single piece of avatar state the frontend tracks;
   *  local file caching is owned by the UserSquareAvatar component / Rust
   *  avatar_cache infrastructure. */
  avatarUrl?: string;
  /** Persisted local avatar file (from the native account identity). Kept so
   *  session transitions can warm the avatar cache before the shell mounts. */
  avatarLocalPath?: string;
  loginMethod: string;
  loginProvider?: string;
}

const initialState = {
  currentUser: null as CurrentUser | null,
  authenticated: false,
  restoring: false,
  sessionEpoch: 0,
};

interface SessionStore {
  currentUser: CurrentUser | null;
  authenticated: boolean;
  restoring: boolean;
  /** Monotonic owner signal for every accepted or cleared native session. */
  sessionEpoch: number;

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
  activateAuthenticatedSession: (response: AuthSessionResponse) => void;
  activateAppletLaunchSession: (user: CurrentUser) => void;
  /** Update the current actor profile projection after identity reconciliation. */
  updateProfile: (profile: Partial<Pick<CurrentUser, 'name' | 'email' | 'avatarUrl'>>) => void;
  /** Update the remote avatar URL after upload or profile sync. */
  updateAvatar: (avatarUrl: string) => void;
}

// ── Helpers (exported for tests; mapping mirrors `restoreSession`) ──

async function completeStationBindingOrRollback(): Promise<void> {
  try {
    await api.stationBindingComplete();
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

  reset: () => set((state) => ({
    ...initialState,
    sessionEpoch: state.sessionEpoch + 1,
  })),

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
    await completeStationBindingOrRollback();
    completeAccessSubmission(key);
    get().activateAuthenticatedSession(resp);
    await runIdentityPipeline({
      reason: 'login',
      actorPtid: resp.actor_ptid ?? null,
      loginMethod: 'password',
    });
  },

  accessCancel: async (attemptId) => {
    try {
      await api.accessCancel(attemptId);
    } catch (error) {
      throw stationAccessError(error);
    }
  },

  loginWithOAuth: async (_providerId: string) => {
    markLocalIdentityAction();
    const resp = await api.ensureStationSession();
    await completeStationBindingOrRollback();
    get().activateAuthenticatedSession(resp);
    const method = (resp.login_method as string) || 'oauth';
    await runIdentityPipeline({
      reason: 'oauth_bridge',
      actorPtid: resp.actor_ptid ?? null,
      loginMethod: method,
    });
  },

  restoreSession: async () => {
    set({ restoring: true });
    try {
      const resp = await api.authRestoreSession();
      await completeStationBindingOrRollback();
      const method = resp.login_method || 'password';
      const isOAuth = method !== 'password';
      const user = userFromAuthResponse(resp, isOAuth ? 'oauth' : 'password', isOAuth ? method : undefined);
      if (user?.avatarUrl) primeResolvedLocal(user.avatarUrl, user.avatarLocalPath);
      set((state) => ({
        currentUser: user,
        authenticated: Boolean(user),
        restoring: false,
        sessionEpoch: state.sessionEpoch + 1,
      }));
    } catch (error) {
      if (error instanceof AuthCommandException && error.code === 'UNAUTHORIZED') {
        if (error.details?.reason === 'oauth_acknowledgement_pending') {
          set({ restoring: false });
          throw error;
        }
        set((state) => ({
          currentUser: null,
          authenticated: false,
          restoring: false,
          sessionEpoch: state.sessionEpoch + 1,
        }));
        return;
      }
      set({ restoring: false });
      throw error;
    }
  },

  logout: async () => {
    markLocalIdentityAction();
    let cleanupError: unknown;
    try {
      await api.authLogout();
    } catch (error) {
      cleanupError = error;
    }
    await runIdentityPipeline({
      reason: 'logout',
      actorPtid: null,
      loginMethod: null,
    });
    if (cleanupError) {
      throw cleanupError;
    }
  },

  activateAuthenticatedSession: (response) => {
    const method = response.login_method || 'password';
    const isOAuth = method !== 'password';
    const user = userFromAuthResponse(
      response,
      isOAuth ? 'oauth' : 'password',
      isOAuth ? method : undefined,
    );
    if (user?.avatarUrl) primeResolvedLocal(user.avatarUrl, user.avatarLocalPath);
    set((state) => ({
      currentUser: user,
      authenticated: Boolean(user),
      restoring: false,
      sessionEpoch: state.sessionEpoch + 1,
    }));
  },

  activateAppletLaunchSession: (user) => {
    if (user.avatarUrl) primeResolvedLocal(user.avatarUrl, user.avatarLocalPath);
    set((state) => ({
      currentUser: user,
      authenticated: true,
      restoring: false,
      sessionEpoch: state.sessionEpoch + 1,
    }));
  },

  updateProfile: (profile) => {
    set((state) => {
      if (!state.currentUser) return state;
      return {
        currentUser: {
          ...state.currentUser,
          ...profile,
        },
      };
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
