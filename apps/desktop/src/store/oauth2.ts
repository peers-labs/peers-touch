import { create } from 'zustand';
import { api, type OAuth2ProviderSummary, type OAuth2Connection } from '../services/api';

let loadAllPromise: Promise<void> | null = null;

interface OAuth2Store {
  providers: OAuth2ProviderSummary[];
  connections: OAuth2Connection[];
  loading: boolean;

  loadProviders: () => Promise<void>;
  loadConnections: () => Promise<void>;
  loadAll: () => Promise<void>;
  startAuth: (id: string, environment?: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  refreshToken: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

export const useOAuth2Store = create<OAuth2Store>((set, get) => ({
  providers: [],
  connections: [],
  loading: false,

  loadProviders: async () => {
    try {
      const providers = await api.oauth2ListProviders();
      set({ providers: providers || [] });
    } catch {
      set({ providers: [] });
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
