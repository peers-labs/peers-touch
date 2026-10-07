import {
  socialHostEventReconcileReason,
  socialHostEventTargetsNotifications,
  type SocialHostEvent,
} from '@peers-touch/client-chat-core';

import { EVENT, eventBus } from '../kernel/events';
import type {
  RealtimeConnectionStatePayload,
  RealtimePresenceFlipPayload,
  RealtimeSocialGraphEventPayload,
  RelationshipChangedPayload,
} from '../kernel/events/types';
import { installEventStreamBridge, startEventStream, stopEventStream } from './eventStream';
import { api, type NotificationData } from './desktop_api';
import { NotificationType } from '../gen/proto/domain/notification/notification_pb';
import { useNotificationStore } from '../store/notification';
import { useRelationshipsStore } from '../store/relationships';
import { currentAuthenticatedActorPtid, useSessionStore } from '../store/session';
import { useFederationStore } from '../store/federation';
import { projectChatFriendRequestPeers } from '../store/friendshipProjection';
import { useSocialChatStore } from '../store/socialChat';
import { log } from '../utils/logger';

const SOCIAL_RECONCILE_INTERVAL_MS = 30_000;
const EXTERNAL_HOST_RECONCILE_DEBOUNCE_MS = 1_000;
const MAX_SEEN_SOCIAL_NOTIFICATIONS = 500;

let teardownBridge: (() => void) | null = null;
let socialReconcileTimer: number | null = null;
let externalHostReconcileTimer: number | null = null;
let bootstrappedActorPtid: string | null = null;
let bootstrapSequence = 0;
let realtimeStreamScopeKey: string | null = null;
let realtimeStreamTransition: Promise<void> = Promise.resolve();
let socialRefreshInFlight: Promise<void> | null = null;
let presenceRevision = 0;
const seenSocialNotificationIds = new Set<string>();

function runDetached(label: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    log.warn('socialRealtime', `${label} failed`, error);
  });
}

function rememberBounded(set: Set<string>, key: string, maxSize: number): boolean {
  if (!key) return true;
  if (set.has(key)) return false;
  set.add(key);
  if (set.size > maxSize) {
    const first = set.values().next().value;
    if (first) set.delete(first);
  }
  return true;
}

async function refreshFriendshipProjection(refresh = true): Promise<void> {
  const actorPtid = currentAuthenticatedActorPtid();
  if (!actorPtid) return;
  await useRelationshipsStore.getState().loadMutualFriends(actorPtid, refresh);
}

async function refreshFriendStationIdentities(): Promise<void> {
  const chat = useSocialChatStore.getState();
  const currentUserPtid = chat.currentUserPtid
    || currentAuthenticatedActorPtid()
    || '';
  const requestCandidates = projectChatFriendRequestPeers(
    chat.friendRequests,
    currentUserPtid,
  ).map(({ peerPtid, request }) => ({
    actorPtid: peerPtid,
    federationId: request.federationId,
    username: chat.peerProfiles[peerPtid]?.username?.trim() || '',
  }));
  const conversationCandidates = chat.conversations
    .filter((conversation) => conversation.kind === 1)
    .flatMap((conversation) => {
      const peer = chat.conversationMembers[conversation.conversationId]
        ?.find((member) => member.ptid && member.ptid !== currentUserPtid);
      if (!peer?.ptid) return [];
      return [{
        actorPtid: peer.ptid,
        federationId: conversation.federationId,
        username: chat.peerProfiles[peer.ptid]?.username?.trim() || '',
      }];
    });
  await useFederationStore.getState().resolveActorStations([
    ...requestCandidates,
    ...conversationCandidates,
  ]);
}

function collectKnownPresencePeerPtids(): string[] {
  const chat = useSocialChatStore.getState();
  const relationships = useRelationshipsStore.getState();
  return Array.from(new Set(
    [
      ...Object.values(chat.conversationMembers)
        .flat()
        .map((member) => member.ptid),
      ...relationships.mutualFriends.map((friend) => friend.actorPtid),
    ]
      .filter((ptid) => (
        ptid.startsWith('ptid:')
        && ptid !== chat.currentUserPtid
      )),
  ));
}

export async function refreshPeerPresence(peerPtids: readonly string[]): Promise<void> {
  const requested = Array.from(new Set(peerPtids.filter(Boolean)));
  if (requested.length === 0) return;
  const revision = ++presenceRevision;
  const store = useSocialChatStore.getState();
  try {
    const statuses = await api.presenceQuery(requested);
    const byActor = new Map(statuses.map((status) => [status.actorPtid, status.online]));
    for (const actorPtid of requested) {
      const online = byActor.get(actorPtid);
      if (online == null) {
        store.clearPeerPresence([actorPtid], revision);
      } else {
        store.setPeerOnline(actorPtid, online, revision);
      }
    }
  } catch (error) {
    store.clearPeerPresence(requested, revision);
    throw error;
  }
}

export async function refreshSocialProjection(label: string, includeNotifications = false): Promise<void> {
  if (!currentAuthenticatedActorPtid()) return;
  if (socialRefreshInFlight) return socialRefreshInFlight;

  socialRefreshInFlight = (async () => {
    log.info('socialRealtime', 'social projection refresh started', { label });

    const chat = useSocialChatStore.getState();
    const notifications = useNotificationStore.getState();
    await Promise.allSettled([
      chat.loadFriendRequests(),
      refreshFriendshipProjection(true),
      notifications.refreshUnreadCounts(),
      includeNotifications ? notifications.loadNotifications() : Promise.resolve(),
    ]);

    const refreshed = useSocialChatStore.getState();
    const relationships = useRelationshipsStore.getState();
    const peerPtids = Array.from(new Set(
      [
        ...Object.values(refreshed.conversationMembers)
          .flat()
          .map((member) => member.ptid),
        ...relationships.mutualFriends.map((friend) => friend.actorPtid),
      ]
        .filter((ptid) => ptid.startsWith('ptid:') && ptid !== refreshed.currentUserPtid),
    ));
    await Promise.allSettled([
      refreshed.loadCurrentUserProfile(),
      ...peerPtids.map((ptid) => refreshed.loadPeerProfile(ptid, true)),
    ]);
    await Promise.allSettled([
      refreshFriendStationIdentities(),
      refreshPeerPresence(peerPtids),
    ]);

    log.info('socialRealtime', 'social projection refresh completed', { label });
  })().finally(() => {
    socialRefreshInFlight = null;
  });

  return socialRefreshInFlight;
}

export function dispatchSocialRuntimeHostEvent(event: SocialHostEvent): void {
  if (!currentAuthenticatedActorPtid()) return;

  if (socialHostEventTargetsNotifications(event)) {
    runDetached('host notification refresh', async () => {
      const notifications = useNotificationStore.getState();
      await Promise.allSettled([
        notifications.loadNotifications(),
        notifications.refreshUnreadCounts(),
      ]);
    });
  }

  if (externalHostReconcileTimer) return;
  externalHostReconcileTimer = window.setTimeout(() => {
    externalHostReconcileTimer = null;
    runDetached('host social projection refresh', () => (
      refreshSocialProjection(socialHostEventReconcileReason(event), socialHostEventTargetsNotifications(event))
    ));
  }, EXTERNAL_HOST_RECONCILE_DEBOUNCE_MS);
}

async function bootstrapSocialProjection(actorPtid: string, sequence: number): Promise<void> {
  log.info('socialRealtime', 'social projection bootstrap started', { actorPtid });

  const chat = useSocialChatStore.getState();
  const notifications = useNotificationStore.getState();

  await Promise.allSettled([
    chat.loadCurrentUserProfile(),
    chat.loadFriendRequests(),
    refreshFriendshipProjection(true),
    notifications.refreshUnreadCounts(),
  ]);

  if (sequence !== bootstrapSequence) return;

  const refreshed = useSocialChatStore.getState();
  const relationships = useRelationshipsStore.getState();
  const peerPtids = Array.from(new Set(
    [
      ...Object.values(refreshed.conversationMembers)
        .flat()
        .map((member) => member.ptid),
      ...relationships.mutualFriends.map((friend) => friend.actorPtid),
    ]
      .filter((ptid) => ptid.startsWith('ptid:') && ptid !== refreshed.currentUserPtid),
  ));
  await Promise.allSettled([
    ...peerPtids.map((ptid) => refreshed.loadPeerProfile(ptid, true)),
  ]);

  if (sequence !== bootstrapSequence) return;

  await Promise.allSettled([
    refreshFriendStationIdentities(),
    refreshPeerPresence(peerPtids),
    notifications.loadNotifications(),
  ]);

  if (sequence !== bootstrapSequence) return;

  log.info('socialRealtime', 'social projection bootstrap completed', { actorPtid });
}

async function stopRealtimeStreamSupervisor(): Promise<void> {
  if (!realtimeStreamScopeKey) return;
  realtimeStreamScopeKey = null;
  await stopEventStream();
}

async function startRealtimeStreamSupervisor(actorPtid: string): Promise<void> {
  const sessionEpoch = useSessionStore.getState().sessionEpoch;
  const scopeKey = `${actorPtid}\0${sessionEpoch}`;
  if (realtimeStreamScopeKey === scopeKey) return;
  if (realtimeStreamScopeKey) {
    await stopRealtimeStreamSupervisor();
  }
  await installEventStreamBridge();
  await startEventStream();
  realtimeStreamScopeKey = scopeKey;
}

function reconcileAuthenticatedRuntime(): void {
  const actorPtid = currentAuthenticatedActorPtid();

  if (!actorPtid) {
    stopSocialReconcile();
    realtimeStreamTransition = realtimeStreamTransition.then(stopRealtimeStreamSupervisor).catch((error) => {
      log.warn('socialRealtime', 'realtime stream stop failed', error);
    });
    if (bootstrappedActorPtid) {
      bootstrappedActorPtid = null;
      bootstrapSequence += 1;
    }
    useRelationshipsStore.getState().reset();
    return;
  }

  realtimeStreamTransition = realtimeStreamTransition.then(() => startRealtimeStreamSupervisor(actorPtid)).catch((error) => {
    log.warn('socialRealtime', 'realtime stream start failed', error);
  });
  startSocialReconcile();

  if (bootstrappedActorPtid === actorPtid) return;
  if (bootstrappedActorPtid) {
    useRelationshipsStore.getState().reset();
  }
  bootstrappedActorPtid = actorPtid;
  const sequence = ++bootstrapSequence;
  runDetached('social projection bootstrap', () => bootstrapSocialProjection(actorPtid, sequence));
}

function isSocialNotification(notification: NotificationData): boolean {
  return notification.type === NotificationType.FRIEND_REQUEST
    || notification.type === NotificationType.FRIEND_ACCEPTED;
}

function onNotificationProjectionChanged(): void {
  const notifications = useNotificationStore.getState().notifications;
  let hasNewSocialSignal = false;

  for (const item of notifications) {
    if (!isSocialNotification(item)) continue;
    if (!rememberBounded(seenSocialNotificationIds, item.id, MAX_SEEN_SOCIAL_NOTIFICATIONS)) continue;
    hasNewSocialSignal = true;
  }

  if (hasNewSocialSignal) {
    runDetached('social notification projection refresh', () => refreshSocialProjection('social notification'));
  }
}

function onPresenceFlip(payload: RealtimePresenceFlipPayload): void {
  if (!payload.actorPtid) return;
  const store = useSocialChatStore.getState();
  store.setPeerOnline(payload.actorPtid, payload.online, ++presenceRevision);
}

function onRealtimeConnectionState(payload: RealtimeConnectionStatePayload): void {
  if (!payload.connected) return;
  runDetached('realtime reconnect presence reconciliation', async () => {
    await api.presenceNotify('heartbeat');
    await refreshPeerPresence(collectKnownPresencePeerPtids());
  });
}

function onSocialGraphEvent(payload: RealtimeSocialGraphEventPayload): void {
  const store = useSocialChatStore.getState();
  switch (payload.kind) {
    case 'friend_request_received':
    case 'friend_request_rejected':
      store.loadFriendRequests()
        .then(refreshFriendStationIdentities)
        .catch(() => {});
      break;
    case 'friend_request_accepted':
      Promise.allSettled([
        store.loadFriendRequests(),
        refreshFriendshipProjection(true),
      ]).then(async () => {
        await refreshFriendStationIdentities();
        await refreshPeerPresence(collectKnownPresencePeerPtids());
      }).catch(() => {});
      break;
    case 'unfriended':
      Promise.allSettled([
        store.loadFriendRequests(),
        refreshFriendshipProjection(true),
      ]).then(refreshFriendStationIdentities).catch(() => {});
      break;
  }
}

function onRelationshipChanged(_payload: RelationshipChangedPayload): void {
  runDetached('relationship friendship projection refresh', () => (
    refreshFriendshipProjection(true)
  ));
}

function startSocialReconcile(): void {
  if (socialReconcileTimer) return;
  socialReconcileTimer = window.setInterval(() => {
    if (!currentAuthenticatedActorPtid()) return;
    runDetached('periodic social projection refresh', () => (
      refreshSocialProjection('periodic reconcile', true)
    ));
  }, SOCIAL_RECONCILE_INTERVAL_MS);
}

function stopSocialReconcile(): void {
  if (!socialReconcileTimer) return;
  window.clearInterval(socialReconcileTimer);
  socialReconcileTimer = null;
}

export function installSocialRealtimeBridge(): void {
  if (teardownBridge) return;

  const unsubs = [
    useSessionStore.subscribe(reconcileAuthenticatedRuntime),
    eventBus.subscribe(EVENT.REALTIME_PRESENCE_FLIP, onPresenceFlip),
    eventBus.subscribe(EVENT.REALTIME_CONNECTION_STATE, onRealtimeConnectionState),
    eventBus.subscribe(EVENT.REALTIME_SOCIAL_GRAPH_EVENT, onSocialGraphEvent),
    eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, onRelationshipChanged),
    useNotificationStore.subscribe(onNotificationProjectionChanged),
  ];

  reconcileAuthenticatedRuntime();

  teardownBridge = () => {
    unsubs.forEach((unsubscribe) => unsubscribe());
    stopSocialReconcile();
    if (externalHostReconcileTimer) {
      window.clearTimeout(externalHostReconcileTimer);
      externalHostReconcileTimer = null;
    }
    teardownBridge = null;
  };

  log.info('socialRealtime', 'bridge installed');
}

export function teardownSocialRealtimeBridge(): void {
  if (!teardownBridge) return;
  teardownBridge();
}
