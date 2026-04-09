import { create } from 'zustand';
import { AuthCommandException, api, type OAuth2ProviderSummary, type OAuth2Connection } from '../services/desktop_api';
import { EVENT, eventBus } from '../kernel/events';

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
      const prevConnections = get().connections;
      const prevProviders = get().providers;
      set({ loading: true });
      try {
        await Promise.all([get().loadProviders(), get().loadConnections()]);
        set({ loading: false });
        const next = get();
        const connectionsChanged =
          prevConnections.length !== next.connections.length
          || prevConnections.some((c, i) => c.provider_id !== next.connections[i]?.provider_id || c.status !== next.connections[i]?.status);
        const providersChanged = prevProviders.length !== next.providers.length;
        if (connectionsChanged || providersChanged) {
          eventBus.publish(EVENT.OAUTH_CONNECTIONS_CHANGED, undefined);
        }
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
      // Primary restore failed — try loading Station session persisted
      // by the oauth-bridge flow (covers the case where a user logged
      // in via OAuth but the generic session file was not yet written).
      try {
        const result = await api.ensureStationSession();
        if (result.ok) {
          set({ authenticated: true, authErrorCode: null });
          return;
        }
      } catch {
        // Station session also unavailable — fall through to original error handling.
      }

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
    const { auth_url, session_id } = await api.oauth2StartLoopback(id, environment);
    await api.openExternalUrl(auth_url);
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let poller: ReturnType<typeof setInterval> | undefined;
      const finish = async (errorMessage?: string) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (poller) clearInterval(poller);
        await get().loadAll();

        // After a successful OAuth loopback, the backend persists a Station JWT
        // via the oauth-bridge API call. Load it into BFF session state so the
        // app is immediately authenticated without requiring a restart.
        if (!errorMessage) {
          try {
            await api.ensureStationSession();
            set({ authenticated: true, authErrorCode: null });
          } catch (err: any) {
            console.warn('[oauth2] ensureStationSession failed (non-fatal):', err?.message);
          }
        }

        if (errorMessage) {
          reject(new Error(errorMessage));
          return;
        }
        resolve();
      };
      poller = setInterval(async () => {
        try {
          const polled = await api.oauth2PollLoopback(session_id);
          if (polled.completed) {
            const errorMessage = polled.status === 'completed' ? undefined : (polled.error || 'oauth authorization failed');
            void finish(errorMessage);
          }
        } catch {}
      }, 1000);
      timeoutTimer = setTimeout(() => {
        void finish('oauth authorization timeout');
      }, 120000);
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
