import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Input, Typography } from 'antd';
import { History, MessageCircle, Search, X } from 'lucide-react';
import type { ChatListEvidenceState, Conversation, MobileUiEvidence } from '../types';
import { demoContacts, demoConversations } from '../data';
import copy from '../../../../../locales/en/common.json';
import { PrototypeListWindow } from '../components/PrototypeListWindow';
import {
  addRecentSearch,
  removeRecentSearch,
  type PrototypeListMemory,
} from '../listPresentation';
import { IdentityAvatar } from '../components/IdentityAvatar';
import {
  ConversationListSkeleton,
  InlineSurfaceNotice,
  RouteSurfaceState,
} from '../components/MobileSurfaceState';
import { AccessibleClearIcon } from '../components/AccessibleClearIcon';

const { Text } = Typography;
const conversationKey = (conversation: Conversation) => conversation.key;

export function ChatPage({ conversations = demoConversations, listMemory, uiEvidence, onConversationClick }: {
  conversations?: Conversation[];
  listMemory: PrototypeListMemory;
  uiEvidence: MobileUiEvidence;
  onConversationClick: (conv: Conversation) => void;
}) {
  const [searchQuery, setSearchQuery] = useState(() => listMemory.read('chat-query')?.query ?? '');
  const [searchOpen, setSearchOpen] = useState(() => listMemory.read('chat-query')?.open ?? false);
  const [searchHistory, setSearchHistory] = useState(
    () => listMemory.read('chat-query')?.history ?? [],
  );
  const [localState, setLocalState] = useState<ChatListEvidenceState>(uiEvidence.chatListState);
  const recoveryTimer = useRef<number | null>(null);

  useEffect(() => {
    setLocalState(uiEvidence.chatListState);
  }, [uiEvidence.chatListState]);

  useEffect(() => () => {
    if (recoveryTimer.current !== null) window.clearTimeout(recoveryTimer.current);
  }, []);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const peopleResults = useMemo(() => (
    normalizedQuery
      ? demoContacts.filter((contact) => (
        contact.name.toLowerCase().includes(normalizedQuery)
        || contact.note.toLowerCase().includes(normalizedQuery)
        || contact.key.toLowerCase().includes(normalizedQuery)
      ))
      : []
  ), [normalizedQuery]);
  const conversationResults = useMemo(() => (
    normalizedQuery
      ? conversations.filter((conversation) => (
        conversation.name.toLowerCase().includes(normalizedQuery)
        || conversation.lastMessage.toLowerCase().includes(normalizedQuery)
      ))
      : []
  ), [conversations, normalizedQuery]);
  const messageResults = useMemo(() => (
    normalizedQuery
      ? conversations.filter((conversation) => conversation.lastMessage.toLowerCase().includes(normalizedQuery))
      : []
  ), [conversations, normalizedQuery]);

  function getPreview(conv: Conversation): string {
    if (conv.isGroup && conv.lastSender) return `${conv.lastSender}: ${conv.lastMessage}`;
    return conv.lastMessage || copy['mobile.chat.emptyThread'];
  }

  function handleRetry() {
    setLocalState('refreshing');
    recoveryTimer.current = window.setTimeout(() => setLocalState('ready'), 800);
  }

  const visibleConversations = localState === 'empty' ? [] : conversations;

  function persistSearch(query: string, open: boolean, history: string[]) {
    listMemory.save('chat-query', { query, open, history });
  }

  function commitSearch(query = searchQuery) {
    const history = addRecentSearch(searchHistory, query);
    setSearchHistory(history);
    persistSearch(query, true, history);
  }

  function useRecentSearch(query: string) {
    const history = addRecentSearch(searchHistory, query);
    setSearchQuery(query);
    setSearchHistory(history);
    persistSearch(query, true, history);
  }

  function deleteRecentSearch(query: string) {
    const history = removeRecentSearch(searchHistory, query);
    setSearchHistory(history);
    persistSearch(searchQuery, true, history);
  }

  function clearSearchHistory() {
    setSearchHistory([]);
    persistSearch(searchQuery, true, []);
  }

  function openPersonConversation(contact: (typeof demoContacts)[number]) {
    const existing = conversations.find((conversation) => conversation.key === contact.key);
    onConversationClick(existing ?? {
      key: `demo-direct-${contact.key}`,
      name: contact.name,
      avatar: contact.avatar,
      avatarUrl: contact.avatarUrl,
      avatarGradient: contact.avatarGradient,
      lastMessage: '',
      time: '',
      unread: 0,
      online: contact.online,
    });
  }

  function renderConversationWindow(
    items: Conversation[],
    surfaceKey: string,
    onSelect: (conversation: Conversation) => void = onConversationClick,
  ) {
    return (
      <PrototypeListWindow
        items={items}
        itemKey={conversationKey}
        surfaceKey={surfaceKey}
        memory={listMemory}
      >
        {(window) => (
          <div className="mp-conversation-list">
            {window.map((conversation) => (
              <div
                key={conversation.key}
                className="mp-conversation-item"
                data-scroll-anchor-id={conversation.key}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(conversation)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(conversation);
                  }
                }}
              >
                <IdentityAvatar
                  name={conversation.name}
                  initials={conversation.avatar}
                  src={conversation.avatarUrl}
                  kind={conversation.isGroup ? 'group' : 'person'}
                  online={conversation.online}
                  showPresence={!conversation.isGroup}
                  renderState={uiEvidence.avatarState}
                />
                <span className="mp-conv-content">
                  <span className="mp-conv-title-row">
                    <Text strong ellipsis>{conversation.name}</Text>
                    {(conversation.isGroup || conversation.pinned || conversation.muted) && (
                      <span className="mp-conv-relationship">
                        {[
                          conversation.isGroup ? `${conversation.memberCount ?? ''} member group` : '',
                          conversation.pinned ? 'Pinned' : '',
                          conversation.muted ? 'Muted' : '',
                        ].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span className="mp-conv-preview">{getPreview(conversation)}</span>
                </span>
                <div className="mp-conv-meta">
                  <Text type="secondary" className="mp-conv-time">{conversation.time}</Text>
                  {conversation.unread > 0 && <Badge count={conversation.unread} className="mp-conv-badge" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </PrototypeListWindow>
    );
  }

  return (
    <div className="mp-page" data-prototype-page="chats">
      <header className="mp-header">
        <h1 className="mp-header-title">Chats</h1>
        <button
          type="button"
          className={`mp-header-action ${searchOpen ? 'active' : ''}`}
          aria-label={searchOpen ? copy['mobile.chat.search.close'] : copy['mobile.chat.search.open']}
          aria-expanded={searchOpen}
          onClick={() => setSearchOpen((current) => {
            const next = !current;
            persistSearch(searchQuery, next, searchHistory);
            return next;
          })}
        >
          {searchOpen ? <X size={20} /> : <Search size={20} />}
        </button>
      </header>

      {searchOpen && (
        <section className="mp-chat-search-surface" aria-label={copy['mobile.chat.search.open']}>
          <div className="mp-search-bar">
            <Input
              autoFocus
              aria-label={copy['mobile.chat.search.allPlaceholder']}
              prefix={<Search size={16} className="mp-search-icon" />}
              placeholder={copy['mobile.chat.search.allPlaceholder']}
              allowClear={{
                clearIcon: <AccessibleClearIcon label={copy['mobile.chat.search.clear']} />,
              }}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                persistSearch(event.target.value, true, searchHistory);
              }}
              onPressEnter={() => commitSearch()}
            />
          </div>
          <div className="mp-chat-search-results" aria-live="polite">
            {!normalizedQuery && searchHistory.length === 0 && (
              <div className="mp-chat-search-prompt">
                <Search size={20} />
                <Text type="secondary">{copy['mobile.chat.search.prompt']}</Text>
              </div>
            )}
            {!normalizedQuery && searchHistory.length > 0 && (
              <section className="mp-chat-search-history" data-chat-search-history>
                <header className="mp-chat-search-history-header">
                  <h2>{copy['mobile.chat.search.recent']}</h2>
                  <button type="button" onClick={clearSearchHistory}>
                    {copy['mobile.chat.search.clearHistory']}
                  </button>
                </header>
                <div className="mp-chat-search-history-list">
                  {searchHistory.map((query) => (
                    <div key={query.toLocaleLowerCase()} className="mp-chat-search-history-row">
                      <button
                        type="button"
                        className="mp-chat-search-history-query"
                        onClick={() => useRecentSearch(query)}
                      >
                        <History size={16} aria-hidden="true" />
                        <span>{query}</span>
                      </button>
                      <button
                        type="button"
                        className="mp-chat-search-history-delete"
                        aria-label={copy['mobile.chat.search.deleteHistory']
                          .replace('{{query}}', query)}
                        onClick={() => deleteRecentSearch(query)}
                      >
                        <X size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {normalizedQuery && peopleResults.length > 0 && (
              <section className="mp-chat-search-section" data-chat-search-kind="people">
                <h2>{copy['mobile.chat.search.people']} <span>{peopleResults.length}</span></h2>
                <div className="mp-chat-search-people">
                  {peopleResults.map((contact) => (
                    <button
                      key={contact.key}
                      type="button"
                      className="mp-chat-search-person"
                      onClick={() => {
                        commitSearch();
                        openPersonConversation(contact);
                      }}
                    >
                      <IdentityAvatar
                        name={contact.name}
                        initials={contact.avatar}
                        src={contact.avatarUrl}
                        size={40}
                        online={contact.online}
                        showPresence
                        renderState={uiEvidence.avatarState}
                      />
                      <span>
                        <Text strong>{contact.name}</Text>
                        <Text type="secondary">{contact.note}</Text>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {normalizedQuery && conversationResults.length > 0 && (
              <section className="mp-chat-search-section" data-chat-search-kind="conversations">
                <h2>
                  {copy['mobile.chat.search.conversations']} <span>{conversationResults.length}</span>
                </h2>
                {renderConversationWindow(
                  conversationResults,
                  `conversations:${normalizedQuery}`,
                  (conversation) => {
                    commitSearch();
                    onConversationClick(conversation);
                  },
                )}
              </section>
            )}
            {normalizedQuery && messageResults.length > 0 && (
              <section className="mp-chat-search-section" data-chat-search-kind="messages">
                <h2>{copy['mobile.chat.search.messages']} <span>{messageResults.length}</span></h2>
                <div className="mp-chat-message-results">
                  {messageResults.slice(0, 20).map((conversation) => (
                    <button
                      key={conversation.key}
                      type="button"
                      className="mp-chat-message-result"
                      onClick={() => {
                        commitSearch();
                        onConversationClick(conversation);
                      }}
                    >
                      <IdentityAvatar
                        name={conversation.name}
                        initials={conversation.avatar}
                        src={conversation.avatarUrl}
                        kind={conversation.isGroup ? 'group' : 'person'}
                        size={36}
                        renderState={uiEvidence.avatarState}
                      />
                      <span>
                        <Text strong>{conversation.name}</Text>
                        <Text type="secondary">{conversation.lastMessage}</Text>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {normalizedQuery
              && peopleResults.length === 0
              && conversationResults.length === 0
              && messageResults.length === 0 && (
              <div className="mp-conversation-empty">{copy['mobile.chat.search.noResults']}</div>
            )}
          </div>
        </section>
      )}

      {!searchOpen && <div className="mp-list-panel">
        {localState === 'initial-loading' && <ConversationListSkeleton />}
        {localState === 'refreshing' && (
          <InlineSurfaceNotice
            title="Refreshing conversations"
            detail="Cached conversations stay available while Peers reconciles updates."
          />
        )}
        {localState === 'cached-error' && (
          <InlineSurfaceNotice
            tone="error"
            title="Could not refresh conversations"
            detail="Showing the most recent conversations stored on this device."
            actionLabel="Retry"
            onAction={handleRetry}
          />
        )}
        {localState === 'empty' && (
          <RouteSurfaceState
            icon={<MessageCircle size={22} />}
            title={copy['mobile.chat.emptyTitle']}
            detail={copy['mobile.chat.emptySubtitle']}
          />
        )}
        {localState !== 'initial-loading' && localState !== 'empty' && (
          renderConversationWindow(visibleConversations, 'conversations:all')
        )}
      </div>}
    </div>
  );
}
