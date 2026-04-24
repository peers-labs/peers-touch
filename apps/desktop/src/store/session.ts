import { create } from 'zustand';
import { api, AuthCommandException, type AuthSessionResponse } from '../services/desktop_api';

// ── Types ──

export interface CurrentUser {
  actorId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  loginMethod: 'password' | 'oauth';
  loginProvider?: string;
}

interface SessionStore {
  currentUser: CurrentUser | null;
  authenticated: boolean;
  restoring: boolean;

  loginWithPassword: (account: string, password: string) => Promise<void>;
  loginWithOAuth: (providerId: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  logout: () => Promise<void>;
  /** Update avatar URL on the current user (called after upload or profile sync). */
  updateAvatar: (avatarUrl: string) => void;
}

// ── Helpers ──

function userFromAuthResponse(resp: AuthSessionResponse, fallbackMethod: 'password' | 'oauth', provider?: string): CurrentUser | null {
  if (!resp.actor_id) return null;
  return {
    actorId: resp.actor_id,
    name: resp.name || '',
    email: resp.email || '',
    avatarUrl: resp.avatar_url || undefined,
    avatarLocalPath: resp.avatar_local_path || undefined,
    loginMethod: (resp.login_method as 'password' | 'oauth') || fallbackMethod,
    loginProvider: provider,
  };
}

// ── Store ──

export const useSessionStore = create<SessionStore>((set) => ({
  currentUser: null,
  authenticated: false,
  restoring: false,

  loginWithPassword: async (account, password) => {
    const resp = await api.authLogin({ account, password });
    const user = userFromAuthResponse(resp, 'password');
    set({ currentUser: user, authenticated: true });
  },

  loginWithOAuth: async (_providerId: string) => {
    const resp = await api.ensureStationSession();
    const user = userFromAuthResponse(resp, 'oauth', _providerId);
    set({ currentUser: user, authenticated: !!user });
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
    try {
      await api.authLogout();
    } catch {
      // Best-effort: if the session is already expired/revoked, still clear local state.
    }
    set({ currentUser: null, authenticated: false });
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
