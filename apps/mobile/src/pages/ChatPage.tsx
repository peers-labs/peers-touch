import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Empty, Input, List, Popconfirm, Spin, Typography } from 'antd';
import { ArrowLeft, Pencil, RefreshCw, RotateCcw, Search, Send, Trash2, X } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import logo from '../assets/logo.png';
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
const EMPTY_TYPING_PEERS: Record<string, TypingEntry> = {};

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
  const reconcile = useSocialStore((state) => state.reconcile);
  const selectSession = useSocialStore((state) => state.selectSession);
  const sendMessage = useSocialStore((state) => state.sendMessage);
  const editMessage = useSocialStore((state) => state.editMessage);
  const recallMessage = useSocialStore((state) => state.recallMessage);
  const deleteMessage = useSocialStore((state) => state.deleteMessage);
  const sendTypingState = useSocialStore((state) => state.sendTypingState);
  const searchMessages = useSocialStore((state) => state.searchMessages);
  const clearMessageSearch = useSocialStore((state) => state.clearMessageSearch);
  const lastTypingPulseRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const conversations = useSocialStore(selectSocialConversations);
  const filteredConversations = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter((conversation) =>
      `${conversation.peerName} ${conversation.peerDid} ${conversation.lastMessage?.content ?? ''}`.toLowerCase().includes(query),
    );
  }, [conversationQuery, conversations]);

  const activeConversation = conversations.find((conversation) => conversation.session.ulid === activeSessionUlid);
  const peerTyping = activeConversation ? Boolean(typingPeers[activeConversation.peerDid]?.typing) : false;

  useEffect(() => {
    return () => {
      if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setThreadSearchQuery('');
    clearMessageSearch();
  }, [activeSessionUlid, clearMessageSearch]);

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

  if (activeConversation) {
    return (
      <div className="page-container chat-thread-page">
        <header className="page-header">
          <button className="header-action" type="button" onClick={() => selectSession(null)} aria-label={t('common.action.back')}>
            <ArrowLeft size={20} />
          </button>
          <Avatar src={activeConversation.peerAvatar}>{activeConversation.peerName.slice(0, 1)}</Avatar>
          <div className="header-title-stack">
            <h1 className="header-title compact">{activeConversation.peerName}</h1>
            <Text type="secondary">
              {peerTyping
                ? t('mobile.chat.typing')
                : activeConversation.peerOnline
                  ? t('mobile.social.online')
                  : t('mobile.social.offline')}
            </Text>
          </div>
        </header>

        <div className="chat-search-bar thread">
          <Input.Search
            value={threadSearchQuery}
            onChange={(event) => {
              setThreadSearchQuery(event.target.value);
              if (!event.target.value.trim()) clearMessageSearch();
            }}
            onSearch={(value) => searchMessages(value, activeConversation.session.ulid)}
            prefix={<Search size={16} />}
            placeholder={t('mobile.chat.searchMessagesPlaceholder')}
            loading={messageSearchLoading}
            allowClear
          />
        </div>

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
          {messages.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.emptyThread')} />
          ) : (
            messages.map((message) => {
              const mine = message.senderDid === currentUserDid;
              return (
                <div key={message.ulid} className={`message-bubble-row ${mine ? 'mine' : 'peer'}`}>
                  <div className="message-bubble">
                    <Text>{message.recalled ? t('mobile.chat.recalledMessage') : message.content}</Text>
                    <span className="message-meta">
                      {message.editedAt && !message.recalled ? <span>{t('mobile.chat.edited')}</span> : null}
                      {mine && !message.recalled ? <span>{formatMessageStatus(message.status, t)}</span> : null}
                      <span>{formatRelativeTime(timestampMillis(message.sentAt ?? message.createdAt), t)}</span>
                    </span>
                    {mine && !message.recalled ? (
                      <span className="message-actions">
                        <button
                          type="button"
                          className="message-action-button"
                          aria-label={t('mobile.chat.edit')}
                          onClick={() => startEditMessage(message)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="message-action-button"
                          aria-label={t('mobile.chat.recall')}
                          onClick={() => recallOwnMessage(message)}
                        >
                          <RotateCcw size={13} />
                        </button>
                        <Popconfirm
                          title={t('mobile.chat.deleteConfirm')}
                          okText={t('common.action.delete')}
                          cancelText={t('common.action.cancel')}
                          onConfirm={() => deleteOwnMessage(message)}
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

      <section className="social-list-panel">
        <Spin spinning={loading}>
          {filteredConversations.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                conversations.length > 0
                  ? t('mobile.chat.noSearchResults')
                  : (
                    <div className="empty-copy">
                      <Text strong>{t('mobile.chat.emptyTitle')}</Text>
                      <Text type="secondary">{t('mobile.chat.emptySubtitle')}</Text>
                    </div>
                  )
              }
            >
              {conversations.length === 0 ? (
                <Button icon={<RefreshCw size={16} />} onClick={reconcile}>
                  {t('mobile.chat.refresh')}
                </Button>
              ) : null}
            </Empty>
          ) : (
            <List
              dataSource={filteredConversations}
              renderItem={(conversation) => (
                <List.Item className="conversation-item" onClick={() => selectSession(conversation.session.ulid)}>
                  <List.Item.Meta
                    avatar={
                      <Badge dot={conversation.peerOnline} color="green" offset={[-2, 28]}>
                        <Avatar src={conversation.peerAvatar}>{conversation.peerName.slice(0, 1)}</Avatar>
                      </Badge>
                    }
                    title={<Text strong>{conversation.peerName}</Text>}
                    description={conversation.lastMessage?.content || t('mobile.chat.noPreview')}
                  />
                  <div className="conversation-meta">
                    <Text type="secondary">{formatRelativeTime(timestampMillis(conversation.session.lastMessageAt), t)}</Text>
                    {conversation.unread > 0 ? <Badge count={conversation.unread} /> : null}
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
