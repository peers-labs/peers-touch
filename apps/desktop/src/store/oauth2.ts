import { createDesktopStore } from './createDesktopStore';
import { api, type OAuth2ProviderSummary, type OAuth2Connection } from '../services/desktop_api';
import { EVENT, eventBus } from '../kernel/events';

let loadAllPromise: Promise<void> | null = null;

export interface OAuth2StartAuthOptions {
  signal?: AbortSignal;
  onBrowserOpened?: () => void;
  onLoopbackStarted?: (start: { authUrl: string; sessionId: string }) => void;
  openAuthorizationUrl?: (authUrl: string) => Promise<void>;
}

export function isOAuthAuthorizationCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function oauthAuthorizationCancelled(): Error {
  const error = new Error('oauth authorization cancelled');
  error.name = 'AbortError';
  return error;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw oauthAuthorizationCancelled();
}

async function cancelLoopbackSession(sessionId: string): Promise<void> {
  await api.oauth2CancelLoopback(sessionId);
}

interface OAuth2Store {
  providers: OAuth2ProviderSummary[];
  connections: OAuth2Connection[];
  loading: boolean;
  error: string | null;
  completedLoopbackSessionId: string | null;

  loadProviders: () => Promise<void>;
  loadConnections: () => Promise<void>;
  loadAll: () => Promise<void>;
  startAuth: (
    id: string,
    environment?: string,
    options?: OAuth2StartAuthOptions,
  ) => Promise<void>;
}

export const useOAuth2Store = createDesktopStore<OAuth2Store>('oauth2', (set, get) => ({
  providers: [],
  connections: [],
  loading: false,
  error: null,
  completedLoopbackSessionId: null,

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

  startAuth: async (id, environment, options) => {
    throwIfCancelled(options?.signal);
    set({ completedLoopbackSessionId: null });
    const { auth_url, session_id } = await api.oauth2StartLoopback(id, environment);
    options?.onLoopbackStarted?.({ authUrl: auth_url, sessionId: session_id });
    if (options?.signal?.aborted) {
      await cancelLoopbackSession(session_id);
      throw oauthAuthorizationCancelled();
    }
    try {
      await (options?.openAuthorizationUrl ?? api.openExternalUrl)(auth_url);
    } catch (error) {
      await cancelLoopbackSession(session_id);
      throwIfCancelled(options?.signal);
      throw error;
    }
    if (options?.signal?.aborted) {
      await cancelLoopbackSession(session_id);
      throw oauthAuthorizationCancelled();
    }
    options?.onBrowserOpened?.();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timers: {
        timeout?: ReturnType<typeof setTimeout>;
        poller?: ReturnType<typeof setInterval>;
      } = {};
      const handleAbort = () => {
        void cancelLoopbackSession(session_id).then(
          () => finish(oauthAuthorizationCancelled()),
          error => finish(
            error instanceof Error ? error : oauthAuthorizationCancelled(),
          ),
        );
      };
      const finish = async (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timers.timeout) clearTimeout(timers.timeout);
        if (timers.poller) clearInterval(timers.poller);
        options?.signal?.removeEventListener('abort', handleAbort);
        if (!isOAuthAuthorizationCancelled(error)) {
          await get().loadAll();
        }

        if (error) {
          reject(error);
          return;
        }
        resolve();
      };
      timers.poller = setInterval(async () => {
        try {
          const polled = await api.oauth2PollLoopback(session_id);
          if (polled.completed) {
            const errorMessage = polled.status === 'completed' ? undefined : (polled.error || 'oauth authorization failed');
            if (!errorMessage) {
              set({ completedLoopbackSessionId: session_id });
            }
            void finish(errorMessage ? new Error(errorMessage) : undefined);
          }
        } catch {
          // Transient poll failures are retried until completion or timeout.
        }
      }, 1000);
      timers.timeout = setTimeout(() => {
        const timeoutError = new Error('oauth authorization timeout');
        void cancelLoopbackSession(session_id).then(
          () => finish(timeoutError),
          error => finish(error instanceof Error ? error : timeoutError),
        );
      }, 120000);
      options?.signal?.addEventListener('abort', handleAbort, { once: true });
      if (options?.signal?.aborted) handleAbort();
    });
  },
}));
