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
}

// ── Helpers ──

function userFromAuthResponse(resp: AuthSessionResponse, fallbackMethod: 'password' | 'oauth'): CurrentUser | null {
  if (!resp.actor_id) return null;
  return {
    actorId: resp.actor_id,
    name: resp.name || '',
    email: resp.email || '',
    avatarUrl: resp.avatar_url || undefined,
    loginMethod: (resp.login_method as 'password' | 'oauth') || fallbackMethod,
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
    // After OAuth loopback completes, the caller should call
    // api.ensureStationSession() which persists the JWT in BFF.
    // We then load the session identity from it.
    const resp = await api.ensureStationSession();
    const user = userFromAuthResponse(resp, 'oauth');
    set({ currentUser: user, authenticated: !!user });
  },

  restoreSession: async () => {
    set({ restoring: true });
    try {
      const resp = await api.authRestoreSession();
      const user = userFromAuthResponse(resp, 'password');
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
    await api.authLogout();
    set({ currentUser: null, authenticated: false });
  },
}));
