import { useSyncExternalStore } from 'react';

export const CHAT_SURFACE_FIXTURE_IDS = [
  'chat.list',
  'chat.list-loading',
  'chat.list-refreshing',
  'chat.list-empty',
  'chat.list-error',
  'chat.list-unavailable',
  'chat.list-search',
  'chat.list-search-empty',
  'chat.direct-thread',
  'chat.group-thread',
  'chat.thread-empty',
  'chat.history-loading',
  'chat.history-error',
  'chat.thread-search',
  'chat.thread-search-empty',
  'chat.thread-search-error',
  'chat.composer-keyboard',
  'chat.attachment-ready',
  'chat.attachment-uploading',
  'chat.attachment-failed',
  'chat.voice-recording',
  'chat.voice-failed',
  'chat.message-pending',
  'chat.message-failed',
  'chat.message-uncertain',
  'chat.pinned-messages',
  'chat.message-actions',
  'chat.conversation-actions',
  'chat.conversation-settings-pending',
  'chat.conversation-settings-saved',
  'chat.conversation-settings-failed',
  'chat.destructive-confirm',
  'chat.forward-picker',
  'chat.forward-pending',
  'chat.forward-failed',
  'chat.group-management',
  'chat.group-role-denied',
] as const;

export type ChatSurfaceFixtureId = typeof CHAT_SURFACE_FIXTURE_IDS[number];

export interface ChatSurfaceFixtureSnapshot {
  readonly surfaceId: ChatSurfaceFixtureId | null;
  readonly revision: number;
}

const listeners = new Set<() => void>();
let snapshot: ChatSurfaceFixtureSnapshot = {
  surfaceId: null,
  revision: 0,
};

export function useChatSurfaceFixture(): ChatSurfaceFixtureSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setChatSurfaceFixture(
  surfaceId: ChatSurfaceFixtureId | null,
): ChatSurfaceFixtureSnapshot {
  if (snapshot.surfaceId === surfaceId) return snapshot;
  snapshot = {
    surfaceId,
    revision: snapshot.revision + 1,
  };
  listeners.forEach((listener) => listener());
  return snapshot;
}

export function isChatSurfaceFixtureId(
  value: unknown,
): value is ChatSurfaceFixtureId {
  return typeof value === 'string'
    && (CHAT_SURFACE_FIXTURE_IDS as readonly string[]).includes(value);
}

export function chatSurfaceFixtureRouteKind(
  surfaceId: ChatSurfaceFixtureId | null,
): 'list' | 'direct' | 'group' {
  if (!surfaceId || surfaceId.startsWith('chat.list')) return 'list';
  if (
    surfaceId === 'chat.group-thread'
    || surfaceId === 'chat.group-management'
    || surfaceId === 'chat.group-role-denied'
  ) {
    return 'group';
  }
  return 'direct';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ChatSurfaceFixtureSnapshot {
  return snapshot;
}
