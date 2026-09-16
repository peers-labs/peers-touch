import type { MobileAuthSession } from '../auth/authSession';
import {
  socialHostEventTargetsNotifications,
  type SocialHostEvent,
  type SocialHostEventKind,
} from '@peers-touch/client-chat-core';
import type { GroupState } from '../group/groupStore';
import {
  MOBILE_MESSAGING_RUNTIME_ERROR_EVENT,
  wakeActiveMessagingSession,
} from '../../runtimes/messagingRuntime';
import type { SocialState } from './socialStore';
import { useSocialStore } from './socialStore';
import { startRealtimeStream } from './socialRealtime';
import {
  readableErrorMessage,
  type ActorSearchResult,
} from './socialTypes';
import type { GroupMembershipKind } from './socialWire';

const RECONCILE_INTERVAL_MS = 30000;
const TYPING_TTL_MS = 6000;
const TYPING_SWEEP_INTERVAL_MS = 2000;
const EXTERNAL_RECONCILE_DEBOUNCE_MS = 1000;
const REALTIME_RECONNECT_BASE_MS = 1000;
const REALTIME_RECONNECT_MAX_MS = 15000;
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30000;

export interface SocialRuntimeController {
  teardown: () => void;
  drain: () => Promise<void>;
}

export type SocialRuntimeExternalEventKind = SocialHostEventKind;
export type SocialRuntimeExternalEvent = SocialHostEvent;

interface ActiveSocialRuntime {
  sessionKey: string | null;
  dispatchExternalEvent: (event: SocialRuntimeExternalEvent) => void;
}

let activeRuntime: ActiveSocialRuntime | null = null;

export function dispatchSocialRuntimeExternalEvent(event: SocialRuntimeExternalEvent) {
  activeRuntime?.dispatchExternalEvent(event);
}

export interface SocialRuntimePublicProjection {
  active: boolean;
  activeSessionUlid: string | null;
  friendRequests: Array<{
    requestId: string;
    federationId: string;
    senderPtid: string;
    receiverPtid: string;
    senderHomeStationPeerId: string;
    receiverHomeStationPeerId: string;
    status: number;
  }>;
  typingPeers: Record<string, Record<string, {
    typing: boolean;
    lastUpdate: number;
  }>>;
  peerOnline: Record<string, boolean>;
  lastReconcileAt: number | null;
}

export function readSocialRuntimeProjection(): SocialRuntimePublicProjection {
  const state = useSocialStore.getState();
  return {
    active: activeRuntime !== null,
    activeSessionUlid: state.activeSessionUlid,
    friendRequests: state.friendRequests.map((request) => ({
      requestId: request.requestId || request.id || '',
      federationId: request.federationId,
      senderPtid: request.senderPtid,
      receiverPtid: request.receiverPtid,
      senderHomeStationPeerId: request.senderHomeStationPeerId,
      receiverHomeStationPeerId: request.receiverHomeStationPeerId,
      status: request.status,
    })),
    typingPeers: Object.fromEntries(
      Object.entries(state.typingPeers).map(([conversationId, peers]) => [
        conversationId,
        Object.fromEntries(
          Object.entries(peers).map(([ptid, entry]) => [
            ptid,
            {
              typing: entry.typing,
              lastUpdate: entry.lastUpdate,
            },
          ]),
        ),
      ]),
    ),
    peerOnline: { ...state.peerOnline },
    lastReconcileAt: state.lastReconcileAt,
  };
}

export async function sendSocialFriendRequest(
  receiverPtid: string,
  receiverHomeStationPeerId: string,
  federationId: string,
  message?: string,
): Promise<SocialRuntimePublicProjection> {
  requireActiveSocialRuntime();
  await useSocialStore.getState().sendFriendRequest(
    receiverPtid,
    receiverHomeStationPeerId,
    federationId,
    message,
  );
  return readSocialRuntimeProjection();
}

export async function acceptSocialFriendRequest(
  requestId: string,
): Promise<SocialRuntimePublicProjection> {
  requireActiveSocialRuntime();
  await useSocialStore.getState().acceptFriendRequest(requestId);
  return readSocialRuntimeProjection();
}

export async function reconcileSocialRuntime(): Promise<SocialRuntimePublicProjection> {
  requireActiveSocialRuntime();
  await useSocialStore.getState().reconcile();
  return readSocialRuntimeProjection();
}

export async function searchSocialPeople(query: string): Promise<ActorSearchResult[]> {
  requireActiveSocialRuntime();
  await useSocialStore.getState().searchPeople(query);
  const state = useSocialStore.getState();
  if (state.peopleSearchError) throw state.peopleSearchError;
  return [...state.peopleSearchResults];
}

function requireActiveSocialRuntime(): void {
  if (!activeRuntime) throw new Error('mobile.social.runtimeUnavailable');
}

export function startSocialRuntime(
  session: MobileAuthSession,
  store: SocialState,
  groupStore?: GroupState,
): SocialRuntimeController {
  let cancelled = false;
  let externalReconcileTimer: number | null = null;
  const abortController = new AbortController();
  const pendingOperations = new Set<Promise<unknown>>();
  const track = <T,>(operation: () => Promise<T>): Promise<T> => {
    const pending = operation().finally(() => {
      pendingOperations.delete(pending);
    });
    pendingOperations.add(pending);
    return pending;
  };

  void track(() => store.reconcile());
  const reconcileTimer = window.setInterval(() => {
    if (!cancelled) void track(() => store.reconcile());
  }, RECONCILE_INTERVAL_MS);
  const typingSweepTimer = window.setInterval(() => {
    store.sweepTypingPeers(Date.now() - TYPING_TTL_MS);
  }, TYPING_SWEEP_INTERVAL_MS);

  void postPresence(session, '/presence/heartbeat', 'runtime_start');
  const presenceHeartbeatTimer = window.setInterval(() => {
    if (!cancelled) void postPresence(session, '/presence/heartbeat', 'heartbeat');
  }, PRESENCE_HEARTBEAT_INTERVAL_MS);
  const realtimeHandlers: Parameters<typeof startRealtimeStream>[2] = {
    onMessage: wakeMessaging,
    onGroupMessage: wakeMessaging,
    onReceipt: wakeMessaging,
    onMutation: wakeMessaging,
    onTyping: (...args) => {
      if (!cancelled) {
        store.applyTypingState(...args);
        // #region debug-point L:typing-projection-applied
        const [conversationId, fromActorPtid, typing] = args;
        const typingPeers = useSocialStore.getState().typingPeers;
        const projection = typingPeers[conversationId]?.[fromActorPtid];
        void fetch('http://10.4.44.83:7784/event', { method: 'POST', body: JSON.stringify({ sessionId: 'mobile-social-activation', runId: 'typing-pre-fix', hypothesisId: 'L', location: 'apps/mobile/src/features/social/socialRuntime.ts:onTyping', msg: '[DEBUG] Mobile typing projection applied', data: { conversationId, fromActorPtid, typing, storedTyping: projection?.typing ?? null, conversationKeys: Object.keys(typingPeers).sort() }, ts: Date.now() }) }).catch(() => {});
        // #endregion
      }
    },
    onPresence: (...args) => {
      if (!cancelled) store.setPeerOnline(...args);
    },
    onGroupMembership: (groupUlid, actorPtid, kind) => {
      if (!cancelled) {
        void track(
          () => routeGroupMembershipChange(
            groupStore,
            groupUlid,
            actorPtid,
            kind,
          ),
        );
      }
    },
    onSettingsChanged: (conversationKind, containerUlid) => {
      if (cancelled) return;
      if (conversationKind === 'friend') {
        void track(() => store.loadConversationSettings(containerUlid));
      } else {
        void track(
          () => groupStore?.loadSettings(containerUlid) ?? Promise.resolve(),
        );
      }
    },
    onResync: () => {
      if (cancelled) return;
      wakeMessaging();
      void track(() => store.reconcile());
      void track(() => groupStore?.reconcile() ?? Promise.resolve());
    },
  };
  void track(
    () => superviseRealtimeStream(
      session,
      abortController.signal,
      store,
      groupStore,
      realtimeHandlers,
    ),
  );

  const runtimeRef: ActiveSocialRuntime = {
    sessionKey: store.sessionKey,
    dispatchExternalEvent: (event) => {
      if (cancelled) return;

      if (event.sessionUlid) {
        void track(() => store.loadMessages(event.sessionUlid!));
      }
      if (socialHostEventTargetsNotifications(event)) {
        void track(() => store.refreshNotifications());
      }
      void track(() => reconcileActiveThreads(store, groupStore));

      if (externalReconcileTimer) return;
      externalReconcileTimer = window.setTimeout(() => {
        externalReconcileTimer = null;
        if (!cancelled) void track(() => store.reconcile());
      }, EXTERNAL_RECONCILE_DEBOUNCE_MS);
    },
  };
  activeRuntime = runtimeRef;

  return {
    teardown: () => {
      cancelled = true;
      window.clearInterval(reconcileTimer);
      window.clearInterval(typingSweepTimer);
      window.clearInterval(presenceHeartbeatTimer);
      if (externalReconcileTimer) window.clearTimeout(externalReconcileTimer);
      void postPresence(session, '/presence/offline', 'runtime_teardown');
      abortController.abort();
      if (activeRuntime === runtimeRef) activeRuntime = null;
    },
    drain: async () => {
      await Promise.allSettled([...pendingOperations]);
    },
  };
}

async function postPresence(session: MobileAuthSession, path: string, reason: string) {
  try {
    await fetch(`${session.stationUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });
  } catch {
    // Presence is lease-based; the next heartbeat or server-side TTL heals failures.
  }
}

async function superviseRealtimeStream(
  session: MobileAuthSession,
  signal: AbortSignal,
  store: SocialState,
  groupStore: GroupState | undefined,
  handlers: Parameters<typeof startRealtimeStream>[2],
) {
  let reconnectDelay = REALTIME_RECONNECT_BASE_MS;
  while (!signal.aborted) {
    try {
      await startRealtimeStream(session, signal, handlers);
      reconnectDelay = REALTIME_RECONNECT_BASE_MS;
    } catch (error) {
      if (signal.aborted) return;
      // #region debug-point K:realtime-stream-failed
      void fetch('http://10.4.44.83:7784/event', { method: 'POST', body: JSON.stringify({ sessionId: 'mobile-social-activation', runId: 'typing-pre-fix', hypothesisId: 'K', location: 'apps/mobile/src/features/social/socialRuntime.ts:superviseRealtimeStream', msg: '[DEBUG] Mobile realtime stream failed', data: { message: readableErrorMessage(error), reconnectDelay }, ts: Date.now() }) }).catch(() => {});
      // #endregion
    }

    if (signal.aborted) return;
    await reconcileActiveThreads(store, groupStore);
    await delay(reconnectDelay, signal);
    reconnectDelay = Math.min(reconnectDelay * 2, REALTIME_RECONNECT_MAX_MS);
  }
}

async function reconcileActiveThreads(
  store: SocialState,
  groupStore: GroupState | undefined,
) {
  await Promise.allSettled([
    store.reconcileActiveSessionMessages(),
    groupStore?.reconcileActiveGroupMessages(),
  ]);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function routeGroupMembershipChange(
  groupStore: GroupState | undefined,
  groupUlid: string,
  _actorPtid: string,
  kind: GroupMembershipKind,
) {
  try {
    await groupStore?.refreshGroups();
    if (kind === 'DISSOLVED' && groupStore?.activeGroupUlid === groupUlid) {
      await groupStore.selectGroup(null);
    }
    if (kind !== 'DISSOLVED' && groupStore?.activeGroupUlid === groupUlid) await groupStore.loadMembers(groupUlid);
  } catch {
    // Group store persists its domain error.
  }
}

function wakeMessaging(): void {
  void wakeActiveMessagingSession().catch((error) => {
    window.dispatchEvent(new CustomEvent(MOBILE_MESSAGING_RUNTIME_ERROR_EVENT, {
      detail: {
        operation: 'social-realtime-wake',
        message: readableErrorMessage(error),
      },
    }));
  });
}
