import { createDesktopStore } from './createDesktopStore';
import { api, type OAuth2ProviderSummary, type OAuth2Connection } from '../services/desktop_api';
import type { AccessDecision } from '../services/accessGate';
import { EVENT, eventBus } from '../kernel/events';

let loadAllPromise: Promise<void> | null = null;
const LOOPBACK_POLL_INTERVAL_MS = 1000;

const delay = (durationMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, durationMs));

async function waitForAcknowledgement(
  sessionId: string,
  expiresAt: number,
): Promise<void> {
  while (Date.now() < expiresAt) {
    const polled = await api.oauth2PollLoopback(sessionId);
    if (polled.completed) {
      if (polled.status === 'completed') return;
      throw new Error(polled.error || 'oauth authorization failed');
    }
    await delay(LOOPBACK_POLL_INTERVAL_MS);
  }
  const cancellation = await api.oauth2CancelLoopback(sessionId);
  if (cancellation.status === 'completed') return;
  throw new Error('oauth authorization timeout');
}

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
  pendingLoopbackSessionId: string | null;
  pendingLoopbackExpiresAt: number | null;

  loadProviders: () => Promise<void>;
  loadConnections: () => Promise<void>;
  loadAll: () => Promise<void>;
  startAuth: (
    id: string,
    environment?: string,
    purpose?: 'account_login' | 'connector_link',
    options?: OAuth2StartAuthOptions,
  ) => Promise<AccessDecision | null>;
  completeAccountLogin: () => Promise<AccessDecision | null>;
  cancelAccountLogin: () => Promise<'cancelled' | 'completed' | null>;
}

export const useOAuth2Store = createDesktopStore<OAuth2Store>('oauth2', (set, get) => ({
  providers: [],
  connections: [],
  loading: false,
  error: null,
  completedLoopbackSessionId: null,
  pendingLoopbackSessionId: null,
  pendingLoopbackExpiresAt: null,

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

  startAuth: async (id, environment, purpose = 'connector_link', options) => {
    throwIfCancelled(options?.signal);
    set({
      completedLoopbackSessionId: null,
      pendingLoopbackSessionId: null,
      pendingLoopbackExpiresAt: null,
    });
    const {
      auth_url,
      session_id,
      expires_in_ms,
    } = await api.oauth2StartLoopback(id, environment, purpose);
    const expiresAt = Date.now() + expires_in_ms;
    options?.onLoopbackStarted?.({
      authUrl: auth_url,
      sessionId: session_id,
    });
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
    return new Promise<AccessDecision | null>((resolve, reject) => {
      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      let poller: ReturnType<typeof setInterval> | undefined;
      const finish = async (
        error?: Error,
        decision: AccessDecision | null = null,
        cancelNative = false,
      ) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (poller) clearInterval(poller);
        if (cancelNative) {
          try {
            const cancellation = await api.oauth2CancelLoopback(session_id);
            if (cancellation.status === 'completed') {
              set({
                completedLoopbackSessionId: session_id,
                pendingLoopbackSessionId: null,
                pendingLoopbackExpiresAt: null,
              });
              error = undefined;
            }
          } catch (cancellationError) {
            const detail = cancellationError instanceof Error
              ? cancellationError.message
              : String(cancellationError);
            error = new Error(`${error?.message || 'oauth authorization failed'}; ${detail}`);
          }
        }
        options?.signal?.removeEventListener('abort', handleAbort);
        if (purpose === 'connector_link') {
          await get().loadAll();
        }

        if (error) {
          reject(error);
          return;
        }
        resolve(decision);
      };
      const handleAbort = () => {
        void cancelLoopbackSession(session_id).then(
          () => finish(oauthAuthorizationCancelled()),
          error => finish(
            error instanceof Error ? error : oauthAuthorizationCancelled(),
          ),
        );
      };
      poller = setInterval(async () => {
        try {
          const polled = await api.oauth2PollLoopback(session_id);
          if (polled.completed) {
            if (polled.status === 'action_required') {
              if (!polled.access_decision) {
                void finish(new Error('oauth access decision is unavailable'));
                return;
              }
              set({
                pendingLoopbackSessionId: session_id,
                pendingLoopbackExpiresAt: expiresAt,
              });
              void finish(undefined, polled.access_decision);
              return;
            }
            const pollError = polled.status === 'completed' ? undefined : (polled.error || 'oauth authorization failed');
            if (!pollError) {
              set({
                completedLoopbackSessionId: session_id,
                pendingLoopbackSessionId: null,
                pendingLoopbackExpiresAt: null,
              });
            }
            void finish(pollError ? new Error(pollError) : undefined);
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'oauth authorization failed',
          });
        }
      }, LOOPBACK_POLL_INTERVAL_MS);
      timeoutTimer = setTimeout(() => {
        void finish(new Error('oauth authorization timeout'), null, true);
      }, expires_in_ms);
      options?.signal?.addEventListener('abort', handleAbort, { once: true });
      if (options?.signal?.aborted) handleAbort();
    });
  },

  completeAccountLogin: async () => {
    const sessionId = get().pendingLoopbackSessionId;
    if (!sessionId) throw new Error('oauth pending login is unavailable');
    const result = await api.oauth2ResumeLoopback(sessionId);
    if (result.status === 'action_required') {
      if (!result.access_decision) throw new Error('oauth access decision is unavailable');
      return result.access_decision;
    }
    if (result.status === 'acknowledgement_pending') {
      await waitForAcknowledgement(
        sessionId,
        get().pendingLoopbackExpiresAt ?? Date.now(),
      );
    }
    set({
      completedLoopbackSessionId: sessionId,
      pendingLoopbackSessionId: null,
      pendingLoopbackExpiresAt: null,
    });
    return null;
  },

  cancelAccountLogin: async () => {
    const sessionId = get().pendingLoopbackSessionId;
    if (!sessionId) return null;
    const result = await api.oauth2CancelLoopback(sessionId);
    set({
      completedLoopbackSessionId:
        result.status === 'completed' ? sessionId : get().completedLoopbackSessionId,
      pendingLoopbackSessionId: null,
      pendingLoopbackExpiresAt: null,
    });
    return result.status;
  },
}));
