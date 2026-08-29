import { createDesktopStore } from './createDesktopStore';
import { api, AuthCommandException, type AuthSessionResponse } from '../services/desktop_api';
import { markLocalIdentityAction } from '../services/identity_event';
import { runIdentityPipeline } from '../services/identityPipeline';
import { normalizeDecision, type AccessDecision } from '../services/accessGate';

// ── Types ──

// TODO(unified-actor): align with AccountIdentity (desktop_api) for cross-layer consistency.
export interface CurrentUser {
  actorId: string;
  ptid?: string;
  name: string;
  email: string;
  /** Remote avatar URL. The single piece of avatar state the frontend tracks;
   *  local file caching is owned by the UserSquareAvatar component / Rust
   *  avatar_cache infrastructure. */
  avatarUrl?: string;
  loginMethod: string;
  loginProvider?: string;
}

const initialState = {
  currentUser: null as CurrentUser | null,
  authenticated: false,
  restoring: false,
};

interface SessionStore {
  currentUser: CurrentUser | null;
  authenticated: boolean;
  restoring: boolean;

  reset: () => void;
  hydrate: (actorId: string) => Promise<void>;

  loginWithPassword: (account: string, password: string) => Promise<void>;
  loginWithOAuth: (providerId: string) => Promise<void>;
  /** Open an interactive access attempt and return the Station's first decision. */
  accessStart: () => Promise<AccessDecision>;
  /** Redeem an invite code against a live attempt; returns the re-evaluated decision. */
  accessSubmitInviteCode: (attemptId: string, code: string) => Promise<AccessDecision>;
  /** Submit the login gate for a live attempt; on grant lands the session. */
  accessSubmitLogin: (attemptId: string, account: string, password: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  logout: () => Promise<void>;
  activateAppletLaunchSession: (user: CurrentUser) => void;
  /** Update the current actor profile projection after identity reconciliation. */
  updateProfile: (profile: Partial<Pick<CurrentUser, 'name' | 'email' | 'avatarUrl'>>) => void;
  /** Update the remote avatar URL after upload or profile sync. */
  updateAvatar: (avatarUrl: string) => void;
}

// ── Helpers (exported for tests; mapping mirrors `restoreSession`) ──

function userFromAuthResponse(resp: AuthSessionResponse, fallbackMethod: 'password' | 'oauth', provider?: string): CurrentUser | null {
  if (!resp.actor_id) return null;
  return {
    actorId: resp.actor_id,
    ptid: resp.ptid || resp.actor_id,
    name: resp.name || '',
    email: resp.email || '',
    avatarUrl: resp.avatar_url || undefined,
    loginMethod: (resp.login_method as 'password' | 'oauth') || fallbackMethod,
    loginProvider: provider,
  };
}

// ── Store ──

export const useSessionStore = createDesktopStore<SessionStore>('session', (set, get) => ({
  ...initialState,

  reset: () => set({ ...initialState }),

  hydrate: async () => {
    await get().restoreSession();
  },

  loginWithPassword: async (account, password) => {
    markLocalIdentityAction();
    const resp = await api.authLogin({ account, password });
    await runIdentityPipeline({
      reason: 'login',
      actorId: resp.actor_id ?? null,
      loginMethod: 'password',
    });
  },

  accessStart: async () => {
    const resp = await api.accessStart();
    return normalizeDecision(resp.decision);
  },

  accessSubmitInviteCode: async (attemptId, code) => {
    const resp = await api.accessSubmitInviteCode({ attempt_id: attemptId, invite_code: code });
    return normalizeDecision(resp.decision);
  },

  accessSubmitLogin: async (attemptId, account, password) => {
    markLocalIdentityAction();
    const resp = await api.accessSubmitLogin({ attempt_id: attemptId, account, password });
    await runIdentityPipeline({
      reason: 'login',
      actorId: resp.actor_id ?? null,
      loginMethod: 'password',
    });
  },

  loginWithOAuth: async (_providerId: string) => {
    markLocalIdentityAction();
    const resp = await api.ensureStationSession();
    const method = (resp.login_method as string) || 'oauth';
    await runIdentityPipeline({
      reason: 'oauth_bridge',
      actorId: resp.actor_id ?? null,
      loginMethod: method,
    });
  },

  restoreSession: async () => {
    set({ restoring: true });
    try {
      const resp = await api.authRestoreSession();
      const method = resp.login_method || 'password';
      const isOAuth = method !== 'password';
      const user = userFromAuthResponse(resp, isOAuth ? 'oauth' : 'password', isOAuth ? method : undefined);
      set({ currentUser: user, authenticated: !!user, restoring: false });
    } catch (error) {
      if (error instanceof AuthCommandException && error.code === 'UNAUTHORIZED') {
        set({ currentUser: null, authenticated: false, restoring: false });
        return;
      }
      set({ restoring: false });
      throw error;
    }
  },

  logout: async () => {
    markLocalIdentityAction();
    await runIdentityPipeline({
      reason: 'logout',
      actorId: null,
      loginMethod: null,
    });
    try {
      await api.realtimeStreamStop();
    } catch {
      // noop
    }
    try {
      await api.authLogout();
    } catch {
      // Best-effort: if the session is already expired/revoked, still clear local state.
    }
  },

  activateAppletLaunchSession: (user) => {
    set({ currentUser: user, authenticated: true, restoring: false });
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

export function currentAuthenticatedActorId(): string | null {
  const session = useSessionStore.getState();
  if (!session.authenticated) return null;
  return session.currentUser?.ptid || session.currentUser?.actorId || null;
}
