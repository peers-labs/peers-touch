import { fromBinary } from '@bufbuild/protobuf';

import { ChatMessageSchema, type ChatMessage } from '../gen/proto/domain/chat/chat_pb';
import { EVENT, eventBus } from '../kernel/events';
import type {
  RealtimeConversationSettingsChangedPayload,
  RealtimeGroupFederationEventPayload,
  RealtimeGroupMembershipChangePayload,
  RealtimeMessageMutationPayload,
  RealtimeMessageReceiptPayload,
  RealtimeMessageReceivedPayload,
  RealtimeResyncPayload,
  RealtimeSocialGraphEventPayload,
  RealtimeTypingStatePayload,
} from '../kernel/events/types';
import {
  messagingDomainRuntime,
  type MessagingRuntimeScope,
} from '../messaging/runtime';
import { useMediaRuntimeStore } from './mediaRuntime';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import { useSocialChatStore } from '../store/socialChat';
import { conversationKey, conversationSuppressesAlerts, type SocialMessage } from '../store/socialProjection';
import { log } from '../utils/logger';

const TYPING_TTL_MS = 6_000;
const TYPING_SWEEP_INTERVAL_MS = 1_500;
const GROUP_FEDERATION_REFRESH_DEBOUNCE_MS = 250;
const MAX_SEEN_REALTIME_MESSAGES = 500;
const MAX_SEEN_GROUP_FEDERATION_EVENTS = 500;

let teardownBridge: (() => void) | null = null;
let typingSweepTimer: number | null = null;
let coldResyncInFlight = false;
let pendingColdResyncPayload: RealtimeResyncPayload | null = null;
const seenRealtimeMessageKeys = new Set<string>();
const seenGroupFederationEventKeys = new Set<string>();

interface GroupFederationRefreshState {
  timer: number | null;
  inFlight: boolean;
  pending: boolean;
  shouldLoadMessages: boolean;
}

const groupFederationRefreshes = new Map<string, GroupFederationRefreshState>();

function runDetached(
  label: string,
  task: (scope: MessagingRuntimeScope) => Promise<void>,
): void {
  const scope = messagingDomainRuntime.captureScope();
  if (!scope) return;
  void task(scope).catch((error) => {
    log.warn('messagingRealtime', `${label} failed`, error);
  });
}

function hasActiveScope(): boolean {
  return messagingDomainRuntime.captureScope() !== null;
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

async function refreshConversationDecorations(): Promise<void> {
  const store = useSocialChatStore.getState();
  await Promise.allSettled([
    store.loadSessions(),
    store.loadGroupUnreadCounts(),
    store.loadConversationPreviews(),
  ]);
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
  message: SocialMessage;
} | {
  kind: 'group';
  message: SocialMessage;
};

function chatMessageToSocialMessage(kind: 'friend' | 'group', chatMessage: ChatMessage, sessionUlid: string): SocialMessage {
  const common = {
    ulid: chatMessage.id,
    senderPtid: chatMessage.senderPtid,
    content: chatMessage.content,
    type: chatMessage.type as number,
    attachments: chatMessage.attachments.map(a => ({
      filename: a.name,
      mimeType: a.type,
      size: Number(a.size),
    })),
    sentAt: chatMessage.sentAt,
    createdAt: chatMessage.sentAt,
    updatedAt: chatMessage.sentAt,
    encryptedPayload: chatMessage.encryptedContent
      ? new TextEncoder().encode(chatMessage.encryptedContent)
      : new Uint8Array(),
    recalled: chatMessage.isDeleted,
    editedAt: undefined,
    replyToUlid: chatMessage.replyToId,
    mentionedPtids: chatMessage.mentionedPtids,
    mentionAll: chatMessage.mentionAll,
  };

  if (kind === 'friend') {
    return {
      ...common,
      $typeName: 'peers_touch.model.chat.v1.ChatMessage',
      sessionUlid,
      receiverPtid: '',
      status: chatMessage.status as number,
      deliveredAt: undefined,
      readAt: undefined,
    };
  }
  return {
    ...common,
    $typeName: 'peers_touch.model.chat.v1.ChatMessage',
    groupUlid: sessionUlid,
  };
}

function decodeRealtimeMessage(
  payload: RealtimeMessageReceivedPayload,
  isKnownGroup: boolean,
): DecodedRealtimeMessage | null {
  if (payload.ciphertext.byteLength === 0) return null;

  try {
    const chatMessage = fromBinary(ChatMessageSchema, payload.ciphertext);
    const kind: 'friend' | 'group' = isKnownGroup ? 'group' : 'friend';
    return {
      kind,
      message: chatMessageToSocialMessage(kind, chatMessage, payload.sessionUlid),
    };
  } catch (error) {
    log.warn('messagingRealtime', 'realtime message decode failed', error);
    return null;
  }
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
  if (!hasActiveScope()) return;
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

  runDetached('message projection and refresh', async (scope) => {
    const projectedKind = await projectRealtimeMessage(payload, isKnownGroup, decodedMessage);
    if (!messagingDomainRuntime.isCurrent(scope)) return;
    const effectiveIsGroup = projectedKind ? projectedKind === 'group' : isKnownGroup;
    if (effectiveIsGroup) {
      await refreshGroupMessage(payload.sessionUlid, isActiveConversation);
      return;
    }
    await refreshFriendMessage(payload, isActiveConversation);
  });
}

function onMessageReceipt(payload: RealtimeMessageReceiptPayload): void {
  if (!hasActiveScope()) return;
  if (!payload.sessionUlid || !payload.messageUlid) return;

  useSocialChatStore
    .getState()
    .applyMessageReceipt(payload.sessionUlid, payload.messageUlid, payload.kind);
}

function onTypingState(payload: RealtimeTypingStatePayload): void {
  if (!hasActiveScope()) return;
  if (!payload.sessionUlid || !payload.fromActorPtid) return;

  const store = useSocialChatStore.getState();
  if (store.currentUserPtid && payload.fromActorPtid === store.currentUserPtid) return;
  store.applyTypingState(payload.sessionUlid, payload.fromActorPtid, payload.typing);
}

function onMessageMutation(payload: RealtimeMessageMutationPayload): void {
  if (!hasActiveScope()) return;
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
  if (!hasActiveScope()) return;
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

function scheduleGroupFederationRefresh(groupUlid: string, shouldLoadMessages: boolean): void {
  const scope = messagingDomainRuntime.captureScope();
  if (!scope) return;
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
    if (!messagingDomainRuntime.isCurrent(scope)) {
      groupFederationRefreshes.delete(groupUlid);
      return;
    }
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
  if (!hasActiveScope()) return;
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
  if (!hasActiveScope()) return;
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

function onSocialGraphEvent(payload: RealtimeSocialGraphEventPayload): void {
  if (!hasActiveScope()) return;
  if (
    payload.kind !== 'friend_request_accepted'
    && payload.kind !== 'conversation_created'
    && payload.kind !== 'unfriended'
  ) {
    return;
  }
  runDetached('social graph conversation reconciliation', async () => {
    await refreshConversationDecorations();
  });
}

async function executeColdResync(payload: RealtimeResyncPayload): Promise<void> {
  log.info('messagingRealtime', 'cold resync started', payload);

  const chat = useSocialChatStore.getState();
  await Promise.allSettled([
    chat.loadSessions(),
    chat.loadGroups(),
  ]);

  const refreshed = useSocialChatStore.getState();
  if (refreshed.activeTab === 'friend' && refreshed.activeSessionUlid) {
    await refreshed.loadMessages(refreshed.activeSessionUlid, 'friend');
  } else if (refreshed.activeTab === 'group' && refreshed.activeGroupUlid) {
    await refreshed.loadMessages(refreshed.activeGroupUlid, 'group');
  }
  await Promise.allSettled([
    refreshed.loadGroupUnreadCounts(),
    refreshed.loadConversationPreviews(),
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
  if (!hasActiveScope()) return;
  scheduleColdResync(payload);
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

export async function refreshMessagingProjection(
  label: string,
  scope = messagingDomainRuntime.requireActiveScope(),
): Promise<void> {
  if (!messagingDomainRuntime.isCurrent(scope)) return;

  log.info('messagingRealtime', 'messaging projection refresh started', { label });

  const chat = useSocialChatStore.getState();
  await Promise.allSettled([
    chat.initEncryption(),
    chat.loadSessions(),
    chat.loadGroups(),
    chat.loadGroupUnreadCounts(),
    chat.loadConversationPreviews(),
  ]);
  if (!messagingDomainRuntime.isCurrent(scope)) return;

  const refreshed = useSocialChatStore.getState();
  if (refreshed.activeTab === 'friend' && refreshed.activeSessionUlid) {
    await refreshed.loadMessages(refreshed.activeSessionUlid, 'friend');
  } else if (refreshed.activeTab === 'group' && refreshed.activeGroupUlid) {
    await refreshed.loadMessages(refreshed.activeGroupUlid, 'group');
  }
  useNavigationBadgeStore.getState().reconcileChatBadge();

  log.info('messagingRealtime', 'messaging projection refresh completed', { label });
}

export function resetMessagingRealtimeScope(): void {
  pendingColdResyncPayload = null;
  coldResyncInFlight = false;
  seenRealtimeMessageKeys.clear();
  seenGroupFederationEventKeys.clear();
  for (const state of groupFederationRefreshes.values()) {
    if (state.timer !== null) window.clearTimeout(state.timer);
  }
  groupFederationRefreshes.clear();
}

export function installMessagingRealtimeBridge(): void {
  if (teardownBridge) return;

  const unsubs = [
    eventBus.subscribe(EVENT.REALTIME_MESSAGE_RECEIVED, onMessageReceived),
    eventBus.subscribe(EVENT.REALTIME_MESSAGE_RECEIPT, onMessageReceipt),
    eventBus.subscribe(EVENT.REALTIME_TYPING_STATE, onTypingState),
    eventBus.subscribe(EVENT.REALTIME_MESSAGE_MUTATION, onMessageMutation),
    eventBus.subscribe(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, onGroupMembershipChange),
    eventBus.subscribe(EVENT.REALTIME_GROUP_FEDERATION_EVENT, onGroupFederationEvent),
    eventBus.subscribe(EVENT.REALTIME_CONVERSATION_SETTINGS_CHANGED, onConversationSettingsChanged),
    eventBus.subscribe(EVENT.REALTIME_SOCIAL_GRAPH_EVENT, onSocialGraphEvent),
    eventBus.subscribe(EVENT.REALTIME_RESYNC, onResync),
  ];

  startTypingSweep();

  teardownBridge = () => {
    unsubs.forEach((unsubscribe) => unsubscribe());
    stopTypingSweep();
    resetMessagingRealtimeScope();
    teardownBridge = null;
  };

  log.info('messagingRealtime', 'bridge installed');
}

export function teardownMessagingRealtimeBridge(): void {
  if (!teardownBridge) return;
  teardownBridge();
}
