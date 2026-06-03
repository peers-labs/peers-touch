import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Empty, Input, List, Popconfirm, Spin, Typography } from 'antd';
import { ArrowLeft, Pencil, RotateCcw, Search, Send, Trash2, Users, X } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import logo from '../assets/logo.png';
import { selectGroupConversations } from '../features/group/groupSelectors';
import { timestampMillis as groupTimestampMillis } from '../features/group/groupNormalizers';
import { useGroupStore } from '../features/group/groupStore';
import {
  projectGroupMessageDisplay,
  type GroupConversation,
  type GroupMessageDisplay,
} from '../features/group/groupProjection';
import type { GroupMessage } from '../gen/proto/domain/chat/group_chat_pb';
import {
  formatSocialError,
  useSocialStore,
} from '../features/social/socialStore';
import { timestampMillis } from '../features/social/socialNormalizers';
import { selectSocialConversations } from '../features/social/socialSelectors';
import type { FriendChatMessage, TypingEntry } from '../features/social/socialTypes';

const { Text } = Typography;
const TYPING_TRUE_INTERVAL_MS = 3000;
const TYPING_FALSE_DELAY_MS = 4000;
const MESSAGE_STATUS_DELIVERED = 3;
const MESSAGE_STATUS_READ = 4;
const EMPTY_MESSAGES: FriendChatMessage[] = [];
const EMPTY_GROUP_MESSAGES: GroupMessage[] = [];
const EMPTY_TYPING_PEERS: Record<string, TypingEntry> = {};

type MobileConversation =
  | { kind: 'friend'; key: string; conversation: ReturnType<typeof selectSocialConversations>[number] }
  | { kind: 'group'; key: string; conversation: GroupConversation };

export function ChatPage() {
  const { t } = useMobileI18n();
  const [draft, setDraft] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [editingMessage, setEditingMessage] = useState<FriendChatMessage | null>(null);
  const activeSessionUlid = useSocialStore((state) => state.activeSessionUlid);
  const messages = useSocialStore((state) => (activeSessionUlid ? state.messages[activeSessionUlid] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const currentUserDid = useSocialStore((state) => state.currentUserDid);
  const typingPeers = useSocialStore((state) => (activeSessionUlid ? state.typingPeers[activeSessionUlid] ?? EMPTY_TYPING_PEERS : EMPTY_TYPING_PEERS));
  const loading = useSocialStore((state) => state.loading);
  const error = useSocialStore((state) => state.error);
  const messageSearchResults = useSocialStore((state) => state.messageSearchResults);
  const messageSearchLoading = useSocialStore((state) => state.messageSearchLoading);
  const messageSearchError = useSocialStore((state) => state.messageSearchError);
  const selectSession = useSocialStore((state) => state.selectSession);
  const sendMessage = useSocialStore((state) => state.sendMessage);
  const editMessage = useSocialStore((state) => state.editMessage);
  const recallMessage = useSocialStore((state) => state.recallMessage);
  const deleteMessage = useSocialStore((state) => state.deleteMessage);
  const sendTypingState = useSocialStore((state) => state.sendTypingState);
  const searchMessages = useSocialStore((state) => state.searchMessages);
  const clearMessageSearch = useSocialStore((state) => state.clearMessageSearch);
  const activeGroupUlid = useGroupStore((state) => state.activeGroupUlid);
  const groupMessages = useGroupStore((state) => (activeGroupUlid ? state.messages[activeGroupUlid] ?? EMPTY_GROUP_MESSAGES : EMPTY_GROUP_MESSAGES));
  const groupLoading = useGroupStore((state) => state.loading);
  const groupError = useGroupStore((state) => state.error);
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const lastTypingPulseRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const conversations = useSocialStore(selectSocialConversations);
  const groupConversations = useGroupStore(selectGroupConversations);
  const unifiedConversations = useMemo<MobileConversation[]>(
    () => [
      ...conversations.map((conversation) => ({ kind: 'friend' as const, key: `friend:${conversation.session.ulid}`, conversation })),
      ...groupConversations.map((conversation) => ({ kind: 'group' as const, key: `group:${conversation.group.ulid}`, conversation })),
    ].sort((a, b) => conversationUpdatedAt(b) - conversationUpdatedAt(a)),
    [conversations, groupConversations],
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

  useEffect(() => {
    return () => {
      if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setThreadSearchQuery('');
    clearMessageSearch();
    setEditingMessage(null);
    setDraft('');
  }, [activeGroupUlid, activeSessionUlid, clearMessageSearch]);

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

  const submitMessage = async () => {
    if (!activeConversation) return;
    await emitTypingState(false);

    if (editingMessage) {
      await editMessage(activeConversation.session.ulid, editingMessage.ulid, draft);
      setEditingMessage(null);
      setDraft('');
      return;
    }

    await sendMessage(activeConversation.session.ulid, draft);
    setDraft('');
  };

  const startEditMessage = (message: FriendChatMessage) => {
    setEditingMessage(message);
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

  const deleteOwnMessage = async (message: FriendChatMessage) => {
    if (!activeConversation) return;
    await deleteMessage(activeConversation.session.ulid, message.ulid);
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

  if (activeConversation || activeGroupConversation) {
    const isGroupThread = Boolean(activeGroupConversation);
    const title = activeGroupConversation?.group.name || activeConversation?.peerName || '';
    const avatar = activeGroupConversation?.group.avatarCid || activeConversation?.peerAvatar;
    const avatarFallback = (title || activeGroupConversation?.group.ulid || activeConversation?.peerDid || '').slice(0, 1);
    const threadMessages = activeGroupConversation ? groupMessages : messages;

    return (
      <div className="page-container chat-thread-page">
        <header className="page-header">
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
          <Avatar src={avatar}>{avatarFallback}</Avatar>
          <div className="header-title-stack">
            <h1 className="header-title compact">{title}</h1>
            <Text type="secondary">
              {activeGroupConversation
                ? t('mobile.group.memberCount', { count: activeGroupConversation.group.memberCount })
                : peerTyping
                ? t('mobile.chat.typing')
                : activeConversation?.peerOnline
                  ? t('mobile.social.online')
                  : t('mobile.social.offline')}
            </Text>
          </div>
        </header>

        {!isGroupThread ? (
          <div className="chat-search-bar thread">
            <Input.Search
              value={threadSearchQuery}
              onChange={(event) => {
                setThreadSearchQuery(event.target.value);
                if (!event.target.value.trim()) clearMessageSearch();
              }}
              onSearch={(value) => searchMessages(value, activeConversation?.session.ulid ?? '')}
              prefix={<Search size={16} />}
              placeholder={t('mobile.chat.searchMessagesPlaceholder')}
              loading={messageSearchLoading}
              allowClear
            />
          </div>
        ) : null}

        {messageSearchError ? <Text type="danger" className="page-error">{formatSocialError(messageSearchError)}</Text> : null}

        {threadSearchQuery.trim() ? (
          <section className="message-search-panel">
            {messageSearchResults.length > 0 ? (
              messageSearchResults.map((message) => (
                <button className="message-search-result" type="button" key={message.ulid}>
                  <Text ellipsis>{message.content || t('mobile.chat.recalledMessage')}</Text>
                  <Text type="secondary">{formatRelativeTime(timestampMillis(message.sentAt ?? message.createdAt), t)}</Text>
                </button>
              ))
            ) : (
              <Text type="secondary">{t('mobile.chat.noMessageResults')}</Text>
            )}
          </section>
        ) : null}

        <section className="message-list">
          {threadMessages.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.emptyThread')} />
          ) : (
            threadMessages.map((message) => {
              const mine = message.senderDid === currentUserDid;
              const content = isGroupThread
                ? groupMessageDisplayText(projectGroupMessageDisplay(message as GroupMessage), t)
                : friendMessageDisplayText(message as FriendChatMessage, t);
              return (
                <div key={message.ulid} className={`message-bubble-row ${mine ? 'mine' : 'peer'}`}>
                  <div className="message-bubble">
                    <Text>{content}</Text>
                    <span className="message-meta">
                      {message.editedAt && !message.recalled ? <span>{t('mobile.chat.edited')}</span> : null}
                      {mine && !message.recalled && !isGroupThread && 'status' in message ? <span>{formatMessageStatus(message.status, t)}</span> : null}
                      <span>{formatRelativeTime(messageTimestampMillis(message, isGroupThread), t)}</span>
                    </span>
                    {mine && !message.recalled && !isGroupThread ? (
                      <span className="message-actions">
                        <button
                          type="button"
                          className="message-action-button"
                          aria-label={t('mobile.chat.edit')}
                          onClick={() => startEditMessage(message as FriendChatMessage)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="message-action-button"
                          aria-label={t('mobile.chat.recall')}
                          onClick={() => recallOwnMessage(message as FriendChatMessage)}
                        >
                          <RotateCcw size={13} />
                        </button>
                        <Popconfirm
                          title={t('mobile.chat.deleteConfirm')}
                          okText={t('common.action.delete')}
                          cancelText={t('common.action.cancel')}
                          onConfirm={() => deleteOwnMessage(message as FriendChatMessage)}
                        >
                          <button
                            type="button"
                            className="message-action-button"
                            aria-label={t('common.action.delete')}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Popconfirm>
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </section>

        {isGroupThread ? (
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
              value={draft}
              onChange={(event) => handleDraftChange(event.target.value)}
              onPressEnter={submitMessage}
              placeholder={t('mobile.chat.messagePlaceholder')}
            />
            <Button
              type="primary"
              icon={<Send size={16} />}
              disabled={!draft.trim()}
              onClick={submitMessage}
            />
          </footer>
        )}
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
              renderItem={(conversation) => (
                <List.Item className="conversation-item" onClick={() => openConversation(conversation)}>
                  <List.Item.Meta
                    avatar={
                      <Badge dot={conversation.kind === 'friend' ? conversation.conversation.peerOnline : false} color="green" offset={[-2, 28]}>
                        <Avatar src={conversationAvatar(conversation)}>{conversationTitle(conversation).slice(0, 1)}</Avatar>
                      </Badge>
                    }
                    title={
                      <span className="conversation-title-row">
                        <Text strong>{conversationTitle(conversation)}</Text>
                        {conversation.kind === 'group' ? <Users size={13} /> : null}
                      </span>
                    }
                    description={conversationPreview(conversation, t)}
                  />
                  <div className="conversation-meta">
                    <Text type="secondary">{formatRelativeTime(conversationUpdatedAt(conversation), t)}</Text>
                    {conversationUnread(conversation) > 0 ? <Badge count={conversationUnread(conversation)} /> : null}
                  </div>
                </List.Item>
              )}
            />
          )}
        </Spin>
      </section>
    </div>
  );
}

function formatMessageStatus(status: number, t: (key: string) => string): string {
  if (status >= MESSAGE_STATUS_READ) return t('mobile.chat.statusRead');
  if (status >= MESSAGE_STATUS_DELIVERED) return t('mobile.chat.statusDelivered');
  return t('mobile.chat.statusSent');
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
