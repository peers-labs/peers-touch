import { create } from 'zustand';
import { AuthCommandException, api, type OAuth2ProviderSummary, type OAuth2Connection } from '../services/desktop_api';

let loadAllPromise: Promise<void> | null = null;
const AUTH_TOKEN_STORAGE_KEY = 'pt.desktop.auth.token';

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
      return;
    }
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {}
}

interface OAuth2Store {
  providers: OAuth2ProviderSummary[];
  connections: OAuth2Connection[];
  loading: boolean;
  error: string | null;
  authenticated: boolean;
  authErrorCode: string | null;

  loadProviders: () => Promise<void>;
  loadConnections: () => Promise<void>;
  loadAll: () => Promise<void>;
  loginWithPassword: (account: string, password: string, baseUrl?: string) => Promise<void>;
  restoreSession: () => Promise<void>;
  validateSessionToken: (token?: string) => Promise<void>;
  logoutSession: () => Promise<void>;
  startAuth: (id: string, environment?: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  refreshToken: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

export const useOAuth2Store = create<OAuth2Store>((set, get) => ({
  providers: [],
  connections: [],
  loading: false,
  error: null,
  authenticated: false,
  authErrorCode: null,

  loadProviders: async () => {
    try {
      const providers = await api.oauth2ListProviders();
      set({ providers: providers || [], error: null });
    } catch (err: any) {
      set({ providers: [], error: err?.message || 'failed to load oauth providers' });
    }
  },

  loadConnections: async () => {
    try {
      const connections = await api.oauth2ListConnections();
      set({ connections: connections || [] });
    } catch {
      set({ connections: [] });
    }
  },

  loadAll: async () => {
    if (loadAllPromise) return loadAllPromise;
    loadAllPromise = (async () => {
      set({ loading: true });
      try {
        await Promise.all([get().loadProviders(), get().loadConnections()]);
        set({ loading: false });
        window.dispatchEvent(new Event('oauth2-connections-changed'));
      } finally {
        loadAllPromise = null;
      }
    })();
    return loadAllPromise;
  },

  loginWithPassword: async (account, password, baseUrl) => {
    await api.authLogin({ account, password, base_url: baseUrl });
    writeStoredToken(null);
    set({ authenticated: true, authErrorCode: null });
  },

  restoreSession: async () => {
    const token = readStoredToken();
    try {
      if (token) {
        await api.authValidateToken({ token });
      } else {
        await api.authRestoreSession();
      }
      set({ authenticated: true, authErrorCode: null });
      return;
    } catch (error) {
      if (error instanceof AuthCommandException && error.code === 'UNAUTHORIZED') {
        writeStoredToken(null);
        set({ authenticated: false, authErrorCode: error.code });
        return;
      }
      throw error;
    }
  },

  validateSessionToken: async (token) => {
    try {
      await api.authValidateToken({ token });
      if (token) {
        writeStoredToken(token);
      }
      set({ authenticated: true, authErrorCode: null });
      return;
    } catch (error) {
      if (error instanceof AuthCommandException && error.code === 'UNAUTHORIZED') {
        writeStoredToken(null);
        set({ authenticated: false, authErrorCode: error.code });
        return;
      }
      throw error;
    }
  },

  logoutSession: async () => {
    await api.authLogout();
    writeStoredToken(null);
    set({ authenticated: false, authErrorCode: null });
  },

  startAuth: async (id, environment) => {
    const { auth_url } = await api.oauth2Authorize(id, environment);
    const w = window.open(auth_url, '_blank', 'width=600,height=700');
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (!w || w.closed) {
          clearInterval(interval);
          get().loadAll().then(resolve);
        }
      }, 1000);
    });
  },

  disconnect: async (id) => {
    await api.oauth2Disconnect(id);
    await get().loadAll();
  },

  refreshToken: async (id) => {
    await api.oauth2RefreshToken(id);
    await get().loadAll();
  },

  reload: async () => {
    await api.oauth2Reload();
    await get().loadAll();
  },
}));
