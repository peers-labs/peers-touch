/**
 * chatSelectors.ts — Narrow selector hooks for the Chat page.
 *
 * Pages consume these selectors instead of reaching into stores directly.
 * Each selector returns the minimal projection a rendering concern needs.
 * The selector layer owns memoisation; the page does not run useMemo
 * on store-derived data.
 */

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
import { useGroupStore } from '../group/groupStore';
import { projectConversations } from '../social/socialProjection';
import { projectGroupConversations, projectGroupMessageDisplay, type GroupConversation, type GroupMessageDisplay } from '../group/groupProjection';
import { timestampMillis } from '../social/socialNormalizers';
import { timestampMillis as groupTimestampMillis } from '../group/groupNormalizers';
import type { FriendChatMessage, SocialConversation, TypingEntry } from '../social/socialTypes';
import { GroupRole, type GroupMember, type GroupMessage, type GroupMessageAttachment } from '../../gen/proto/domain/chat/group_chat_pb';
import type { FriendMessageAttachment } from '../social/socialTypes';
import type { ChatActionState } from './chatActionState';
import { chatActionKey, defaultChatActionState } from './chatActionState';
import type { FriendConversationSettings, ChatBackgroundId } from '../social/socialApiTypes';
import type { GroupGatewaySettings as GroupSettings } from '../../services/gateways';
import type { CommandProjection } from '../../runtimes/commandRuntime';

// ---------------------------------------------------------------------------
// Shared conversation types
// ---------------------------------------------------------------------------

export type MobileConversation =
  | { kind: 'friend'; key: string; conversation: SocialConversation }
  | { kind: 'group'; key: string; conversation: GroupConversation };

const EMPTY_MESSAGES: FriendChatMessage[] = [];
const EMPTY_GROUP_MESSAGES: GroupMessage[] = [];
const EMPTY_GROUP_MEMBERS: GroupMember[] = [];
const EMPTY_TYPING_PEERS: Record<string, TypingEntry> = {};

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
  groupSettingsByUlid: Record<string, GroupSettings>,
): ConversationListProjection {
  const { sessions, sessionMessages, currentUserPtid, peerOnline } = useSocialStore(useShallow((s) => ({
    sessions: s.sessions,
    sessionMessages: s.messages,
    currentUserPtid: s.currentUserPtid,
    peerOnline: s.peerOnline,
  })));
  const { groups, groupMessagesByUlid, groupUnreadCounts } = useGroupStore(useShallow((s) => ({
    groups: s.groups,
    groupMessagesByUlid: s.messages,
    groupUnreadCounts: s.unreadCounts,
  })));

  const friendConversations = useMemo(
    () => projectConversations({ sessions, messages: sessionMessages, currentUserPtid, peerOnline }),
    [currentUserPtid, peerOnline, sessionMessages, sessions],
  );

  const groupConversations = useMemo(
    () => projectGroupConversations({ groups, messages: groupMessagesByUlid, unreadCounts: groupUnreadCounts }),
    [groupMessagesByUlid, groupUnreadCounts, groups],
  );

  const all = useMemo<MobileConversation[]>(
    () => [
      ...friendConversations.map((c) => ({ kind: 'friend' as const, key: `friend:${c.session.ulid}`, conversation: c })),
      ...groupConversations.map((c) => ({ kind: 'group' as const, key: `group:${c.group.ulid}`, conversation: c })),
    ],
    [friendConversations, groupConversations],
  );

  const surfaceItems = useMemo(
    () => buildChatConversationSurfaceItems({
      conversations: all,
      query,
      resolvePreference: (conv) =>
        conversationPreferenceState(conv, chatActionStates, friendSettings, groupSettingsByUlid),
      resolveSearchText: conversationSearchText,
      resolveUnread: conversationUnread,
      resolveUpdatedAt: conversationUpdatedAt,
    }),
    [all, chatActionStates, friendSettings, groupSettingsByUlid, query],
  );

  return { all, surfaceItems };
}

// ---------------------------------------------------------------------------
// Thread selector (active conversation messages)
// ---------------------------------------------------------------------------

export interface ThreadProjection {
  readonly messages: Array<FriendChatMessage | GroupMessage>;
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
  groupSettingsByUlid: Record<string, GroupSettings>,
  stationHost: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): ThreadProjection | null {
  const messages = useSocialStore((s) => (activeSessionUlid ? s.messages[activeSessionUlid] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const currentUserPtid = useSocialStore((s) => s.currentUserPtid);
  const typingPeers = useSocialStore((s) => {
    const id = activeGroupUlid || activeSessionUlid || '';
    return id ? s.typingPeers[id] ?? EMPTY_TYPING_PEERS : EMPTY_TYPING_PEERS;
  });
  const sessions = useSocialStore((s) => s.sessions);
  const sessionMessages = useSocialStore((s) => s.messages);
  const peerOnline = useSocialStore((s) => s.peerOnline);
  const groupMessages = useGroupStore((s) => (activeGroupUlid ? s.messages[activeGroupUlid] ?? EMPTY_GROUP_MESSAGES : EMPTY_GROUP_MESSAGES));
  const groups = useGroupStore((s) => s.groups);
  const groupMessagesByUlid = useGroupStore((s) => s.messages);
  const groupUnreadCounts = useGroupStore((s) => s.unreadCounts);

  const conversations = useMemo(
    () => projectConversations({ sessions, messages: sessionMessages, currentUserPtid, peerOnline }),
    [currentUserPtid, peerOnline, sessionMessages, sessions],
  );
  const groupConversations = useMemo(
    () => projectGroupConversations({ groups, messages: groupMessagesByUlid, unreadCounts: groupUnreadCounts }),
    [groupMessagesByUlid, groupUnreadCounts, groups],
  );

  const activeConversation = conversations.find((c) => c.session.ulid === activeSessionUlid);
  const activeGroupConversation = groupConversations.find((c) => c.group.ulid === activeGroupUlid);

  if (!activeConversation && !activeGroupConversation) return null;

  const isGroupThread = Boolean(activeGroupConversation);
  const title = activeGroupConversation?.group.name || activeConversation?.peerName || '';
  const activeKey = chatActionKey(isGroupThread ? 'group' : 'friend', activeGroupUlid || activeSessionUlid || '');

  const actionState = isGroupThread
    ? groupSettingsToActionState(groupSettingsByUlid[activeGroupUlid || ''], chatActionStates[activeKey])
    : friendSettingsToActionState(activeSessionUlid ? friendSettings[activeSessionUlid] : undefined, chatActionStates[activeKey]);

  const peerTyping = activeConversation
    ? Boolean(typingPeers[activeConversation.peerPtid]?.typing)
    : Object.entries(typingPeers).some(([ptid, entry]) => ptid !== currentUserPtid && entry.typing);

  const subtitle = activeGroupConversation
    ? peerTyping
      ? t('mobile.chat.typing')
      : t('mobile.group.memberCount', { count: activeGroupConversation.group.memberCount })
    : peerTyping
      ? t('mobile.chat.typing')
      : t('mobile.chat.peerAtStation', { station: stationHost });

  const rawThreadMessages: Array<FriendChatMessage | GroupMessage> = activeGroupConversation ? groupMessages : messages;
  const threadMessages = filterChatMessagesAfterClearedAt(
    rawThreadMessages,
    actionState.clearedAt,
    (message) => messageTimestampMillis(message, isGroupThread),
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
// Group admin selector
// ---------------------------------------------------------------------------

export interface GroupAdminProjection {
  readonly members: GroupMember[];
  readonly myRole: number;
  readonly canManageMembers: boolean;
  readonly inviteCandidates: SocialConversation[];
  readonly groupSettings: GroupSettings | undefined;
}

export function useGroupAdminProjection(
  activeGroupUlid: string | null,
): GroupAdminProjection {
  const members = useGroupStore((s) => (activeGroupUlid ? s.members[activeGroupUlid] ?? EMPTY_GROUP_MEMBERS : EMPTY_GROUP_MEMBERS));
  const groupSettings = useGroupStore((s) => activeGroupUlid ? s.settings[activeGroupUlid] : undefined);
  const currentUserPtid = useSocialStore((s) => s.currentUserPtid);
  const friendshipStatus = useSocialStore((s) => s.friendshipStatus);
  const sessions = useSocialStore((s) => s.sessions);
  const sessionMessages = useSocialStore((s) => s.messages);
  const peerOnline = useSocialStore((s) => s.peerOnline);
  const groups = useGroupStore((s) => s.groups);
  const groupMessagesByUlid = useGroupStore((s) => s.messages);
  const groupUnreadCounts = useGroupStore((s) => s.unreadCounts);

  const conversations = useMemo(
    () => projectConversations({ sessions, messages: sessionMessages, currentUserPtid, peerOnline }),
    [currentUserPtid, peerOnline, sessionMessages, sessions],
  );

  const groupConversations = useMemo(
    () => projectGroupConversations({ groups, messages: groupMessagesByUlid, unreadCounts: groupUnreadCounts }),
    [groupMessagesByUlid, groupUnreadCounts, groups],
  );

  const activeGroupConversation = groupConversations.find((c) => c.group.ulid === activeGroupUlid);

  const memberPtids = useMemo(() => new Set(members.map((m) => m.ptid).filter(Boolean)), [members]);

  const myMember = members.find((m) => m.ptid === currentUserPtid);
  const myRole = activeGroupConversation?.group.ownerPtid === currentUserPtid
    ? GroupRole.OWNER
    : Number(myMember?.role ?? 0);
  const canManageMembers = myRole >= GroupRole.ADMIN;

  const inviteCandidates = useMemo(
    () => conversations.filter((c) =>
      c.peerPtid &&
      !memberPtids.has(c.peerPtid) &&
      !friendshipStatus[c.peerPtid]?.blocked,
    ),
    [conversations, friendshipStatus, memberPtids],
  );

  return { members, myRole, canManageMembers, inviteCandidates, groupSettings };
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

export function messageTimestampMillis(message: FriendChatMessage | GroupMessage, isGroupThread: boolean): number {
  if (isGroupThread) return groupTimestampMillis((message as GroupMessage).sentAt ?? (message as GroupMessage).createdAt);
  return timestampMillis((message as FriendChatMessage).sentAt ?? (message as FriendChatMessage).createdAt);
}

export function conversationTitle(conversation: MobileConversation): string {
  return conversation.kind === 'friend' ? conversation.conversation.peerName : conversation.conversation.group.name;
}

export function conversationAvatar(conversation: MobileConversation): string {
  return conversation.kind === 'friend' ? conversation.conversation.peerAvatar : conversation.conversation.group.avatarCid;
}

export function conversationUnread(conversation: MobileConversation): number {
  return conversation.kind === 'friend' ? conversation.conversation.unread : conversation.conversation.unread;
}

export function conversationUpdatedAt(conversation: MobileConversation): number {
  if (conversation.kind === 'friend') {
    return timestampMillis(conversation.conversation.session.lastMessageAt);
  }
  return groupTimestampMillis(
    conversation.conversation.lastMessage?.sentAt
    ?? conversation.conversation.group.updatedAt
    ?? conversation.conversation.group.createdAt,
  );
}

export function conversationSearchText(conversation: MobileConversation): string {
  if (conversation.kind === 'friend') {
    return `${conversation.conversation.peerName} ${conversation.conversation.peerPtid} ${conversation.conversation.lastMessage?.content ?? ''} ${attachmentSearchText(conversation.conversation.lastMessage)}`;
  }
  return `${conversation.conversation.group.name} ${conversation.conversation.group.ulid} ${conversation.conversation.lastMessage?.content ?? ''} ${attachmentSearchText(conversation.conversation.lastMessage)}`;
}

export function conversationPreview(
  conversation: MobileConversation,
  t: (key: string) => string,
): string {
  if (conversation.kind === 'group') {
    const lastMessage = conversation.conversation.lastMessage;
    if (!lastMessage) return t('mobile.chat.noPreview');
    const text = groupMessageDisplayText(projectGroupMessageDisplay(lastMessage), t);
    if (text !== t('mobile.chat.noPreview')) return text;
    return chatMessageAttachments(lastMessage)[0]?.filename || t('mobile.chat.noPreview');
  }
  const lastMessage = conversation.conversation.lastMessage;
  if (lastMessage) return friendMessageDisplayText(lastMessage, t);
  return conversation.conversation.session.lastMessageUlid ? t('mobile.chat.latestMessage') : t('mobile.chat.noPreview');
}

export function friendMessageDisplayText(message: FriendChatMessage, t: (key: string) => string): string {
  const kind = chatMessageDisplayKind({ content: message.content, recalled: message.recalled });
  if (kind === 'text') return message.content;
  if (kind === 'recalled') return t('mobile.chat.recalledMessage');
  const attachment = chatMessageAttachments(message)[0];
  if (attachment) return attachment.filename || t('mobile.chat.attachmentMessage');
  return t('mobile.chat.noPreview');
}

export function groupMessageDisplayText(display: GroupMessageDisplay, t: (key: string) => string): string {
  const kind = chatMessageDisplayKind({
    content: display.kind === 'text' ? display.content : '',
    recalled: display.kind === 'recalled',
    encrypted: display.kind === 'encrypted',
  });
  if (kind === 'text' && display.kind === 'text') return display.content;
  if (kind === 'recalled') return t('mobile.chat.recalledMessage');
  if (kind === 'encrypted') return t('mobile.group.encryptedMessage');
  return t('mobile.chat.noPreview');
}

export function chatMessageAttachments(
  message?: FriendChatMessage | GroupMessage,
): Array<FriendMessageAttachment | GroupMessageAttachment> {
  const attachments = message?.attachments;
  return Array.isArray(attachments) ? attachments : [];
}

export function isOwnChatMessage(
  message: FriendChatMessage | GroupMessage,
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
// Settings → ActionState converters
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

export function groupSettingsToActionState(
  settings: GroupSettings | undefined,
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
  groupSettings: Record<string, GroupSettings>,
): ChatActionState {
  if (conversation.kind === 'friend') {
    return friendSettingsToActionState(friendSettings[conversation.conversation.session.ulid], localStates[conversation.key]);
  }
  return groupSettingsToActionState(groupSettings[conversation.conversation.group.ulid], localStates[conversation.key]);
}

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

export function localThreadSearchResults(
  messages: Array<FriendChatMessage | GroupMessage>,
  query: string,
  isGroupThread: boolean,
): Array<FriendChatMessage | GroupMessage> {
  return filterChatMessagesBySearchText(messages, query, (message) => (
    isGroupThread
      ? `${groupSearchableContent(projectGroupMessageDisplay(message as GroupMessage))} ${attachmentSearchText(message)}`
      : `${(message as FriendChatMessage).content} ${attachmentSearchText(message)}`
  ));
}

function groupSearchableContent(display: GroupMessageDisplay): string {
  return display.kind === 'text' ? display.content : '';
}

function attachmentSearchText(message?: FriendChatMessage | GroupMessage): string {
  return chatMessageAttachments(message)
    .map((a) => `${a.filename ?? ''} ${a.mimeType ?? ''}`)
    .join(' ');
}
