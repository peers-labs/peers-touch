import { fromBinary } from '@bufbuild/protobuf';
import {
  socialHostEventReconcileReason,
  socialHostEventTargetsNotifications,
  type SocialHostEvent,
} from '@peers-touch/client-chat-core';

import { EVENT, eventBus } from '../kernel/events';
import type {
  RealtimeConversationSettingsChangedPayload,
  RealtimeConnectionStatePayload,
  RealtimeGroupFederationEventPayload,
  RealtimeGroupMembershipChangePayload,
  RealtimeMessageMutationPayload,
  RealtimeMessageReceiptPayload,
  RealtimeMessageReceivedPayload,
  RealtimePresenceFlipPayload,
  RealtimeResyncPayload,
  RealtimeSocialGraphEventPayload,
  RealtimeTypingStatePayload,
  RelationshipChangedPayload,
} from '../kernel/events/types';
import { useMediaRuntimeStore } from './mediaRuntime';
import { installEventStreamBridge, startEventStream, stopEventStream } from './eventStream';
import { api, type NotificationData } from './desktop_api';
import {
  FriendChatMessageSchema,
  type FriendChatMessage,
} from '../gen/proto/domain/chat/friend_chat_pb';
import { GroupMessageSchema, type GroupMessage } from '../gen/proto/domain/chat/group_chat_pb';
import { NotificationType } from '../gen/proto/domain/notification/notification_pb';
import { useNotificationStore } from '../store/notification';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import { useRelationshipsStore } from '../store/relationships';
import { currentAuthenticatedActorPtid, useSessionStore } from '../store/session';
import { useFederationStore } from '../store/federation';
import { projectChatFriendRequestPeers } from '../store/friendshipProjection';
import { useSocialChatStore } from '../store/socialChat';
import { conversationKey, conversationSuppressesAlerts } from '../store/socialProjection';
import { log } from '../utils/logger';

const TYPING_TTL_MS = 6_000;
const TYPING_SWEEP_INTERVAL_MS = 1_500;
const SOCIAL_RECONCILE_INTERVAL_MS = 30_000;
const EXTERNAL_HOST_RECONCILE_DEBOUNCE_MS = 1_000;
const GROUP_FEDERATION_REFRESH_DEBOUNCE_MS = 250;
const MAX_SEEN_REALTIME_MESSAGES = 500;
const MAX_SEEN_SOCIAL_NOTIFICATIONS = 500;
const MAX_SEEN_GROUP_FEDERATION_EVENTS = 500;

let teardownBridge: (() => void) | null = null;
let typingSweepTimer: number | null = null;
let socialReconcileTimer: number | null = null;
let externalHostReconcileTimer: number | null = null;
let bootstrappedActorPtid: string | null = null;
let bootstrapSequence = 0;
let realtimeStreamActorPtid: string | null = null;
let realtimeStreamTransition: Promise<void> = Promise.resolve();
let socialRefreshInFlight: Promise<void> | null = null;
let coldResyncInFlight = false;
let pendingColdResyncPayload: RealtimeResyncPayload | null = null;
let presenceRevision = 0;
const seenRealtimeMessageKeys = new Set<string>();
const seenSocialNotificationIds = new Set<string>();
const seenGroupFederationEventKeys = new Set<string>();

interface GroupFederationRefreshState {
  timer: number | null;
  inFlight: boolean;
  pending: boolean;
  shouldLoadMessages: boolean;
}

const groupFederationRefreshes = new Map<string, GroupFederationRefreshState>();

function runDetached(label: string, task: () => Promise<void>): void {
  void task().catch((error) => {
    log.warn('socialRealtime', `${label} failed`, error);
  });
}

async function refreshConversationDecorations(): Promise<void> {
  const store = useSocialChatStore.getState();
  await Promise.allSettled([
    store.loadSessions(),
    store.loadGroupUnreadCounts(),
    store.loadConversationPreviews(),
  ]);
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

/**
 * Re-pull friend requests, sessions, groups, group unread counts, and
 * conversation previews into the projection stores. Exported for the
 * `socialRuntime` adapter's `reconcile` hook (see
 * `apps/desktop/src/runtimes/socialRuntime.ts`); callers should never
 * trigger a refresh from view-mount effects.
 */
export async function refreshSocialProjection(label: string, includeNotifications = false): Promise<void> {
  if (!currentAuthenticatedActorPtid()) return;
  if (socialRefreshInFlight) return socialRefreshInFlight;

  socialRefreshInFlight = (async () => {
    log.info('socialRealtime', 'social projection refresh started', { label });

    const chat = useSocialChatStore.getState();
    const notifications = useNotificationStore.getState();
    await Promise.allSettled([
      chat.loadFriendRequests(),
      chat.loadSessions(),
      chat.loadGroups(),
      refreshFriendshipProjection(true),
      notifications.refreshUnreadCounts(),
      includeNotifications ? notifications.loadNotifications() : Promise.resolve(),
    ]);

    const refreshed = useSocialChatStore.getState();
    const peerPtids = collectKnownPresencePeerPtids();
    await Promise.allSettled([
      refreshed.loadCurrentUserProfile(),
      ...peerPtids.map((ptid) => refreshed.loadPeerProfile(ptid, true)),
    ]);
    await Promise.allSettled([
      refreshFriendStationIdentities(),
      refreshPeerPresence(peerPtids),
      refreshed.activeTab === 'friend' && refreshed.activeSessionUlid
        ? refreshed.loadMessages(refreshed.activeSessionUlid, 'friend')
        : refreshed.activeTab === 'group' && refreshed.activeGroupUlid
          ? refreshed.loadMessages(refreshed.activeGroupUlid, 'group')
          : Promise.resolve(),
      refreshed.loadGroupUnreadCounts(),
      refreshed.loadConversationPreviews(),
    ]);
    useNavigationBadgeStore.getState().reconcileChatBadge();

    log.info('socialRealtime', 'social projection refresh completed', { label });
  })().finally(() => {
    socialRefreshInFlight = null;
  });

  return socialRefreshInFlight;
}

export function dispatchSocialRuntimeHostEvent(event: SocialHostEvent): void {
  if (!currentAuthenticatedActorPtid()) return;

  const sessionUlid = event.sessionUlid;
  if (sessionUlid) {
    runDetached('host targeted message refresh', async () => {
      const store = useSocialChatStore.getState();
      const kind = event.target === 'group' || store.groups.some((group) => group.ulid === sessionUlid)
        ? 'group'
        : 'friend';
      await store.loadMessages(sessionUlid, kind);
    });
  }

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
    chat.initEncryption(),
    chat.loadSessions(),
    chat.loadGroups(),
    chat.loadFriendRequests(),
    useRelationshipsStore.getState().loadMutualFriends(actorPtid, true),
    notifications.refreshUnreadCounts(),
  ]);

  if (sequence !== bootstrapSequence) return;

  const refreshed = useSocialChatStore.getState();
  const peerPtids = collectKnownPresencePeerPtids();
  await Promise.allSettled([
    ...peerPtids.map((ptid) => refreshed.loadPeerProfile(ptid, true)),
  ]);

  if (sequence !== bootstrapSequence) return;

  await Promise.allSettled([
    refreshed.loadGroupUnreadCounts(),
    refreshed.loadConversationPreviews(),
    refreshFriendStationIdentities(),
    refreshPeerPresence(peerPtids),
    refreshed.activeTab === 'friend' && refreshed.activeSessionUlid
      ? refreshed.loadMessages(refreshed.activeSessionUlid, 'friend')
      : refreshed.activeTab === 'group' && refreshed.activeGroupUlid
        ? refreshed.loadMessages(refreshed.activeGroupUlid, 'group')
        : Promise.resolve(),
    notifications.loadNotifications(),
  ]);

  if (sequence !== bootstrapSequence) return;

  useNavigationBadgeStore.getState().reconcileChatBadge();
  useMediaRuntimeStore.getState().prewarmMessages(refreshed.messages);

  log.info('socialRealtime', 'social projection bootstrap completed', { actorPtid });
}

async function stopRealtimeStreamSupervisor(): Promise<void> {
  if (!realtimeStreamActorPtid) return;
  await stopEventStream();
  realtimeStreamActorPtid = null;
}

async function startRealtimeStreamSupervisor(actorPtid: string): Promise<void> {
  if (realtimeStreamActorPtid === actorPtid) return;
  if (realtimeStreamActorPtid) {
    await stopRealtimeStreamSupervisor();
  }
  await installEventStreamBridge();
  await startEventStream();
  realtimeStreamActorPtid = actorPtid;
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
    useRelationshipsStore.getState().resetMutualFriends();
    return;
  }

  realtimeStreamTransition = realtimeStreamTransition.then(() => startRealtimeStreamSupervisor(actorPtid)).catch((error) => {
    log.warn('socialRealtime', 'realtime stream start failed', error);
  });
  startSocialReconcile();

  if (bootstrappedActorPtid === actorPtid) return;
  bootstrappedActorPtid = actorPtid;
  const sequence = ++bootstrapSequence;
  runDetached('social projection bootstrap', () => bootstrapSocialProjection(actorPtid, sequence));
}

function isVisibleConversation(
  store: ReturnType<typeof useSocialChatStore.getState>,
  conversationUlid: string,
  isGroup: boolean,
): boolean {
  if (!useNavigationBadgeStore.getState().chatSurfaceVisible) return false;
  return isGroup
    ? store.activeTab === 'group' && store.activeGroupUlid === conversationUlid
    : store.activeTab === 'friend' && store.activeSessionUlid === conversationUlid;
}

async function refreshFriendMessage(payload: RealtimeMessageReceivedPayload, shouldLoadMessages: boolean): Promise<void> {
  const store = useSocialChatStore.getState();
  if (shouldLoadMessages) {
    await store.loadMessages(payload.sessionUlid, 'friend');
    await store.markFriendRead(payload.sessionUlid);
  }

  await refreshConversationDecorations();
}

async function refreshGroupMessage(groupUlid: string, shouldLoadMessages: boolean): Promise<void> {
  const store = useSocialChatStore.getState();
  if (shouldLoadMessages) {
    await store.loadMessages(groupUlid, 'group');
    await store.markGroupRead(groupUlid);
  }

  await Promise.allSettled([
    store.loadGroups(),
    store.loadGroupUnreadCounts(),
    store.loadConversationPreviews(),
  ]);
}

type DecodedRealtimeMessage = {
  kind: 'friend';
  message: FriendChatMessage;
} | {
  kind: 'group';
  message: GroupMessage;
};

function decodeRealtimeMessage(
  payload: RealtimeMessageReceivedPayload,
  isKnownGroup: boolean,
): DecodedRealtimeMessage | null {
  if (payload.ciphertext.byteLength === 0) return null;

  if (isKnownGroup) {
    try {
      return { kind: 'group', message: fromBinary(GroupMessageSchema, payload.ciphertext) };
    } catch (error) {
      log.warn('socialRealtime', 'group realtime message decode failed', error);
      return null;
    }
  }

  try {
    const friendMessage = fromBinary(FriendChatMessageSchema, payload.ciphertext);
    if (friendMessage.receiverPtid) {
      return { kind: 'friend', message: friendMessage };
    }
  } catch (error) {
    log.warn('socialRealtime', 'friend realtime message decode failed', error);
  }

  try {
    const groupMessage = fromBinary(GroupMessageSchema, payload.ciphertext);
    if (groupMessage.groupUlid === payload.sessionUlid) {
      return { kind: 'group', message: groupMessage };
    }
  } catch (error) {
    log.warn('socialRealtime', 'fallback group realtime message decode failed', error);
  }

  return null;
}

async function projectRealtimeMessage(
  payload: RealtimeMessageReceivedPayload,
  isKnownGroup: boolean,
  decodedMessage?: DecodedRealtimeMessage | null,
): Promise<'friend' | 'group' | null> {
  const decoded = decodedMessage ?? decodeRealtimeMessage(payload, isKnownGroup);
  if (!decoded) return null;
  await useSocialChatStore.getState().ingestRealtimeMessage(decoded.kind, payload.sessionUlid, decoded.message);
  const messages = useSocialChatStore.getState().messages[payload.sessionUlid];
  if (messages) {
    useMediaRuntimeStore.getState().prewarmMessages({ [payload.sessionUlid]: messages });
  }
  return decoded.kind;
}

function onMessageReceived(payload: RealtimeMessageReceivedPayload): void {
  if (!payload.sessionUlid) return;
  const messageKey = payload.messageUlid || payload.eventId;
  if (!rememberBounded(seenRealtimeMessageKeys, messageKey, MAX_SEEN_REALTIME_MESSAGES)) {
    return;
  }

  const store = useSocialChatStore.getState();
  const isKnownGroup = store.groups.some((group) => group.ulid === payload.sessionUlid);
  const decodedMessage = decodeRealtimeMessage(payload, isKnownGroup);
  const isSelfEcho = Boolean(store.currentUserPtid && payload.senderActorPtid === store.currentUserPtid);
  const isActiveConversation = isVisibleConversation(store, payload.sessionUlid, isKnownGroup);

  const notificationSuppressed = conversationSuppressesAlerts(
    store.conversationLocalState[conversationKey(isKnownGroup ? 'group' : 'friend', payload.sessionUlid)],
  );

  if (!isSelfEcho && !isActiveConversation && !notificationSuppressed) {
    useNavigationBadgeStore.getState().bumpChatUnread(payload.sessionUlid);
  } else {
    useNavigationBadgeStore.getState().clearChatUnread(payload.sessionUlid);
  }
  if (!isSelfEcho && payload.senderActorPtid) {
    runDetached('inbound peer presence refresh', () => (
      refreshPeerPresence([payload.senderActorPtid])
    ));
  }

  runDetached('message projection and refresh', async () => {
    const projectedKind = await projectRealtimeMessage(payload, isKnownGroup, decodedMessage);
    const effectiveIsGroup = projectedKind ? projectedKind === 'group' : isKnownGroup;
    if (effectiveIsGroup) {
      await refreshGroupMessage(payload.sessionUlid, isActiveConversation);
      return;
    }
    await refreshFriendMessage(payload, isActiveConversation);
  });
}

function onMessageReceipt(payload: RealtimeMessageReceiptPayload): void {
  if (!payload.sessionUlid || !payload.messageUlid) return;

  useSocialChatStore
    .getState()
    .applyMessageReceipt(payload.sessionUlid, payload.messageUlid, payload.kind);
}

function onTypingState(payload: RealtimeTypingStatePayload): void {
  if (!payload.sessionUlid || !payload.fromActorPtid) return;

  const store = useSocialChatStore.getState();
  if (store.currentUserPtid && payload.fromActorPtid === store.currentUserPtid) return;
  store.applyTypingState(payload.sessionUlid, payload.fromActorPtid, payload.typing);
}

function onMessageMutation(payload: RealtimeMessageMutationPayload): void {
  if (!payload.sessionUlid || !payload.messageUlid) return;

  const store = useSocialChatStore.getState();
  store.applyMessageMutation(payload.sessionUlid, payload.messageUlid, payload.kind, {
    newContent: payload.newContent,
    newCiphertext: payload.newCiphertext,
    mutatedTsUnixMs: payload.mutatedTsUnixMs,
  });

  runDetached('mutation decoration refresh', refreshConversationDecorations);
}

function onGroupMembershipChange(payload: RealtimeGroupMembershipChangePayload): void {
  if (!payload.groupUlid) return;

  runDetached('group membership refresh', async () => {
    const store = useSocialChatStore.getState();
    const did = store.currentUserPtid;

    if (payload.kind === 'DISSOLVED') {
      if (store.activeGroupUlid === payload.groupUlid) {
        store.selectGroup('');
      }
    } else if (payload.kind === 'REMOVED' || payload.kind === 'LEFT') {
      if (did && payload.actorPtid === did) {
        store.selectGroup('');
      }
    }

    await Promise.allSettled([
      store.loadGroups(),
      store.loadGroupUnreadCounts(),
      payload.kind === 'DISSOLVED'
        ? Promise.resolve()
        : payload.kind === 'ADDED' || payload.kind === 'UPDATED' || payload.kind === 'TRANSFERRED' || store.activeGroupUlid === payload.groupUlid
        ? store.loadGroupMembers(payload.groupUlid)
        : Promise.resolve(),
    ]);
  });
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
        store.loadSessions(),
        refreshFriendshipProjection(true),
      ]).then(async () => {
        await refreshFriendStationIdentities();
        await refreshPeerPresence(collectKnownPresencePeerPtids());
      }).catch(() => {});
      break;
    case 'conversation_created':
      store.loadSessions()
        .then(() => refreshPeerPresence(collectKnownPresencePeerPtids()))
        .catch(() => {});
      break;
    case 'unfriended':
      Promise.allSettled([
        store.loadFriendRequests(),
        store.loadSessions(),
        refreshFriendshipProjection(true),
      ]).then(async () => {
        await refreshFriendStationIdentities();
        await refreshPeerPresence(collectKnownPresencePeerPtids());
      }).catch(() => {});
      break;
  }
}

function onRelationshipChanged(_payload: RelationshipChangedPayload): void {
  runDetached('relationship social projection refresh', () => (
    refreshSocialProjection('relationship changed')
  ));
}

async function syncKnownConversations(): Promise<void> {
  // Engine lifecycle worker drains from Station automatically at startup.
  // No legacy sync needed — UI reads from Engine projection.
}

async function executeColdResync(payload: RealtimeResyncPayload): Promise<void> {
  log.info('socialRealtime', 'cold resync started', payload);

  const chat = useSocialChatStore.getState();
  const notifications = useNotificationStore.getState();

  await Promise.allSettled([
    chat.loadSessions(),
    chat.loadGroups(),
    chat.loadFriendRequests(),
    refreshFriendshipProjection(true),
    notifications.loadNotifications(),
    notifications.refreshUnreadCounts(),
  ]);

  await syncKnownConversations();

  const refreshed = useSocialChatStore.getState();
  if (refreshed.activeTab === 'friend' && refreshed.activeSessionUlid) {
    await refreshed.loadMessages(refreshed.activeSessionUlid, 'friend');
  } else if (refreshed.activeTab === 'group' && refreshed.activeGroupUlid) {
    await refreshed.loadMessages(refreshed.activeGroupUlid, 'group');
  }
  await Promise.allSettled([
    refreshed.loadGroupUnreadCounts(),
    refreshed.loadConversationPreviews(),
    refreshFriendStationIdentities(),
    refreshPeerPresence(collectKnownPresencePeerPtids()),
  ]);
  useMediaRuntimeStore.getState().prewarmMessages(refreshed.messages);
}

function scheduleColdResync(payload: RealtimeResyncPayload): void {
  if (coldResyncInFlight) {
    pendingColdResyncPayload = payload;
    return;
  }

  coldResyncInFlight = true;
  runDetached('cold resync', async () => {
    try {
      let current: RealtimeResyncPayload | null = payload;
      while (current) {
        const next = current;
        current = null;
        await executeColdResync(next);
        current = pendingColdResyncPayload;
        pendingColdResyncPayload = null;
      }
    } finally {
      coldResyncInFlight = false;
      if (pendingColdResyncPayload) {
        const pending = pendingColdResyncPayload;
        pendingColdResyncPayload = null;
        scheduleColdResync(pending);
      }
    }
  });
}

function onResync(payload: RealtimeResyncPayload): void {
  scheduleColdResync(payload);
}

function scheduleGroupFederationRefresh(groupUlid: string, shouldLoadMessages: boolean): void {
  let state = groupFederationRefreshes.get(groupUlid);
  if (!state) {
    state = {
      timer: null,
      inFlight: false,
      pending: false,
      shouldLoadMessages: false,
    };
    groupFederationRefreshes.set(groupUlid, state);
  }

  state.pending = true;
  state.shouldLoadMessages = state.shouldLoadMessages || shouldLoadMessages;
  if (state.timer !== null || state.inFlight) return;

  state.timer = window.setTimeout(() => {
    state!.timer = null;
    runDetached('federated group event refresh', async () => {
      const current = groupFederationRefreshes.get(groupUlid);
      if (!current || current.inFlight) return;

      current.inFlight = true;
      current.pending = false;
      const loadMessages = current.shouldLoadMessages;
      current.shouldLoadMessages = false;
      try {
        await refreshGroupMessage(groupUlid, loadMessages);
      } finally {
        current.inFlight = false;
        if (current.pending) {
          scheduleGroupFederationRefresh(groupUlid, current.shouldLoadMessages);
        } else if (current.timer === null) {
          groupFederationRefreshes.delete(groupUlid);
        }
      }
    });
  }, GROUP_FEDERATION_REFRESH_DEBOUNCE_MS);
}

function onGroupFederationEvent(payload: RealtimeGroupFederationEventPayload): void {
  if (!payload.groupUlid) return;
  const eventKey = payload.groupEventUlid || `${payload.groupUlid}:${payload.seq}:${payload.eventHash}`;
  if (!rememberBounded(seenGroupFederationEventKeys, eventKey, MAX_SEEN_GROUP_FEDERATION_EVENTS)) {
    return;
  }

  const store = useSocialChatStore.getState();
  const isActiveConversation = isVisibleConversation(store, payload.groupUlid, true);

  scheduleGroupFederationRefresh(payload.groupUlid, isActiveConversation);
}

function onConversationSettingsChanged(payload: RealtimeConversationSettingsChangedPayload): void {
  runDetached('conversation settings refresh', async () => {
    const chat = useSocialChatStore.getState();
    if (payload.conversationKind === 'friend') {
      await chat.loadSessions();
    } else {
      await chat.loadGroups();
    }
    useNavigationBadgeStore.getState().reconcileChatBadge();
  });
}

function startTypingSweep(): void {
  if (typingSweepTimer) return;
  typingSweepTimer = window.setInterval(() => {
    useSocialChatStore.getState().sweepTypingPeers(Date.now() - TYPING_TTL_MS);
  }, TYPING_SWEEP_INTERVAL_MS);
}

function stopTypingSweep(): void {
  if (!typingSweepTimer) return;
  window.clearInterval(typingSweepTimer);
  typingSweepTimer = null;
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
    eventBus.subscribe(EVENT.REALTIME_MESSAGE_RECEIVED, onMessageReceived),
    eventBus.subscribe(EVENT.REALTIME_MESSAGE_RECEIPT, onMessageReceipt),
    eventBus.subscribe(EVENT.REALTIME_TYPING_STATE, onTypingState),
    eventBus.subscribe(EVENT.REALTIME_MESSAGE_MUTATION, onMessageMutation),
    eventBus.subscribe(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, onGroupMembershipChange),
    eventBus.subscribe(EVENT.REALTIME_GROUP_FEDERATION_EVENT, onGroupFederationEvent),
    eventBus.subscribe(EVENT.REALTIME_CONVERSATION_SETTINGS_CHANGED, onConversationSettingsChanged),
    eventBus.subscribe(EVENT.REALTIME_PRESENCE_FLIP, onPresenceFlip),
    eventBus.subscribe(EVENT.REALTIME_CONNECTION_STATE, onRealtimeConnectionState),
    eventBus.subscribe(EVENT.REALTIME_RESYNC, onResync),
    eventBus.subscribe(EVENT.REALTIME_SOCIAL_GRAPH_EVENT, onSocialGraphEvent),
    eventBus.subscribe(EVENT.RELATIONSHIP_CHANGED, onRelationshipChanged),
    useNotificationStore.subscribe(onNotificationProjectionChanged),
  ];

  startTypingSweep();
  reconcileAuthenticatedRuntime();

  teardownBridge = () => {
    unsubs.forEach((unsubscribe) => unsubscribe());
    stopTypingSweep();
    stopSocialReconcile();
    if (externalHostReconcileTimer) {
      window.clearTimeout(externalHostReconcileTimer);
      externalHostReconcileTimer = null;
    }
    pendingColdResyncPayload = null;
    coldResyncInFlight = false;
    teardownBridge = null;
  };

  log.info('socialRealtime', 'bridge installed');
}

export function teardownSocialRealtimeBridge(): void {
  if (!teardownBridge) return;
  teardownBridge();
}
