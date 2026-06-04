import type { ChatBackgroundId } from '../social/socialApi';
import { normalizeChatBackgroundId } from '../social/socialApi';
import { createMobileActorStorageRuntime } from '../../storage/mobileClientStorage';

export type ChatKind = 'friend' | 'group';

export interface ChatActionState {
  muted: boolean;
  sticky: boolean;
  alertEnabled: boolean;
  background: ChatBackgroundId;
  clearedAt: number;
}

const DEFAULT_CHAT_ACTION_STATE: ChatActionState = {
  muted: false,
  sticky: false,
  alertEnabled: true,
  background: 'default',
  clearedAt: 0,
};

const STORAGE_PREFIX = 'mobile-chat-action-state';
export const CHAT_ACTION_STATE_CHANGED_EVENT = 'mobile-chat-action-state-changed';

export function chatActionKey(kind: ChatKind, ulid: string): string {
  return `${kind}:${ulid}`;
}

export async function loadChatActionStates(actorDid: string | null): Promise<Record<string, ChatActionState>> {
  try {
    const cached = await createMobileActorStorageRuntime(actorDid).repositories.chatPreferences.readValue(storageKey(actorDid));
    return normalizeChatActionStates(cached);
  } catch {
    return {};
  }
}

export async function saveChatActionStates(actorDid: string | null, states: Record<string, ChatActionState>): Promise<void> {
  await createMobileActorStorageRuntime(actorDid).repositories.chatPreferences.write(storageKey(actorDid), states);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHAT_ACTION_STATE_CHANGED_EVENT));
}

export function normalizeChatActionState(value: Partial<ChatActionState> | undefined): ChatActionState {
  return {
    muted: Boolean(value?.muted),
    sticky: Boolean(value?.sticky),
    alertEnabled: value?.alertEnabled !== false,
    background: normalizeChatBackgroundId(value?.background),
    clearedAt: Number(value?.clearedAt ?? 0),
  };
}

export function defaultChatActionState(): ChatActionState {
  return { ...DEFAULT_CHAT_ACTION_STATE };
}

type ChatAlertPreference = Pick<ChatActionState, 'muted' | 'alertEnabled'>;

export function chatSuppressesAlerts(state: ChatAlertPreference | undefined): boolean {
  return Boolean(state?.muted || state?.alertEnabled === false);
}

export function visibleChatUnread(unread: number, state: ChatAlertPreference | undefined): number {
  return chatSuppressesAlerts(state) ? 0 : unread;
}

function storageKey(actorDid: string | null): string {
  return `${STORAGE_PREFIX}:${actorDid || 'anonymous'}`;
}

function normalizeChatActionStates(value: unknown): Record<string, ChatActionState> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, Partial<ChatActionState>>).map(([key, state]) => [
      key,
      normalizeChatActionState(state),
    ]),
  );
}
