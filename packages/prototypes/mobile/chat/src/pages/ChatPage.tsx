import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Icon, IconButton, Text, TextField } from '@peers-touch/ui';
import type { ChatListEvidenceState, Conversation, MobileUiEvidence } from '../types';
import { demoConversations } from '../data';
import copy from '../../../../../locales/en/common.json';
import { PrototypeListWindow } from '../components/PrototypeListWindow';
import type { PrototypeListMemory } from '../listPresentation';
import { IdentityAvatar } from '../components/IdentityAvatar';
import {
  ConversationListSkeleton,
  InlineSurfaceNotice,
  RouteSurfaceState,
} from '../components/MobileSurfaceState';

const conversationKey = (conversation: Conversation) => conversation.key;

export function ChatPage({ conversations = demoConversations, listMemory, uiEvidence, onConversationClick, onCompose }: {
  conversations?: Conversation[];
  listMemory: PrototypeListMemory;
  uiEvidence: MobileUiEvidence;
  onConversationClick: (conv: Conversation) => void;
  onCompose?: () => void;
}) {
  const [localState, setLocalState] = useState<ChatListEvidenceState>(uiEvidence.chatListState);
  const [query, setQuery] = useState('');
  const recoveryTimer = useRef<number | null>(null);

  useEffect(() => {
    setLocalState(uiEvidence.chatListState);
  }, [uiEvidence.chatListState]);

  useEffect(() => () => {
    if (recoveryTimer.current !== null) window.clearTimeout(recoveryTimer.current);
  }, []);

  function getPreview(conv: Conversation): string {
    if (conv.isGroup && conv.lastSender) return `${conv.lastSender}: ${conv.lastMessage}`;
    return conv.lastMessage || copy['mobile.chat.emptyThread'];
  }

  function handleRetry() {
    setLocalState('refreshing');
    recoveryTimer.current = window.setTimeout(() => setLocalState('ready'), 800);
  }

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter((conv) => !q
      || conv.name.toLowerCase().includes(q)
      || conv.lastMessage.toLowerCase().includes(q));
  }, [conversations, query]);

  const visibleConversations = localState === 'empty' ? [] : filteredConversations;

  return (
    <div className="mp-page" data-prototype-page="chats">
      <header className="mp-header">
        <h1 className="mp-header-title">Chats</h1>
        {onCompose && (
          <IconButton actionId="chat.compose" iconId="message-square-plus" label="New chat" emphasis="quiet"
            onActivate={onCompose} />
        )}
      </header>

      <div className="mp-search-well">
        <TextField
          aria-label="Search conversations"
          placeholder={copy['mobile.contacts.searchPlaceholder'] === undefined ? 'Search' : 'Search conversations'}
          value={query}
          clearable
          onClear={() => setQuery('')}
          leading={<Icon iconId="search" size={16} />}
          onValueChange={setQuery}
        />
      </div>

      <div className="mp-list-panel">
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
            icon={<Icon iconId="message-circle" size={22} />}
            title={copy['mobile.chat.emptyTitle']}
            detail={copy['mobile.chat.emptySubtitle']}
          />
        )}
        {localState !== 'initial-loading' && localState !== 'empty' && (
          <PrototypeListWindow items={visibleConversations} itemKey={conversationKey}
            surfaceKey="conversations" memory={listMemory}>
            {(window) => window.map((conv) => (
              <div className="mp-conversation-item" key={conv.key} data-scroll-anchor-id={conv.key}
                role="button" tabIndex={0} onClick={() => onConversationClick(conv)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onConversationClick(conv);
                  }
                }}>
                <IdentityAvatar
                  name={conv.name}
                  initials={conv.avatar}
                  src={conv.avatarUrl}
                  kind={conv.isGroup ? 'group' : 'person'}
                  online={conv.online}
                  showPresence={!conv.isGroup}
                  renderState={uiEvidence.avatarState}
                />
                <span className="mp-conv-content">
                  <span className="mp-conv-title-row">
                    <Text strong truncate>{conv.name}</Text>
                    <span className="mp-conv-flags" aria-label={[
                      conv.pinned ? 'Pinned' : '',
                      conv.muted ? 'Muted' : '',
                    ].filter(Boolean).join(', ')}>
                      {conv.pinned && <Icon iconId="pin" size={12} />}
                      {conv.muted && <Icon iconId="bell-off" size={12} />}
                    </span>
                  </span>
                  <span className="mp-conv-preview">{getPreview(conv)}</span>
                </span>
                <div className="mp-conv-meta">
                  <Text tone="muted" className="mp-conv-time">{conv.time}</Text>
                  {conv.unread > 0 && <Badge count={conv.unread} />}
                </div>
              </div>
            ))}
          </PrototypeListWindow>
        )}
      </div>
    </div>
  );
}
