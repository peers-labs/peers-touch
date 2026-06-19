import { create } from 'zustand';
import { api, type OAuth2ProviderSummary, type OAuth2Connection } from '../services/desktop_api';
import { EVENT, eventBus } from '../kernel/events';

let loadAllPromise: Promise<void> | null = null;

interface OAuth2Store {
  providers: OAuth2ProviderSummary[];
  connections: OAuth2Connection[];
  loading: boolean;
  error: string | null;

  loadProviders: () => Promise<void>;
  loadConnections: () => Promise<void>;
  loadAll: () => Promise<void>;
  startAuth: (id: string, environment?: string) => Promise<void>;
}

export const useOAuth2Store = create<OAuth2Store>((set, get) => ({
  providers: [],
  connections: [],
  loading: false,
  error: null,

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
}));
