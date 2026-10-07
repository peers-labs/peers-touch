import type { CSSProperties, ReactNode } from 'react';
import { Badge, Empty, Input, List, Spin, Typography } from 'antd';
import { BellOff, Pencil, Pin, Search, Users } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList } from '../../components/BoundedList';
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';
import {
  conversationAvatar,
  conversationPreview,
  conversationTitle,
  formatRelativeTime,
  type ConversationListProjection,
  type MobileConversation,
} from '../../features/chat/chatSelectors';
import type { ChatInputPanelState } from './chatBottomOcclusion';

const { Text } = Typography;
const CONVERSATION_WINDOW_SIZE = 100;

export function ChatThreadPageContent({
  activeInputPanel,
  children,
  keyboardOverlapHeight,
  style,
  tabBarVisible,
}: {
  readonly activeInputPanel: ChatInputPanelState;
  readonly children: ReactNode;
  readonly keyboardOverlapHeight: number;
  readonly style: CSSProperties;
  readonly tabBarVisible: boolean;
}) {
  return (
    <div
      className="page-container chat-thread-page"
      data-chat-input-panel={activeInputPanel}
      data-chat-keyboard-overlap={keyboardOverlapHeight}
      data-chat-tabbar-visible={tabBarVisible}
      style={style}
    >
      {children}
    </div>
  );
}

interface ChatConversationListPageContentProps {
  readonly query: string;
  readonly items: ConversationListProjection['surfaceItems'];
  readonly conversationCount: number;
  readonly loading: boolean;
  readonly localError: string;
  readonly socialError: string;
  readonly groupError: string;
  readonly onQueryChange: (query: string) => void;
  readonly onDismissLocalError: () => void;
  readonly onDismissSocialError: () => void;
  readonly onDismissGroupError: () => void;
  readonly onOpenConversation: (conversation: MobileConversation) => void;
}

export function ChatConversationListPageContent({
  query,
  items,
  conversationCount,
  loading,
  localError,
  socialError,
  groupError,
  onQueryChange,
  onDismissLocalError,
  onDismissSocialError,
  onDismissGroupError,
  onOpenConversation,
}: ChatConversationListPageContentProps) {
  const { t } = useMobileI18n();

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="header-title">{t('mobile.chat.title')}</h1>
        <button type="button" className="header-action" aria-label={t('mobile.chat.moreActions')}>
          <Pencil size={20} />
        </button>
      </header>

      <div className="chat-search-bar">
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          prefix={<Search size={16} color="#9ca0ab" />}
          placeholder={t('mobile.chat.searchPlaceholder')}
          allowClear
        />
      </div>

      {localError ? <MobileNotice onClose={onDismissLocalError}>{localError}</MobileNotice> : null}
      {socialError ? <MobileNotice onClose={onDismissSocialError}>{socialError}</MobileNotice> : null}
      {groupError ? <MobileNotice onClose={onDismissGroupError}>{groupError}</MobileNotice> : null}

      <section className="social-list-panel">
        <Spin spinning={loading && items.length === 0}>
          {items.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={conversationCount > 0 ? t('mobile.chat.noSearchResults') : (
                <div className="empty-copy">
                  <Text strong>{t('mobile.chat.emptyTitle')}</Text>
                  <Text type="secondary">{t('mobile.chat.emptySubtitle')}</Text>
                </div>
              )}
            />
          ) : (
            <BoundedList
              surfaceKey={`conversations:${query}`}
              items={items}
              itemKey={(item) => (item.conversation as MobileConversation).key}
              size={CONVERSATION_WINDOW_SIZE}
            >
              {(rows) => (
                <List
                  dataSource={rows}
                  rowKey={(item) => (item.conversation as MobileConversation).key}
                  renderItem={(item) => {
                    const conversation = item.conversation as MobileConversation;
                    const {
                      preference: preferenceState,
                      updatedAt,
                      visibleUnread,
                    } = item;
                    return (
                      <List.Item
                        className="conversation-item"
                        data-scroll-anchor-id={conversation.key}
                        data-focus-id={conversation.key}
                        tabIndex={0}
                        role="button"
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onOpenConversation(conversation);
                          }
                        }}
                        data-conversation-id={conversation.kind === 'friend'
                          ? conversation.conversation.session.ulid
                          : conversation.conversation.projection.conversationId}
                        data-conversation-kind={conversation.kind}
                        onClick={() => onOpenConversation(conversation)}
                      >
                        <List.Item.Meta
                          avatar={(
                            <span className="conversation-avatar-frame">
                              <MobileAvatar src={conversationAvatar(conversation)}>
                                {conversationTitle(conversation).slice(0, 1)}
                              </MobileAvatar>
                              {conversation.kind === 'friend' && conversation.conversation.peerOnline
                                ? <span className="conversation-online-dot" aria-hidden="true" />
                                : null}
                            </span>
                          )}
                          title={(
                            <span className="conversation-title-row">
                              {preferenceState?.sticky ? <Pin size={12} className="conversation-state-icon" /> : null}
                              <Text strong>{conversationTitle(conversation)}</Text>
                              {conversation.kind === 'group' ? <Users size={12} className="conversation-state-icon" /> : null}
                              {preferenceState?.muted ? <BellOff size={12} className="conversation-state-icon" /> : null}
                            </span>
                          )}
                          description={<span className="conversation-preview">{conversationPreview(conversation, t)}</span>}
                        />
                        <div className="conversation-meta">
                          <Text type="secondary" className="conversation-time">{formatRelativeTime(updatedAt, t)}</Text>
                          {visibleUnread > 0 ? <Badge count={visibleUnread} className="conversation-badge" /> : null}
                        </div>
                      </List.Item>
                    );
                  }}
                />
              )}
            </BoundedList>
          )}
        </Spin>
      </section>
    </div>
  );
}
