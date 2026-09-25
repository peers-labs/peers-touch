import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import {
  buildChatConversationSurfaceItems,
  filterChatMessagesAfterClearedAt,
  filterChatMessagesBySearchText,
  chatMessageDisplayKind,
  type ChatConversationPreferenceLike,
} from '@peers-touch/client-chat-core';

import { useSocialStore } from '../social/socialStore';
import { projectConversations } from '../social/socialProjection';
import { timestampMillis } from '../social/socialNormalizers';
import type { SocialMessage, SocialConversation, TypingEntry } from '../social/socialTypes';
import type { SocialMessageAttachment } from '../social/socialTypes';
import type { ChatActionState } from './chatActionState';
import { chatActionKey, defaultChatActionState } from './chatActionState';
import type { FriendConversationSettings, ChatBackgroundId } from '../social/socialApiTypes';
import type { CommandProjection } from '../../runtimes/commandRuntime';
import type { MessagingConversationProjection } from '../../services/mobileCommands';

// ---------------------------------------------------------------------------
// Shared conversation types
// ---------------------------------------------------------------------------

export type MobileConversation =
  | { kind: 'friend'; key: string; conversation: SocialConversation }
  | {
      kind: 'group';
      key: string;
      conversation: {
        projection: MessagingConversationProjection;
        unread: number;
        lastMessage?: SocialMessage;
      };
    };

const EMPTY_MESSAGES: SocialMessage[] = [];
const EMPTY_TYPING_PEERS: Record<string, TypingEntry> = {};

export function selectConversationTypingPeers(
  state: { readonly typingPeers: Record<string, Record<string, TypingEntry>> },
  conversationId: string,
): Record<string, TypingEntry> {
  return state.typingPeers[conversationId] ?? EMPTY_TYPING_PEERS;
}

// ---------------------------------------------------------------------------
// Conversation list selector
// ---------------------------------------------------------------------------

export interface ConversationListProjection {
  readonly all: MobileConversation[];
  readonly surfaceItems: ReturnType<typeof buildChatConversationSurfaceItems>;
}

export function useConversationListProjection(
  query: string,
  chatActionStates: Record<string, ChatActionState>,
  friendSettings: Record<string, FriendConversationSettings>,
): ConversationListProjection {
  const {
    sessions,
    currentUserPtid,
    peerOnline,
    messagingConversations,
    conversationSummaries,
  } = useSocialStore(useShallow((s) => ({
    sessions: s.sessions,
    currentUserPtid: s.currentUserPtid,
    peerOnline: s.peerOnline,
    messagingConversations: s.messagingConversations,
    conversationSummaries: s.conversationSummaries,
  })));

  const friendConversations = useMemo(
    () => projectConversations({ sessions, currentUserPtid, peerOnline }),
    [currentUserPtid, peerOnline, sessions],
  );
  const groupConversations = useMemo(
    () => messagingConversations
      .filter((conversation) => conversation.active && conversation.kind === 2)
      .map((projection) => ({
        projection,
        unread: conversationSummaries[projection.conversationId]?.unreadCount ?? 0,
        lastMessage: conversationSummaries[projection.conversationId]?.lastMessage,
      })),
    [conversationSummaries, messagingConversations],
  );

  const all = useMemo<MobileConversation[]>(
    () => [
      ...friendConversations.map((c) => ({ kind: 'friend' as const, key: `friend:${c.session.ulid}`, conversation: c })),
      ...groupConversations.map((c) => ({
        kind: 'group' as const,
        key: `group:${c.projection.conversationId}`,
        conversation: c,
      })),
    ],
    [friendConversations, groupConversations],
  );

  const surfaceItems = useMemo(
    () => buildChatConversationSurfaceItems({
      conversations: all,
      query,
      resolvePreference: (conv) =>
        conversationPreferenceState(conv, chatActionStates, friendSettings),
      resolveSearchText: conversationSearchText,
      resolveUnread: conversationUnread,
      resolveUpdatedAt: conversationUpdatedAt,
    }),
    [all, chatActionStates, friendSettings, query],
  );

  return { all, surfaceItems };
}

// ---------------------------------------------------------------------------
// Thread selector (active conversation messages)
// ---------------------------------------------------------------------------

export interface ThreadProjection {
  readonly messages: SocialMessage[];
  readonly isGroupThread: boolean;
  readonly title: string;
  readonly subtitle: string;
  readonly peerTyping: boolean;
  readonly actionState: ChatActionState;
  readonly activeKey: string;
}

export function useThreadProjection(
  activeSessionUlid: string | null,
  activeGroupUlid: string | null,
  chatActionStates: Record<string, ChatActionState>,
  friendSettings: Record<string, FriendConversationSettings>,
  stationHost: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): ThreadProjection | null {
  const activeConversationId = activeGroupUlid || activeSessionUlid;
  const messages = useSocialStore((s) => (
    activeConversationId ? s.messages[activeConversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  ));
  const currentUserPtid = useSocialStore((s) => s.currentUserPtid);
  const typingPeers = useSocialStore((s) => {
    const id = activeConversationId || '';
    return selectConversationTypingPeers(s, id);
  });
  const sessions = useSocialStore((s) => s.sessions);
  const peerOnline = useSocialStore((s) => s.peerOnline);
  const messagingConversations = useSocialStore((s) => s.messagingConversations);

  const conversations = useMemo(
    () => projectConversations({ sessions, currentUserPtid, peerOnline }),
    [currentUserPtid, peerOnline, sessions],
  );

  const activeConversation = conversations.find((c) => c.session.ulid === activeSessionUlid);
  const activeGroupConversation = messagingConversations.find(
    (conversation) => (
      conversation.kind === 2
      && conversation.active
      && conversation.conversationId === activeGroupUlid
    ),
  );

  if (!activeConversation && !activeGroupConversation) return null;

  const isGroupThread = Boolean(activeGroupConversation);
  const title = activeGroupConversation?.name || activeConversation?.peerName || '';
  const activeKey = chatActionKey(
    isGroupThread ? 'group' : 'friend',
    activeGroupUlid || activeSessionUlid || '',
  );

  const actionState = friendSettingsToActionState(
    activeConversationId ? friendSettings[activeConversationId] : undefined,
    chatActionStates[activeKey],
  );

  const peerTyping = activeConversation
    ? Boolean(typingPeers[activeConversation.peerPtid]?.typing)
    : Object.entries(typingPeers).some(
      ([ptid, entry]) => ptid !== currentUserPtid && entry.typing,
    );

  const subtitle = isGroupThread
    ? peerTyping
      ? t('mobile.chat.typing')
      : t('mobile.group.memberCount', {
          count: activeGroupConversation?.memberPtids.length ?? 0,
        })
    : peerTyping
      ? t('mobile.chat.typing')
      : t('mobile.chat.peerAtStation', { station: stationHost });

  const threadMessages = filterChatMessagesAfterClearedAt(
    messages,
    actionState.clearedAt,
    (message) => messageTimestampMillis(message),
  );

  return {
    messages: threadMessages,
    isGroupThread,
    title,
    subtitle,
    peerTyping,
    actionState,
    activeKey,
  };
}

// ---------------------------------------------------------------------------
// Pending commands selector (ledger projection)
// ---------------------------------------------------------------------------

export interface PendingCommandsProjection {
  readonly pendingCount: number;
  readonly failedCount: number;
  readonly unknownCount: number;
  readonly commands: CommandProjection[];
}

// ---------------------------------------------------------------------------
// Pure helper functions (no hooks)
// ---------------------------------------------------------------------------

export function messageTimestampMillis(message: SocialMessage): number {
  return timestampMillis(message.sentAt ?? message.createdAt);
}

export function conversationTitle(conversation: MobileConversation): string {
  return conversation.kind === 'friend'
    ? conversation.conversation.peerName
    : conversation.conversation.projection.name;
}

export function conversationAvatar(conversation: MobileConversation): string {
  return conversation.kind === 'friend'
    ? conversation.conversation.peerAvatar
    : '';
}

export function conversationUnread(conversation: MobileConversation): number {
  return conversation.conversation.unread;
}

export function conversationUpdatedAt(conversation: MobileConversation): number {
  return conversation.kind === 'friend'
    ? timestampMillis(conversation.conversation.session.lastMessageAt)
    : conversation.conversation.lastMessage
      ? messageTimestampMillis(conversation.conversation.lastMessage)
      : conversation.conversation.projection.updatedAtUnixMs;
}

export function conversationSearchText(conversation: MobileConversation): string {
  if (conversation.kind === 'friend') {
    return `${conversation.conversation.peerName} ${conversation.conversation.peerPtid} ${conversation.conversation.lastMessage?.content ?? ''} ${attachmentSearchText(conversation.conversation.lastMessage)}`;
  }
  return `${conversation.conversation.projection.name} ${conversation.conversation.projection.conversationId} ${conversation.conversation.lastMessage?.content ?? ''} ${attachmentSearchText(conversation.conversation.lastMessage)}`;
}

export function conversationPreview(
  conversation: MobileConversation,
  t: (key: string) => string,
): string {
  const lastMessage = conversation.conversation.lastMessage;
  if (lastMessage) return messageDisplayText(lastMessage, t);
  return conversation.kind === 'friend' && conversation.conversation.session.lastMessageUlid
    ? t('mobile.chat.latestMessage')
    : t('mobile.chat.noPreview');
}

export function messageDisplayText(message: SocialMessage, t: (key: string) => string): string {
  if (isModeratedChatMessage(message)) return t('mobile.chat.moderatedMessage');
  const kind = chatMessageDisplayKind({ content: message.content, recalled: message.recalled });
  if (kind === 'text') return message.content;
  if (kind === 'recalled') return t('mobile.chat.recalledMessage');
  const attachment = chatMessageAttachments(message)[0];
  if (attachment) return attachment.filename || t('mobile.chat.attachmentMessage');
  return t('mobile.chat.noPreview');
}

export function isModeratedChatMessage(
  message: SocialMessage,
): boolean {
  return Boolean((message as { moderated?: boolean }).moderated);
}

export function chatMessageAttachments(
  message?: SocialMessage,
): SocialMessageAttachment[] {
  const attachments = message?.attachments;
  return Array.isArray(attachments) ? attachments : [];
}

export function isOwnChatMessage(
  message: SocialMessage,
  currentUserPtid: string | null,
): boolean {
  return Boolean(currentUserPtid && message.senderPtid === currentUserPtid);
}

export function formatRelativeTime(
  value: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!value) return '';
  const delta = Date.now() - value;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return t('common.time.justNow');
  if (minutes < 60) return t('common.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.time.hoursAgo', { count: hours });
  return new Date(value).toLocaleDateString();
}

export function chatStateTags(
  state: ChatConversationPreferenceLike | undefined,
  t: (key: string) => string,
): string[] {
  if (!state) return [];
  const tags: string[] = [];
  if (state.sticky) tags.push(t('mobile.chat.stateSticky'));
  if (state.muted) tags.push(t('mobile.chat.stateMuted'));
  if (state.alertEnabled === false) tags.push(t('mobile.chat.stateAlertOff'));
  if (state.clearedAt) tags.push(t('mobile.chat.stateCleared'));
  return tags;
}

export function stationHostFromUrl(stationUrl: string | undefined): string {
  if (!stationUrl) return '';
  try {
    return new URL(stationUrl).host;
  } catch {
    return stationUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

// ---------------------------------------------------------------------------
// Settings -> ActionState converters
// ---------------------------------------------------------------------------

export function friendSettingsToActionState(
  settings: FriendConversationSettings | undefined,
  fallback: ChatActionState | undefined,
): ChatActionState {
  if (!settings) return fallback ?? defaultChatActionState();
  return {
    muted: settings.isMuted,
    sticky: settings.isPinned,
    alertEnabled: settings.alertEnabled,
    background: settings.background,
    clearedAt: settings.clearedAt,
  };
}

export function conversationPreferenceState(
  conversation: MobileConversation,
  localStates: Record<string, ChatActionState>,
  friendSettings: Record<string, FriendConversationSettings>,
): ChatActionState {
  const conversationId = conversation.kind === 'friend'
    ? conversation.conversation.session.ulid
    : conversation.conversation.projection.conversationId;
  return friendSettingsToActionState(
    friendSettings[conversationId],
    localStates[conversation.key],
  );
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

export function useChatHistoryProjection(
  conversationMessages: SocialMessage[],
  loadedThreadMessages: SocialMessage[],
  threadRoot: string,
  clearedAt: number,
  query: string,
) {
  const logical = useMemo(() => {
    const byId = new Map(conversationMessages.map((message) => [message.ulid, message]));
    loadedThreadMessages.forEach((message) => {
      if (!byId.has(message.ulid)) byId.set(message.ulid, message);
    });
    const visible = [...byId.values()]
      .filter((message) => (!threadRoot || message.ulid === threadRoot || message.threadRootUlid === threadRoot)
        && messageTimestampMillis(message) > clearedAt)
      .sort((a, b) => messageTimestampMillis(a) - messageTimestampMillis(b)
        || a.ulid.localeCompare(b.ulid));
    return {
      byId, visible,
      replyCount: threadRoot ? visible.filter((message) => message.ulid !== threadRoot).length : 0,
    };
  }, [conversationMessages, loadedThreadMessages, threadRoot, clearedAt]);
  const searchResults = useMemo(
    () => localThreadSearchResults(logical.visible, query),
    [logical.visible, query],
  );
  return { ...logical, searchResults };
}

export function localThreadSearchResults(
  messages: SocialMessage[],
  query: string,
): SocialMessage[] {
  return filterChatMessagesBySearchText(messages, query, (message) => (
    `${message.content} ${attachmentSearchText(message)}`
  ));
}

function attachmentSearchText(message?: SocialMessage): string {
  return chatMessageAttachments(message)
    .map((a) => `${a.filename ?? ''} ${a.mimeType ?? ''}`)
    .join(' ');
}
