import type { CSSProperties, ReactNode } from 'react';
import { Badge, Button, Empty, Icon, Spin, TextField } from '@peers-touch/ui';

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

const CONVERSATION_WINDOW_SIZE = 100;

export function ChatThreadPageContent({
  activeInputPanel,
  children,
  keyboardOverlapHeight,
  productSurface,
  style,
  tabBarVisible,
}: {
  readonly activeInputPanel: ChatInputPanelState;
  readonly children: ReactNode;
  readonly keyboardOverlapHeight: number;
  readonly productSurface?: string;
  readonly style: CSSProperties;
  readonly tabBarVisible: boolean;
}) {
  return (
    <div
      className="page-container chat-thread-page"
      data-chat-input-panel={activeInputPanel}
      data-chat-keyboard-open={keyboardOverlapHeight > 0}
      data-chat-keyboard-overlap={keyboardOverlapHeight}
      data-chat-tabbar-visible={tabBarVisible}
      data-product-surface={productSurface}
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
  readonly onStartConversation: () => void;
  readonly onOpenConversation: (conversation: MobileConversation) => void;
  readonly searchEntry?: ReactNode;
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
  onStartConversation,
  onOpenConversation,
  searchEntry,
}: ChatConversationListPageContentProps) {
  const { t } = useMobileI18n();
  const productSurface = loading && items.length === 0
    ? 'chat.list-loading'
    : localError || socialError || groupError
      ? 'chat.list-error'
      : query.trim() && items.length === 0
        ? 'chat.list-search-empty'
        : query.trim()
          ? 'chat.list-search'
          : items.length === 0
            ? 'chat.list-empty'
            : 'chat.list';

  return (
    <div className="page-container" data-product-surface={productSurface}>
      <header className="page-header">
        <h1 className="header-title">{t('mobile.chat.title')}</h1>
        {searchEntry}
        <button
          type="button"
          className="header-action"
          aria-label={t('mobile.chat.startConversation')}
          onClick={onStartConversation}
        >
          <Icon iconId="pen-line" size={20} />
        </button>
      </header>

      <div className="chat-search-bar">
        <TextField
          className="chat-search-field"
          value={query}
          onValueChange={onQueryChange}
          leading={<Icon iconId="search" size={16} className="chat-search-leading" />}
          placeholder={t('mobile.chat.searchPlaceholder')}
          clearable
          onClear={() => onQueryChange('')}
          aria-label={t('mobile.chat.searchPlaceholder')}
        />
      </div>

      {localError ? <MobileNotice onClose={onDismissLocalError}>{localError}</MobileNotice> : null}
      {socialError ? <MobileNotice onClose={onDismissSocialError}>{socialError}</MobileNotice> : null}
      {groupError ? <MobileNotice onClose={onDismissGroupError}>{groupError}</MobileNotice> : null}

      <section className="social-list-panel">
        <Spin active={loading && items.length === 0}>
          {items.length === 0 ? (
            <Empty
              className="chat-list-empty"
              description={conversationCount > 0 ? t('mobile.chat.noSearchResults') : (
                <div className="empty-copy">
                  <strong>{t('mobile.chat.emptyTitle')}</strong>
                  <span>{t('mobile.chat.emptySubtitle')}</span>
                  <Button
                    actionId="chat.start-conversation"
                    emphasis="primary"
                    leading={<Icon iconId="pen-line" size={16} />}
                    onActivate={onStartConversation}
                  >
                    {t('mobile.chat.startConversation')}
                  </Button>
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
                <div className="conversation-list">
                  {rows.map((item) => {
                    const conversation = item.conversation as MobileConversation;
                    const {
                      preference: preferenceState,
                      updatedAt,
                      visibleUnread,
                    } = item;
                    return (
                      <div
                        key={conversation.key}
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
                        <span className="conversation-row">
                          <span className="conversation-avatar-frame">
                            <MobileAvatar src={conversationAvatar(conversation)} size={48}>
                              {conversationTitle(conversation).slice(0, 1)}
                            </MobileAvatar>
                            {conversation.kind === 'friend' && conversation.conversation.peerOnline
                              ? <span className="conversation-online-dot" aria-hidden="true" />
                              : null}
                          </span>
                          <span className="conversation-body">
                            <span className="conversation-title-row">
                              {preferenceState?.sticky ? <Icon iconId="pin" size={12} className="conversation-state-icon" /> : null}
                              <strong>{conversationTitle(conversation)}</strong>
                              {conversation.kind === 'group' ? <Icon iconId="users" size={12} className="conversation-state-icon" /> : null}
                              {preferenceState?.muted ? <Icon iconId="bell-off" size={12} className="conversation-state-icon" /> : null}
                            </span>
                            <span className="conversation-preview">{conversationPreview(conversation, t)}</span>
                          </span>
                          <span className="conversation-meta">
                            <span className="conversation-time">{formatRelativeTime(updatedAt, t)}</span>
                            {visibleUnread > 0 ? <Badge count={visibleUnread} className="conversation-badge" /> : null}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </BoundedList>
          )}
        </Spin>
      </section>
    </div>
  );
}
