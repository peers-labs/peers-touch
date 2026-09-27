import {
  fromJson,
  type JsonValue,
} from '@bufbuild/protobuf';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  messagingDomainRuntime,
  type MessagingRuntimeScope,
} from '../messaging/runtime';
import {
  MessagingProjectionInvalidationSchema,
  MessagingProjectionKind,
  type MessagingProjectionInvalidation,
} from '../gen/proto/domain/chat/event_pb';
import { useNavigationBadgeStore } from '../store/navigationBadges';
import { useSocialChatStore } from '../store/socialChat';
import { log } from '../utils/logger';

const MESSAGING_PROJECTION_CHANGED_EVENT = 'messaging:projection-changed';
const MAX_SEEN_INVALIDATIONS = 500;

let unlisten: UnlistenFn | null = null;
let installPromise: Promise<void> | null = null;
let refreshTail: Promise<void> = Promise.resolve();
let lifecycleGeneration = 0;
let activeScopeKey = '';
let lastLaneSequence = 0n;
const seenInvalidationEventIds = new Set<string>();

function scopeKey(scope: MessagingRuntimeScope): string {
  return [
    scope.actorPtid,
    scope.stationPeerId,
    scope.profileId,
    scope.endpointId,
    scope.activationGeneration,
  ].join(':');
}

function rememberInvalidation(eventId: string): void {
  seenInvalidationEventIds.add(eventId);
  if (seenInvalidationEventIds.size <= MAX_SEEN_INVALIDATIONS) return;
  const first = seenInvalidationEventIds.values().next().value;
  if (first) seenInvalidationEventIds.delete(first);
}

function resetCursor(scope?: MessagingRuntimeScope): void {
  activeScopeKey = scope ? scopeKey(scope) : '';
  lastLaneSequence = 0n;
  seenInvalidationEventIds.clear();
}

function requiresFullReconcile(
  payload: MessagingProjectionInvalidation,
): boolean {
  return payload.kind < MessagingProjectionKind.CONVERSATION
    || payload.kind > MessagingProjectionKind.RESYNC
    || payload.kind === MessagingProjectionKind.RESYNC
    || (lastLaneSequence > 0n && payload.laneSequence > lastLaneSequence + 1n);
}

function applyProjectionRemoval(
  payload: MessagingProjectionInvalidation,
): void {
  const conversationId = payload.conversationId.trim();
  const messageId = payload.messageId.trim();
  if (!payload.messageRemovedFromProjection || !conversationId || !messageId) return;
  useSocialChatStore.getState().applyMessageMutation(conversationId, messageId, 'DELETE', {
    newContent: '',
    newCiphertext: new Uint8Array(),
    mutatedTsUnixMs: 0,
  });
}

function rawPayloadMatchesScope(
  payload: JsonValue,
  scope: MessagingRuntimeScope,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return payload.schemaVersion === 1
    && payload.actorPtid === scope.actorPtid
    && payload.homeStationPeerId === scope.stationPeerId
    && payload.deviceId === scope.endpointId;
}

function enqueueFullReconcile(
  scope: MessagingRuntimeScope,
  reason: string,
): void {
  refreshTail = refreshTail
    .then(async () => {
      if (!messagingDomainRuntime.isCurrent(scope)) return;
      await messagingDomainRuntime.reconcile(reason);
    })
    .catch((error) => {
      log.warn('messagingProjection', 'full projection reconcile failed', {
        reason,
        error,
      });
    });
}

async function refreshProjection(
  payload: MessagingProjectionInvalidation,
  scope: MessagingRuntimeScope,
): Promise<void> {
  if (
    !messagingDomainRuntime.isCurrent(scope)
    || !messagingDomainRuntime.matchesInvalidation(payload)
  ) {
    return;
  }
  const conversationId = payload.conversationId?.trim();
  if (!conversationId || !payload.eventId || payload.laneSequence <= 0n) return;

  let store = useSocialChatStore.getState();
  let conversation = store.conversations.find(
    (candidate) => candidate.conversationId === conversationId,
  );
  if (!conversation) {
    await store.loadSessions();
    if (!messagingDomainRuntime.isCurrent(scope)) return;
    store = useSocialChatStore.getState();
    conversation = store.conversations.find(
      (candidate) => candidate.conversationId === conversationId,
    );
  }
  if (!conversation) {
    log.warn('messagingProjection', 'projection change references an unknown conversation', {
      conversationId,
      eventId: payload.eventId,
    });
    return;
  }

  const previousMessageIds = new Set(
    (store.messages[conversationId] ?? []).map((message) => message.ulid),
  );
  const badgeState = useNavigationBadgeStore.getState();
  const isActiveConversation = badgeState.chatSurfaceVisible
    && (
      (conversation.kind === 1 && store.activeSessionUlid === conversationId)
      || (conversation.kind === 2 && store.activeGroupUlid === conversationId)
    );

  await store.loadMessages(conversationId, conversation.kind === 2 ? 'group' : 'friend');
  if (!messagingDomainRuntime.isCurrent(scope)) return;

  if (isActiveConversation) {
    if (conversation.kind === 1) {
      await useSocialChatStore.getState().markFriendRead(conversationId);
    }
    badgeState.clearChatUnread(conversationId);
    return;
  }

  const refreshed = useSocialChatStore.getState();
  const newIncomingMessages = (refreshed.messages[conversationId] ?? []).filter(
    (message) => (
      !previousMessageIds.has(message.ulid)
      && message.senderPtid !== refreshed.currentUserPtid
    ),
  );
  for (const _message of newIncomingMessages) {
    badgeState.bumpChatUnread(conversationId);
  }
}

export function installMessagingProjectionBridge(): Promise<void> {
  if (unlisten) return Promise.resolve();
  if (installPromise) return installPromise;
  const generation = ++lifecycleGeneration;

  const pending = listen<JsonValue>(
    MESSAGING_PROJECTION_CHANGED_EVENT,
    ({ payload: rawPayload }) => {
      let payload: MessagingProjectionInvalidation;
      try {
        payload = fromJson(
          MessagingProjectionInvalidationSchema,
          rawPayload,
        );
      } catch (error) {
        log.warn('messagingProjection', 'invalid projection notification', error);
        const scope = messagingDomainRuntime.captureScope();
        if (scope && rawPayloadMatchesScope(rawPayload, scope)) {
          enqueueFullReconcile(scope, 'projection-invalidation:decode');
        }
        return;
      }
      if (payload.schemaVersion !== 1) {
        log.warn('messagingProjection', 'projection notification version unsupported', {
          code: 'PROJECTION_VERSION_UNSUPPORTED',
          schemaVersion: payload.schemaVersion,
        });
        return;
      }
      const scope = messagingDomainRuntime.captureScope();
      if (!scope || !messagingDomainRuntime.matchesInvalidation(payload)) return;
      refreshTail = refreshTail
        .then(async () => {
          if (!messagingDomainRuntime.isCurrent(scope)) return;
          const nextScopeKey = scopeKey(scope);
          if (activeScopeKey !== nextScopeKey) resetCursor(scope);
          if (
            seenInvalidationEventIds.has(payload.eventId)
            || payload.laneSequence <= lastLaneSequence
          ) {
            return;
          }
          applyProjectionRemoval(payload);
          if (requiresFullReconcile(payload)) {
            await messagingDomainRuntime.reconcile('projection-invalidation');
          } else {
            await refreshProjection(payload, scope);
          }
          if (!messagingDomainRuntime.isCurrent(scope)) return;
          lastLaneSequence = payload.laneSequence;
          rememberInvalidation(payload.eventId);
        })
        .catch((error) => {
          log.warn('messagingProjection', 'projection refresh failed', {
            conversationId: payload.conversationId,
            eventId: payload.eventId,
            error,
          });
        });
    },
  )
    .then((removeListener) => {
      if (generation !== lifecycleGeneration) {
        removeListener();
        return;
      }
      unlisten = removeListener;
      log.info('messagingProjection', 'bridge installed');
    })
    .catch((error) => {
      log.warn('messagingProjection', 'failed to install bridge', error);
    })
    .finally(() => {
      if (installPromise === pending) installPromise = null;
    });

  installPromise = pending;
  return installPromise;
}

export function teardownMessagingProjectionBridge(): void {
  lifecycleGeneration += 1;
  unlisten?.();
  unlisten = null;
  installPromise = null;
  refreshTail = Promise.resolve();
  resetCursor();
}

export function resetMessagingProjectionScope(): void {
  refreshTail = Promise.resolve();
  resetCursor();
}
