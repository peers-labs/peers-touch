import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { useNavigationBadgeStore } from '../store/navigationBadges';
import { useSocialChatStore } from '../store/socialChat';
import { log } from '../utils/logger';

const MESSAGING_PROJECTION_CHANGED_EVENT = 'messaging:projection-changed';

interface MessagingProjectionChangedPayload {
  conversationId: string;
  eventId: string;
  laneSequence: number;
}

let unlisten: UnlistenFn | null = null;
let installPromise: Promise<void> | null = null;
let refreshTail: Promise<void> = Promise.resolve();

async function refreshProjection(payload: MessagingProjectionChangedPayload): Promise<void> {
  const conversationId = payload.conversationId?.trim();
  if (!conversationId || !payload.eventId || payload.laneSequence <= 0) return;

  let store = useSocialChatStore.getState();
  let conversation = store.conversations.find(
    (candidate) => candidate.conversationId === conversationId,
  );
  if (!conversation) {
    await store.loadSessions();
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

  installPromise = listen<MessagingProjectionChangedPayload>(
    MESSAGING_PROJECTION_CHANGED_EVENT,
    ({ payload }) => {
      refreshTail = refreshTail
        .then(() => refreshProjection(payload))
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
      unlisten = removeListener;
      log.info('messagingProjection', 'bridge installed');
    })
    .catch((error) => {
      log.warn('messagingProjection', 'failed to install bridge', error);
    })
    .finally(() => {
      installPromise = null;
    });

  return installPromise;
}

export function teardownMessagingProjectionBridge(): void {
  unlisten?.();
  unlisten = null;
  installPromise = null;
  refreshTail = Promise.resolve();
}
