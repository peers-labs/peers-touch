import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Empty, Input, List, Modal, Popconfirm, Spin, Switch, Tag, Typography } from 'antd';
import { ArrowLeft, Ban, Bell, Check, CheckCheck, Image, MoreHorizontal, Pencil, Pin, RotateCcw, Search, Send, Trash2, Users, VolumeX, X } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import logo from '../assets/logo.png';
import { MobileAvatar } from '../components/MobileAvatar';
import { useAuthStore } from '../features/auth/authStore';
import {
  chatActionKey,
  defaultChatActionState,
  loadChatActionStates,
  saveChatActionStates,
  visibleChatUnread,
  type ChatActionState,
} from '../features/chat/chatActionState';
import { timestampMillis as groupTimestampMillis } from '../features/group/groupNormalizers';
import { useGroupStore } from '../features/group/groupStore';
import type { GroupSettings } from '../features/group/groupApi';
import {
  projectGroupConversations,
  projectGroupMessageDisplay,
  type GroupConversation,
  type GroupMessageDisplay,
} from '../features/group/groupProjection';
import { GroupRole, type GroupMember, type GroupMessage } from '../gen/proto/domain/chat/group_chat_pb';
import { FriendMessageStatus } from '../gen/proto/domain/chat/friend_chat_pb';
import {
  formatSocialError,
  useSocialStore,
} from '../features/social/socialStore';
import { timestampMillis } from '../features/social/socialNormalizers';
import { projectConversations } from '../features/social/socialProjection';
import { SocialApiError, type FriendChatMessage, type PeerProfile, type SocialConversation, type TypingEntry } from '../features/social/socialTypes';
import {
  CHAT_BACKGROUND_OPTIONS,
  type ChatBackgroundId,
  type FriendConversationSettings,
  type UpdateFriendConversationSettingsInput,
} from '../features/social/socialApi';

const { Text } = Typography;
const TYPING_TRUE_INTERVAL_MS = 3000;
const TYPING_FALSE_DELAY_MS = 4000;
const EMPTY_MESSAGES: FriendChatMessage[] = [];
const EMPTY_GROUP_MESSAGES: GroupMessage[] = [];
const EMPTY_GROUP_MEMBERS: GroupMember[] = [];
const EMPTY_TYPING_PEERS: Record<string, TypingEntry> = {};

type MobileConversation =
  | { kind: 'friend'; key: string; conversation: SocialConversation }
  | { kind: 'group'; key: string; conversation: GroupConversation };

type EditingMessage = {
  kind: 'friend' | 'group';
  ulid: string;
  content: string;
};

export function ChatPage() {
  const { t } = useMobileI18n();
  const [draft, setDraft] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [actionDrawerOpen, setActionDrawerOpen] = useState(false);
  const [chatActionStates, setChatActionStates] = useState<Record<string, ChatActionState>>({});
  const [highlightedMessageUlid, setHighlightedMessageUlid] = useState('');
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState('');
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);
  const [localActionError, setLocalActionError] = useState('');
  const activeSessionUlid = useSocialStore((state) => state.activeSessionUlid);
  const authSession = useAuthStore((state) => state.session);
  const messages = useSocialStore((state) => (activeSessionUlid ? state.messages[activeSessionUlid] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const currentUserDid = useSocialStore((state) => state.currentUserDid);
  const typingPeers = useSocialStore((state) => (activeSessionUlid ? state.typingPeers[activeSessionUlid] ?? EMPTY_TYPING_PEERS : EMPTY_TYPING_PEERS));
  const loading = useSocialStore((state) => state.loading);
  const error = useSocialStore((state) => state.error);
  const messageSearchResults = useSocialStore((state) => state.messageSearchResults);
  const messageSearchLoading = useSocialStore((state) => state.messageSearchLoading);
  const messageSearchError = useSocialStore((state) => state.messageSearchError);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const currentUserProfile = useSocialStore((state) => state.currentUserProfile);
  const loadCurrentUserProfile = useSocialStore((state) => state.loadCurrentUserProfile);
  const loadPeerProfile = useSocialStore((state) => state.loadPeerProfile);
  const loadFriendshipStatus = useSocialStore((state) => state.loadFriendshipStatus);
  const blockUser = useSocialStore((state) => state.blockUser);
  const unblockUser = useSocialStore((state) => state.unblockUser);
  const friendshipStatus = useSocialStore((state) => state.friendshipStatus);
  const selectSession = useSocialStore((state) => state.selectSession);
  const sendMessage = useSocialStore((state) => state.sendMessage);
  const editMessage = useSocialStore((state) => state.editMessage);
  const recallMessage = useSocialStore((state) => state.recallMessage);
  const deleteMessage = useSocialStore((state) => state.deleteMessage);
  const sendTypingState = useSocialStore((state) => state.sendTypingState);
  const searchMessages = useSocialStore((state) => state.searchMessages);
  const clearMessageSearch = useSocialStore((state) => state.clearMessageSearch);
  const friendConversationSettings = useSocialStore((state) => state.conversationSettings);
  const updateFriendConversationSettings = useSocialStore((state) => state.updateConversationSettings);
  const activeGroupUlid = useGroupStore((state) => state.activeGroupUlid);
  const groupMessages = useGroupStore((state) => (activeGroupUlid ? state.messages[activeGroupUlid] ?? EMPTY_GROUP_MESSAGES : EMPTY_GROUP_MESSAGES));
  const groupMembers = useGroupStore((state) => (activeGroupUlid ? state.members[activeGroupUlid] ?? EMPTY_GROUP_MEMBERS : EMPTY_GROUP_MEMBERS));
  const groupSettingsByUlid = useGroupStore((state) => state.settings);
  const groupSettings = activeGroupUlid ? groupSettingsByUlid[activeGroupUlid] : undefined;
  const groupLoading = useGroupStore((state) => state.loading);
  const groupError = useGroupStore((state) => state.error);
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const updateGroup = useGroupStore((state) => state.updateGroup);
  const updateGroupSettings = useGroupStore((state) => state.updateMySettings);
  const inviteGroupMembers = useGroupStore((state) => state.inviteMembers);
  const leaveGroup = useGroupStore((state) => state.leaveGroup);
  const removeGroupMember = useGroupStore((state) => state.removeMember);
  const updateGroupMember = useGroupStore((state) => state.updateMember);
  const groupEncryptionReady = useGroupStore((state) => (activeGroupUlid ? Boolean(state.encryptionReady[activeGroupUlid]) : false));
  const groupSending = useGroupStore((state) => (activeGroupUlid ? Boolean(state.sendingGroups[activeGroupUlid]) : false));
  const sendGroupMessage = useGroupStore((state) => state.sendEncryptedMessage);
  const editGroupMessage = useGroupStore((state) => state.editEncryptedMessage);
  const recallGroupMessage = useGroupStore((state) => state.recallMessage);
  const deleteGroupMessage = useGroupStore((state) => state.deleteMessage);
  const lastTypingPulseRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const sessions = useSocialStore((state) => state.sessions);
  const sessionMessages = useSocialStore((state) => state.messages);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const groups = useGroupStore((state) => state.groups);
  const groupMessagesByUlid = useGroupStore((state) => state.messages);
  const groupUnreadCounts = useGroupStore((state) => state.unreadCounts);
  const conversations = useMemo(
    () => projectConversations({ sessions, messages: sessionMessages, currentUserDid, peerOnline }),
    [currentUserDid, peerOnline, sessionMessages, sessions],
  );
  const groupConversations = useMemo(
    () => projectGroupConversations({ groups, messages: groupMessagesByUlid, unreadCounts: groupUnreadCounts }),
    [groupMessagesByUlid, groupUnreadCounts, groups],
  );
  const unifiedConversations = useMemo<MobileConversation[]>(
    () => [
      ...conversations.map((conversation) => ({ kind: 'friend' as const, key: `friend:${conversation.session.ulid}`, conversation })),
      ...groupConversations.map((conversation) => ({ kind: 'group' as const, key: `group:${conversation.group.ulid}`, conversation })),
    ].sort((a, b) => {
      const stickyDelta = Number(Boolean(conversationPreferenceState(b, chatActionStates, friendConversationSettings, groupSettingsByUlid).sticky))
        - Number(Boolean(conversationPreferenceState(a, chatActionStates, friendConversationSettings, groupSettingsByUlid).sticky));
      if (stickyDelta !== 0) return stickyDelta;
      return conversationUpdatedAt(b) - conversationUpdatedAt(a);
    }),
    [chatActionStates, conversations, friendConversationSettings, groupConversations, groupSettingsByUlid],
  );
  const filteredConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    if (!query) return unifiedConversations;
    return unifiedConversations.filter((conversation) =>
      conversationSearchText(conversation).toLowerCase().includes(query),
    );
  }, [conversationQuery, unifiedConversations]);

  const activeConversation = conversations.find((conversation) => conversation.session.ulid === activeSessionUlid);
  const activeGroupConversation = groupConversations.find((conversation) => conversation.group.ulid === activeGroupUlid);
  const peerTyping = activeConversation ? Boolean(typingPeers[activeConversation.peerDid]?.typing) : false;
  const groupMemberDids = useMemo(() => new Set(groupMembers.map((member) => member.actorDid).filter(Boolean)), [groupMembers]);
  const groupMemberByDid = useMemo(
    () => new Map(groupMembers.map((member) => [member.actorDid, member])),
    [groupMembers],
  );
  const groupInviteCandidates = useMemo(
    () => conversations.filter((conversation) =>
      conversation.peerDid &&
      !groupMemberDids.has(conversation.peerDid) &&
      !friendshipStatus[conversation.peerDid]?.blocked,
    ),
    [conversations, friendshipStatus, groupMemberDids],
  );
  const myGroupMember = groupMembers.find((member) => member.actorDid === currentUserDid);
  const myGroupRole = activeGroupConversation?.group.ownerDid === currentUserDid
    ? GroupRole.OWNER
    : Number(myGroupMember?.role ?? 0);
  const canManageGroupMembers = myGroupRole >= GroupRole.ADMIN;

  useEffect(() => {
    return () => {
      if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setThreadSearchQuery('');
    setThreadSearchOpen(false);
    setActionDrawerOpen(false);
    clearMessageSearch();
    setEditingMessage(null);
    setDraft('');
  }, [activeGroupUlid, activeSessionUlid, clearMessageSearch]);

  useEffect(() => {
    let active = true;
    void loadChatActionStates(currentUserDid).then((states) => {
      if (active) setChatActionStates(states);
    });
    return () => {
      active = false;
    };
  }, [currentUserDid]);

  useEffect(() => {
    void loadCurrentUserProfile();
  }, [loadCurrentUserProfile]);

  useEffect(() => {
    const dids = new Set<string>();
    if (activeConversation?.peerDid) dids.add(activeConversation.peerDid);
    groupMembers.forEach((member) => {
      if (member.actorDid && member.actorDid !== currentUserDid) dids.add(member.actorDid);
    });
    threadMessagesForProfileLoad(activeGroupConversation ? groupMessages : messages, currentUserDid).forEach((did) => dids.add(did));
    dids.forEach((did) => {
      if (did && !(did in peerProfiles)) void loadPeerProfile(did);
    });
  }, [activeConversation?.peerDid, activeGroupConversation, currentUserDid, groupMembers, groupMessages, loadPeerProfile, messages, peerProfiles]);

  useEffect(() => {
    if (activeConversation?.peerDid) {
      void loadFriendshipStatus(activeConversation.peerDid).catch(() => undefined);
    }
  }, [activeConversation?.peerDid, loadFriendshipStatus]);

  useEffect(() => {
    if (!activeGroupConversation) return;
    setGroupNameDraft(activeGroupConversation.group.name);
    setGroupDescriptionDraft(activeGroupConversation.group.description);
  }, [activeGroupConversation]);

  const emitTypingState = async (typing: boolean) => {
    if (!activeConversation) return;
    await sendTypingState(activeConversation.session.ulid, typing);
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!activeConversation) return;
    const now = Date.now();
    if (value.trim() && now - lastTypingPulseRef.current > TYPING_TRUE_INTERVAL_MS) {
      lastTypingPulseRef.current = now;
      emitTypingState(true);
    }
    if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = window.setTimeout(() => {
      emitTypingState(false);
    }, TYPING_FALSE_DELAY_MS);
  };

  const runChatOperation = async (operation: () => Promise<void>, failureKey: string) => {
    setLocalActionError('');
    try {
      await operation();
    } catch (operationError) {
      setLocalActionError(`${t(failureKey)}: ${formatChatOperationError(operationError)}`);
    }
  };

  const submitMessage = async () => {
    if (activeGroupConversation && activeGroupUlid) {
      if (editingMessage?.kind === 'group') {
        const edited = await editGroupMessage(activeGroupUlid, editingMessage.ulid, draft);
        if (edited) {
          setEditingMessage(null);
          setDraft('');
        }
        return;
      }

      const sent = await sendGroupMessage(activeGroupUlid, draft);
      if (sent) setDraft('');
      return;
    }

    if (!activeConversation || friendshipStatus[activeConversation.peerDid]?.blocked) return;
    await emitTypingState(false);

    if (editingMessage?.kind === 'friend') {
      await editMessage(activeConversation.session.ulid, editingMessage.ulid, draft);
      setEditingMessage(null);
      setDraft('');
      return;
    }

    await sendMessage(activeConversation.session.ulid, draft);
    setDraft('');
  };

  const startEditMessage = (kind: 'friend' | 'group', message: FriendChatMessage | GroupMessage) => {
    setEditingMessage({ kind, ulid: message.ulid, content: message.content });
    setDraft(message.content);
  };

  const cancelEditMessage = () => {
    setEditingMessage(null);
    setDraft('');
  };

  const recallOwnMessage = async (message: FriendChatMessage) => {
    if (!activeConversation) return;
    await recallMessage(activeConversation.session.ulid, message.ulid);
  };

  const recallOwnGroupMessage = async (message: GroupMessage) => {
    if (!activeGroupUlid) return;
    await recallGroupMessage(activeGroupUlid, message.ulid);
  };

  const deleteOwnMessage = async (message: FriendChatMessage) => {
    if (!activeConversation) return;
    await deleteMessage(activeConversation.session.ulid, message.ulid);
  };

  const deleteOwnGroupMessage = async (message: GroupMessage) => {
    if (!activeGroupUlid) return;
    await deleteGroupMessage(activeGroupUlid, message.ulid);
  };

  const inviteFriendToGroup = async (peerDid: string) => {
    if (!activeGroupUlid) return;
    await inviteGroupMembers(activeGroupUlid, [peerDid]);
  };

  const removeMemberFromGroup = async (actorDid: string) => {
    if (!activeGroupUlid) return;
    await removeGroupMember(activeGroupUlid, actorDid);
  };

  const updateMemberInGroup = async (actorDid: string, input: { role?: number; muted?: boolean }) => {
    if (!activeGroupUlid) return;
    await updateGroupMember(activeGroupUlid, actorDid, input);
  };

  const leaveActiveGroup = async () => {
    if (!activeGroupUlid) return;
    await leaveGroup(activeGroupUlid);
    setGroupManageOpen(false);
  };

  const saveGroupProfile = async () => {
    if (!activeGroupUlid) return;
    await updateGroup(activeGroupUlid, {
      name: groupNameDraft.trim(),
      description: groupDescriptionDraft.trim(),
    });
  };

  const toggleGroupMuted = async (muted: boolean) => {
    if (!activeGroupUlid) return;
    await updateGroup(activeGroupUlid, { muted });
  };

  const toggleMyGroupSetting = async (key: 'isMuted' | 'isPinned' | 'showMemberNickname', value: boolean) => {
    if (!activeGroupUlid) return;
    await updateGroupSettings(activeGroupUlid, { [key]: value });
  };

  const confirmBlockActivePeer = () => {
    if (!activeConversation) return;
    Modal.confirm({
      title: t('mobile.contacts.blockConfirmTitle'),
      content: t('mobile.contacts.blockConfirmBody'),
      okText: t('mobile.contacts.block'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await blockUser(activeConversation.peerDid);
        setActionDrawerOpen(false);
      },
    });
  };

  const confirmUnblockActivePeer = () => {
    if (!activeConversation) return;
    Modal.confirm({
      title: t('mobile.contacts.unblockConfirmTitle'),
      content: t('mobile.contacts.unblockConfirmBody'),
      okText: t('mobile.contacts.unblock'),
      cancelText: t('common.action.cancel'),
      onOk: async () => {
        await unblockUser(activeConversation.peerDid);
      },
    });
  };

  const openConversation = async (conversation: MobileConversation) => {
    if (conversation.kind === 'friend') {
      await selectGroup(null);
      await selectSession(conversation.conversation.session.ulid);
      return;
    }

    await selectSession(null);
    await selectGroup(conversation.conversation.group.ulid);
  };

  const updateChatActionState = async (key: string, patch: Partial<ChatActionState>) => {
    if (activeConversation) {
      await updateFriendConversationSettings(activeConversation.session.ulid, friendPatchFromActionPatch(patch));
    } else if (activeGroupUlid) {
      await updateGroupSettings(activeGroupUlid, groupPatchFromActionPatch(patch));
    }
    const next = {
      ...chatActionStates,
      [key]: {
        ...(chatActionStates[key] ?? defaultChatActionState()),
        ...patch,
      },
    };
    setChatActionStates(next);
    await saveChatActionStates(currentUserDid, next);
  };

  const scrollToMessage = (messageUlid: string) => {
    setHighlightedMessageUlid(messageUlid);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-message-ulid="${messageUlid}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setHighlightedMessageUlid(''), 1800);
    });
  };

  if (activeConversation || activeGroupConversation) {
    const isGroupThread = Boolean(activeGroupConversation);
    const title = activeGroupConversation?.group.name || activeConversation?.peerName || '';
    const activeKey = chatActionKey(isGroupThread ? 'group' : 'friend', activeGroupUlid || activeSessionUlid || '');
    const actionState = isGroupThread
      ? groupSettingsToActionState(groupSettings, chatActionStates[activeKey])
      : friendSettingsToActionState(activeSessionUlid ? friendConversationSettings[activeSessionUlid] : undefined, chatActionStates[activeKey]);
    const ownAvatar = currentUserProfile?.avatar || '';
    const ownName = authSession?.actor?.displayName || authSession?.actor?.display_name || authSession?.actor?.username || currentUserDid || '';
    const peerProfile = activeConversation ? peerProfiles[activeConversation.peerDid] : null;
    const activePeerBlocked = activeConversation ? Boolean(friendshipStatus[activeConversation.peerDid]?.blocked) : false;
    const peerMessageAvatar = activeGroupConversation ? '' : (peerProfile?.avatar || activeConversation?.peerAvatar);
    const stationName = stationHostFromUrl(authSession?.stationUrl);
    const subtitle = activeGroupConversation
      ? t('mobile.group.memberCount', { count: activeGroupConversation.group.memberCount })
      : peerTyping
        ? t('mobile.chat.typing')
        : t('mobile.chat.peerAtStation', { station: stationName });
    const rawThreadMessages = activeGroupConversation ? groupMessages : messages;
    const threadMessages = actionState.clearedAt
      ? rawThreadMessages.filter((message) => messageTimestampMillis(message, isGroupThread) >= actionState.clearedAt)
      : rawThreadMessages;
    const threadSearchResults = activeGroupConversation
      ? localThreadSearchResults(threadMessages, threadSearchQuery, isGroupThread)
      : messageSearchResults;

    return (
      <div className="page-container chat-thread-page">
        <header className={`page-header chat-thread-header ${threadSearchOpen ? 'searching' : ''}`}>
          <button
            className="header-action"
            type="button"
            onClick={() => {
              void selectSession(null);
              void selectGroup(null);
            }}
            aria-label={t('common.action.back')}
          >
            <ArrowLeft size={20} />
          </button>
          {threadSearchOpen ? (
            <>
              <Input.Search
                className="chat-header-search"
                value={threadSearchQuery}
                onChange={(event) => {
                  setThreadSearchQuery(event.target.value);
                  if (!event.target.value.trim()) clearMessageSearch();
                }}
                prefix={<Search size={16} />}
                placeholder={t('mobile.chat.searchMessagesPlaceholder')}
                loading={messageSearchLoading}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                allowClear
                onSearch={(value) => {
                  if (activeConversation) void searchMessages(value, activeConversation.session.ulid);
                }}
              />
              <button
                className="header-action"
                type="button"
                onClick={() => {
                  setThreadSearchOpen(false);
                  setThreadSearchQuery('');
                  clearMessageSearch();
                }}
                aria-label={t('common.action.cancel')}
              >
                <X size={18} />
              </button>
            </>
          ) : (
            <>
              <div className="header-title-stack">
                <h1 className="header-title compact">{title}</h1>
                <Text type="secondary">{subtitle}</Text>
              </div>
              <button
                className="header-action"
                type="button"
                onClick={() => setActionDrawerOpen(true)}
                aria-label={t('mobile.chat.moreActions')}
              >
                <MoreHorizontal size={20} />
              </button>
            </>
          )}
        </header>

        <ChatActionDrawer
          open={actionDrawerOpen}
          state={actionState}
          onClose={() => setActionDrawerOpen(false)}
          onSearch={() => {
            setThreadSearchOpen(true);
            setActionDrawerOpen(false);
          }}
          onToggleMute={() => { void updateChatActionState(activeKey, { muted: !actionState.muted }); }}
          onToggleSticky={() => { void updateChatActionState(activeKey, { sticky: !actionState.sticky }); }}
          onToggleAlert={() => { void updateChatActionState(activeKey, { alertEnabled: !actionState.alertEnabled }); }}
          onSelectBackground={(background) => { void updateChatActionState(activeKey, { background }); }}
          onClearHistory={() => {
            Modal.confirm({
              title: t('mobile.chat.clearHistoryConfirmTitle'),
              content: t('mobile.chat.clearHistoryConfirmBody'),
              okText: t('mobile.chat.quickClearHistory'),
              cancelText: t('common.action.cancel'),
              okButtonProps: { danger: true },
              onOk: () => { void updateChatActionState(activeKey, { clearedAt: Date.now() }); },
            });
          }}
          onRestoreHistory={() => { void updateChatActionState(activeKey, { clearedAt: 0 }); }}
          isFriendThread={Boolean(activeConversation)}
          onManageGroup={activeGroupConversation ? () => {
            setGroupManageOpen(true);
            setActionDrawerOpen(false);
          } : undefined}
          peerBlocked={activePeerBlocked}
          onBlockPeer={confirmBlockActivePeer}
          onUnblockPeer={confirmUnblockActivePeer}
        />

        {messageSearchError ? <Text type="danger" className="page-error">{formatSocialError(messageSearchError)}</Text> : null}

        {threadSearchQuery.trim() ? (
          <section className="message-search-panel">
            {threadSearchResults.length > 0 ? (
              threadSearchResults.map((message) => (
                <button className="message-search-result" type="button" key={message.ulid} onClick={() => scrollToMessage(message.ulid)}>
                  <Text ellipsis>{messageContentForSearch(message, isGroupThread, t)}</Text>
                  <Text type="secondary">{formatRelativeTime(messageTimestampMillis(message, isGroupThread), t)}</Text>
                </button>
              ))
            ) : (
              <Text type="secondary">{t('mobile.chat.noMessageResults')}</Text>
            )}
          </section>
        ) : null}

        <section className={`message-list chat-background-${actionState.background}`}>
          {threadMessages.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.emptyThread')} />
          ) : (
            threadMessages.map((message) => {
              const mine = message.senderDid === currentUserDid;
              const content = isGroupThread
                ? groupMessageDisplayText(projectGroupMessageDisplay(message as GroupMessage), t)
                : friendMessageDisplayText(message as FriendChatMessage, t);
              const canEditMessage = mine && !message.recalled && (!isGroupThread || Boolean((message as GroupMessage).content));
              return (
                <div
                  key={message.ulid}
                  data-message-ulid={message.ulid}
                  className={`message-bubble-row ${mine ? 'mine' : 'peer'} ${highlightedMessageUlid === message.ulid ? 'highlighted' : ''}`}
                >
                  {!mine ? (
                    <MessageAvatar
                      src={messageAvatarUrl(message, peerProfiles, peerMessageAvatar)}
                      fallback={messageSenderFallback(message, groupMemberByDid, activeConversation?.peerName || title)}
                    />
                  ) : null}
                  <div className="message-bubble">
                    <Text className="message-text">
                      {content}
                      <span className="message-meta">
                        {message.editedAt && !message.recalled ? <span>{t('mobile.chat.edited')}</span> : null}
                        <span>{formatRelativeTime(messageTimestampMillis(message, isGroupThread), t)}</span>
                        {mine && !message.recalled && !isGroupThread && 'status' in message ? (
                          <MessageStatusIcon status={message.status} />
                        ) : null}
                      </span>
                    </Text>
                    {mine && !message.recalled ? (
                      <span className="message-actions">
                        {canEditMessage ? (
                          <button
                            type="button"
                            className="message-action-button"
                            aria-label={t('mobile.chat.edit')}
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditMessage(isGroupThread ? 'group' : 'friend', message);
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="message-action-button"
                          aria-label={t('mobile.chat.recall')}
                          onClick={(event) => {
                            event.stopPropagation();
                            void runChatOperation(
                              () => isGroupThread
                                ? recallOwnGroupMessage(message as GroupMessage)
                                : recallOwnMessage(message as FriendChatMessage),
                              'mobile.chat.operationRecallFailed',
                            );
                          }}
                        >
                          <RotateCcw size={13} />
                        </button>
                        <Popconfirm
                          title={t('mobile.chat.deleteConfirm')}
                          okText={t('common.action.delete')}
                          cancelText={t('common.action.cancel')}
                          onConfirm={() => {
                            void runChatOperation(
                              () => isGroupThread
                                ? deleteOwnGroupMessage(message as GroupMessage)
                                : deleteOwnMessage(message as FriendChatMessage),
                              'mobile.chat.operationDeleteFailed',
                            );
                          }}
                        >
                          <button
                            type="button"
                            className="message-action-button"
                            aria-label={t('common.action.delete')}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Popconfirm>
                      </span>
                    ) : null}
                  </div>
                  {mine ? <MessageAvatar src={ownAvatar} fallback={ownName.slice(0, 1).toUpperCase()} /> : null}
                </div>
              );
            })
          )}
        </section>

        {!isGroupThread && activePeerBlocked ? (
          <footer className="message-composer readonly">
            <Text type="secondary">{t('mobile.chat.blockedComposer')}</Text>
          </footer>
        ) : isGroupThread && !groupEncryptionReady ? (
          <footer className="message-composer readonly">
            <Text type="secondary">{t('mobile.group.composerPending')}</Text>
          </footer>
        ) : (
          <footer className="message-composer">
            {editingMessage ? (
              <div className="message-editing-banner">
                <Text type="secondary" ellipsis>{t('mobile.chat.editing')}</Text>
                <button type="button" className="message-action-button light" onClick={cancelEditMessage} aria-label={t('common.action.cancel')}>
                  <X size={13} />
                </button>
              </div>
            ) : null}
              <Input
              className="message-composer-input"
              value={draft}
              onChange={(event) => handleDraftChange(event.target.value)}
              onPressEnter={() => void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed')}
              placeholder={t('mobile.chat.messagePlaceholder')}
              disabled={groupSending}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <Button
              className="message-send-button"
              type="primary"
              icon={<Send size={16} />}
              disabled={!draft.trim() || groupSending}
              loading={groupSending}
              onClick={() => void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed')}
            />
          </footer>
        )}

        {activeGroupConversation ? (
          <Modal
            title={t('mobile.group.members')}
            open={groupManageOpen}
            onCancel={() => setGroupManageOpen(false)}
            footer={null}
            destroyOnClose
          >
            <div className="group-management-panel">
              <SectionTitle title={t('mobile.group.profile')} count={activeGroupConversation.group.memberCount} />
              <Input
                value={groupNameDraft}
                onChange={(event) => setGroupNameDraft(event.target.value)}
                placeholder={t('mobile.group.namePlaceholder')}
                disabled={!canManageGroupMembers}
              />
              <Input.TextArea
                value={groupDescriptionDraft}
                onChange={(event) => setGroupDescriptionDraft(event.target.value)}
                placeholder={t('mobile.group.descriptionPlaceholder')}
                autoSize={{ minRows: 2, maxRows: 4 }}
                disabled={!canManageGroupMembers}
              />
              {canManageGroupMembers ? (
                <Button type="primary" onClick={saveGroupProfile} disabled={!groupNameDraft.trim()}>
                  {t('common.action.save')}
                </Button>
              ) : null}

              <div className="group-setting-row">
                <Text>{t('mobile.group.muted')}</Text>
                <Switch checked={Boolean(activeGroupConversation.group.muted)} onChange={toggleGroupMuted} disabled={!canManageGroupMembers} />
              </div>
              <div className="group-setting-row">
                <Text>{t('mobile.group.myMuted')}</Text>
                <Switch checked={Boolean(groupSettings?.isMuted)} onChange={(value) => toggleMyGroupSetting('isMuted', value)} />
              </div>
              <div className="group-setting-row">
                <Text>{t('mobile.group.pinned')}</Text>
                <Switch checked={Boolean(groupSettings?.isPinned)} onChange={(value) => toggleMyGroupSetting('isPinned', value)} />
              </div>
              <div className="group-setting-row">
                <Text>{t('mobile.group.showMemberNickname')}</Text>
                <Switch checked={Boolean(groupSettings?.showMemberNickname)} onChange={(value) => toggleMyGroupSetting('showMemberNickname', value)} />
              </div>

              <SectionTitle title={t('mobile.group.members')} count={groupMembers.length} />
              {groupMembers.length > 0 ? (
                <List
                  dataSource={groupMembers}
                  renderItem={(member) => {
                    const profile = peerProfiles[member.actorDid];
                    const memberName = member.nickname || profile?.displayName || profile?.username || member.actorDid;
                    const memberRole = Number(member.role ?? GroupRole.MEMBER);
                    const canManageTarget = canManageGroupMembers &&
                      member.actorDid !== currentUserDid &&
                      memberRole !== GroupRole.OWNER &&
                      (myGroupRole === GroupRole.OWNER || memberRole < myGroupRole);
                    return (
                      <List.Item
                        actions={[
                          canManageTarget && myGroupRole === GroupRole.OWNER ? (
                            <Button
                              key="role"
                              size="small"
                              onClick={() => updateMemberInGroup(member.actorDid, {
                                role: memberRole === GroupRole.ADMIN ? GroupRole.MEMBER : GroupRole.ADMIN,
                              })}
                            >
                              {memberRole === GroupRole.ADMIN ? t('mobile.group.demoteAdmin') : t('mobile.group.promoteAdmin')}
                            </Button>
                          ) : null,
                          canManageTarget ? (
                            <Button
                              key="mute"
                              size="small"
                              onClick={() => updateMemberInGroup(member.actorDid, { muted: !member.muted })}
                            >
                              {member.muted ? t('mobile.group.unmuteMember') : t('mobile.group.muteMember')}
                            </Button>
                          ) : null,
                          canManageTarget ? (
                            <Button
                              key="remove"
                              size="small"
                              danger
                              onClick={() => removeMemberFromGroup(member.actorDid)}
                            >
                              {t('mobile.group.removeMember')}
                            </Button>
                          ) : null,
                        ].filter(Boolean)}
                      >
                        <List.Item.Meta
                          avatar={<MobileAvatar src={profile?.avatar}>{memberName.slice(0, 1)}</MobileAvatar>}
                          title={<Text strong>{memberName}</Text>}
                          description={<Text type="secondary" copyable>{member.actorDid}</Text>}
                        />
                        <Tag>{groupRoleLabel(memberRole, t)}</Tag>
                        {member.muted ? <Tag color="warning">{t('mobile.group.memberMuted')}</Tag> : null}
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noMembers')} />
              )}

              <SectionTitle title={t('mobile.group.inviteFriends')} count={groupInviteCandidates.length} />
              {groupInviteCandidates.length > 0 ? (
                <List
                  dataSource={groupInviteCandidates}
                  renderItem={(candidate) => (
                    <List.Item
                      actions={[
                        <Button key="invite" size="small" type="primary" onClick={() => inviteFriendToGroup(candidate.peerDid)}>
                          {t('mobile.group.invite')}
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<MobileAvatar src={candidate.peerAvatar}>{candidate.peerName.slice(0, 1)}</MobileAvatar>}
                        title={<Text strong>{candidate.peerName}</Text>}
                        description={<Text type="secondary" copyable>{candidate.peerDid}</Text>}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noInviteCandidates')} />
              )}

              <Button danger block onClick={leaveActiveGroup}>
                {t('mobile.group.leaveGroup')}
              </Button>
            </div>
          </Modal>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <img src={logo} alt="Peers Touch" className="header-logo" />
        <h1 className="header-title">{t('mobile.chat.title')}</h1>
      </header>

      <div className="chat-search-bar">
        <Input
          value={conversationQuery}
          onChange={(event) => setConversationQuery(event.target.value)}
          prefix={<Search size={16} />}
          placeholder={t('mobile.chat.searchPlaceholder')}
          allowClear
        />
      </div>

      {localActionError ? <Text type="danger" className="page-error">{localActionError}</Text> : null}
      {error ? <Text type="danger" className="page-error">{formatSocialError(error)}</Text> : null}
      {groupError ? <Text type="danger" className="page-error">{formatSocialError(groupError)}</Text> : null}

      <section className="social-list-panel">
        <Spin spinning={loading || groupLoading}>
          {filteredConversations.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                unifiedConversations.length > 0
                  ? t('mobile.chat.noSearchResults')
                  : (
                    <div className="empty-copy">
                      <Text strong>{t('mobile.chat.emptyTitle')}</Text>
                      <Text type="secondary">{t('mobile.chat.emptySubtitle')}</Text>
                    </div>
                  )
              }
            />
          ) : (
            <List
              dataSource={filteredConversations}
              renderItem={(conversation) => {
                const preferenceState = conversationPreferenceState(conversation, chatActionStates, friendConversationSettings, groupSettingsByUlid);
                const unread = visibleChatUnread(conversationUnread(conversation), preferenceState);
                return (
                  <List.Item className="conversation-item" onClick={() => openConversation(conversation)}>
                    <List.Item.Meta
                      avatar={
                        <Badge dot={conversation.kind === 'friend' ? conversation.conversation.peerOnline : false} color="green" offset={[-2, 28]}>
                          <MobileAvatar src={conversationAvatar(conversation)}>{conversationTitle(conversation).slice(0, 1)}</MobileAvatar>
                        </Badge>
                      }
                      title={
                        <span className="conversation-title-row">
                          <Text strong>{conversationTitle(conversation)}</Text>
                          {conversation.kind === 'group' ? <Users size={13} /> : null}
                          {chatStateTags(preferenceState, t).map((tag) => (
                            <Tag key={tag} className="conversation-state-tag">{tag}</Tag>
                          ))}
                        </span>
                      }
                      description={conversationPreview(conversation, t)}
                    />
                    <div className="conversation-meta">
                      <Text type="secondary">{formatRelativeTime(conversationUpdatedAt(conversation), t)}</Text>
                      {unread > 0 ? <Badge count={unread} /> : null}
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Spin>
      </section>
    </div>
  );
}

function MessageStatusIcon({ status }: { status: number }) {
  if (status >= FriendMessageStatus.READ) return <CheckCheck size={13} className="message-status-icon read" />;
  if (status >= FriendMessageStatus.DELIVERED) return <CheckCheck size={13} className="message-status-icon" />;
  return <Check size={13} className="message-status-icon" />;
}

function MessageAvatar({ src, fallback }: { src: string; fallback: string }) {
  return (
    <MobileAvatar className="message-avatar" src={src}>
      {(fallback || '?').slice(0, 1).toUpperCase()}
    </MobileAvatar>
  );
}

function ChatActionDrawer({
  open,
  state,
  onClose,
  onSearch,
  onToggleMute,
  onToggleSticky,
  onToggleAlert,
  onSelectBackground,
  onClearHistory,
  onRestoreHistory,
  isFriendThread,
  onManageGroup,
  peerBlocked,
  onBlockPeer,
  onUnblockPeer,
}: {
  open: boolean;
  state: ChatActionState;
  onClose: () => void;
  onSearch: () => void;
  onToggleMute: () => void;
  onToggleSticky: () => void;
  onToggleAlert: () => void;
  onSelectBackground: (background: ChatBackgroundId) => void;
  onClearHistory: () => void;
  onRestoreHistory: () => void;
  isFriendThread: boolean;
  onManageGroup?: () => void;
  peerBlocked: boolean;
  onBlockPeer: () => void;
  onUnblockPeer: () => void;
}) {
  const { t } = useMobileI18n();
  if (!open) return null;

  return (
    <div className="chat-action-drawer-shell">
      <button className="chat-action-drawer-backdrop" type="button" aria-label={t('common.action.close')} onClick={onClose} />
      <aside className="chat-action-drawer">
        <div className="chat-action-drawer-header">
          <Text strong>{t('mobile.chat.moreActions')}</Text>
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="chat-action-list">
          <ChatActionButton icon={<Search size={18} />} title={t('mobile.chat.quickSearch')} onClick={onSearch} />
          <ChatActionButton
            icon={<VolumeX size={18} />}
            title={t('mobile.chat.quickMute')}
            active={state.muted}
            onClick={onToggleMute}
          />
          <ChatActionButton
            icon={<Pin size={18} />}
            title={t('mobile.chat.quickSticky')}
            active={state.sticky}
            onClick={onToggleSticky}
          />
          <ChatActionButton
            icon={<Bell size={18} />}
            title={t('mobile.chat.quickAlert')}
            active={state.alertEnabled}
            onClick={onToggleAlert}
          />
          <div className="chat-background-section">
            <Text type="secondary" className="chat-background-title">{t('mobile.chat.quickBackground')}</Text>
            <div className="chat-background-grid">
              {CHAT_BACKGROUND_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={`chat-background-choice chat-background-${option} ${state.background === option ? 'active' : ''}`}
                  type="button"
                  onClick={() => onSelectBackground(option)}
                >
                  <Image size={14} />
                  <span>{t(`mobile.chat.background.${option}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <ChatActionButton icon={<Trash2 size={18} />} title={t('mobile.chat.quickClearHistory')} danger onClick={onClearHistory} />
          {state.clearedAt ? (
            <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.chat.quickRestoreHistory')} onClick={onRestoreHistory} />
          ) : null}
          {onManageGroup ? (
            <ChatActionButton icon={<Users size={18} />} title={t('mobile.group.members')} onClick={onManageGroup} />
          ) : null}
          {isFriendThread ? (
            peerBlocked ? (
              <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.contacts.unblock')} onClick={onUnblockPeer} />
            ) : (
              <ChatActionButton icon={<Ban size={18} />} title={t('mobile.contacts.block')} danger onClick={onBlockPeer} />
            )
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function ChatActionButton({
  icon,
  title,
  active,
  danger,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`chat-action-button ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} type="button" onClick={onClick}>
      <span className="chat-action-icon">{icon}</span>
      <span>{title}</span>
    </button>
  );
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!value) return '';
  const delta = Date.now() - value;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return t('common.time.justNow');
  if (minutes < 60) return t('common.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.time.hoursAgo', { count: hours });
  return new Date(value).toLocaleDateString();
}

function conversationTitle(conversation: MobileConversation): string {
  return conversation.kind === 'friend' ? conversation.conversation.peerName : conversation.conversation.group.name;
}

function conversationAvatar(conversation: MobileConversation): string {
  return conversation.kind === 'friend' ? conversation.conversation.peerAvatar : conversation.conversation.group.avatarCid;
}

function conversationUnread(conversation: MobileConversation): number {
  return conversation.kind === 'friend' ? conversation.conversation.unread : conversation.conversation.unread;
}

function conversationPreview(conversation: MobileConversation, t: (key: string) => string): string {
  if (conversation.kind === 'group') {
    const lastMessage = conversation.conversation.lastMessage;
    return lastMessage ? groupMessageDisplayText(projectGroupMessageDisplay(lastMessage), t) : t('mobile.chat.noPreview');
  }

  const lastMessage = conversation.conversation.lastMessage;
  return lastMessage ? friendMessageDisplayText(lastMessage, t) : t('mobile.chat.noPreview');
}

function conversationUpdatedAt(conversation: MobileConversation): number {
  if (conversation.kind === 'friend') {
    return timestampMillis(conversation.conversation.session.lastMessageAt);
  }
  return groupTimestampMillis(conversation.conversation.lastMessage?.sentAt ?? conversation.conversation.group.updatedAt ?? conversation.conversation.group.createdAt);
}

function conversationSearchText(conversation: MobileConversation): string {
  if (conversation.kind === 'friend') {
    return `${conversation.conversation.peerName} ${conversation.conversation.peerDid} ${conversation.conversation.lastMessage?.content ?? ''}`;
  }
  return `${conversation.conversation.group.name} ${conversation.conversation.group.ulid} ${conversation.conversation.lastMessage?.content ?? ''}`;
}

function messageTimestampMillis(message: FriendChatMessage | GroupMessage, isGroupThread: boolean): number {
  if (isGroupThread) return groupTimestampMillis((message as GroupMessage).sentAt ?? (message as GroupMessage).createdAt);
  return timestampMillis((message as FriendChatMessage).sentAt ?? (message as FriendChatMessage).createdAt);
}

function friendMessageDisplayText(message: FriendChatMessage, t: (key: string) => string): string {
  if (message.recalled) return t('mobile.chat.recalledMessage');
  return message.content || t('mobile.chat.noPreview');
}

function groupMessageDisplayText(display: GroupMessageDisplay, t: (key: string) => string): string {
  if (display.kind === 'text') return display.content;
  if (display.kind === 'recalled') return t('mobile.chat.recalledMessage');
  if (display.kind === 'encrypted') return t('mobile.group.encryptedMessage');
  return t('mobile.chat.noPreview');
}

function messageContentForSearch(
  message: FriendChatMessage | GroupMessage,
  isGroupThread: boolean,
  t: (key: string) => string,
): string {
  return isGroupThread
    ? groupMessageDisplayText(projectGroupMessageDisplay(message as GroupMessage), t)
    : friendMessageDisplayText(message as FriendChatMessage, t);
}

function localThreadSearchResults(
  messages: Array<FriendChatMessage | GroupMessage>,
  query: string,
  isGroupThread: boolean,
): Array<FriendChatMessage | GroupMessage> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return messages.filter((message) => {
    const content = isGroupThread
      ? groupSearchableContent(projectGroupMessageDisplay(message as GroupMessage))
      : (message as FriendChatMessage).content;
    return content.toLowerCase().includes(normalized);
  });
}

function groupSearchableContent(display: GroupMessageDisplay): string {
  return display.kind === 'text' ? display.content : '';
}

function chatStateTags(
  state: ChatActionState | undefined,
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

function conversationPreferenceState(
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

function friendSettingsToActionState(
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

function groupSettingsToActionState(
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

function friendPatchFromActionPatch(patch: Partial<ChatActionState>): UpdateFriendConversationSettingsInput {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
    ...(patch.clearedAt !== undefined ? { clearedAt: patch.clearedAt } : {}),
  };
}

function groupPatchFromActionPatch(patch: Partial<ChatActionState>) {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
    ...(patch.clearedAt !== undefined ? { clearedAt: patch.clearedAt } : {}),
  };
}

function formatChatOperationError(error: unknown): string {
  if (error instanceof SocialApiError) return formatSocialError(error);
  return error instanceof Error ? error.message : String(error);
}

function groupRoleLabel(role: number, t: (key: string) => string): string {
  if (role >= GroupRole.OWNER) return t('mobile.group.roleOwner');
  if (role >= GroupRole.ADMIN) return t('mobile.group.roleAdmin');
  return t('mobile.group.roleMember');
}

function messageSenderFallback(
  message: FriendChatMessage | GroupMessage,
  groupMemberByDid: Map<string, GroupMember>,
  peerName: string,
): string {
  const member = groupMemberByDid.get(message.senderDid);
  return (member?.nickname || peerName || message.senderDid || '').slice(0, 1).toUpperCase();
}

function messageAvatarUrl(
  message: FriendChatMessage | GroupMessage,
  peerProfiles: Record<string, PeerProfile | null>,
  fallbackAvatar: string | undefined,
): string {
  return peerProfiles[message.senderDid]?.avatar || fallbackAvatar || '';
}

function threadMessagesForProfileLoad(
  messages: Array<FriendChatMessage | GroupMessage>,
  currentUserDid: string | null,
): string[] {
  return Array.from(new Set(messages.map((message) => message.senderDid).filter((did) => did && did !== currentUserDid)));
}

function stationHostFromUrl(stationUrl: string | undefined): string {
  if (!stationUrl) return '';
  try {
    return new URL(stationUrl).host;
  } catch {
    return stationUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="social-section-title">
      <Text strong>{title}</Text>
      <Text type="secondary">{count}</Text>
    </div>
  );
}
