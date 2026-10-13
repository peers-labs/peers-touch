import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Input, List, Typography } from 'antd';
import { MessageCircle, Pencil, Search } from 'lucide-react';
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

const { Text } = Typography;
const conversationKey = (conversation: Conversation) => conversation.key;

export function ChatPage({ conversations = demoConversations, listMemory, uiEvidence, onConversationClick }: {
  conversations?: Conversation[];
  listMemory: PrototypeListMemory;
  uiEvidence: MobileUiEvidence;
  onConversationClick: (conv: Conversation) => void;
}) {
  const [searchQuery, setSearchQuery] = useState(() => listMemory.read('chat-query')?.query ?? '');
  const [localState, setLocalState] = useState<ChatListEvidenceState>(uiEvidence.chatListState);
  const recoveryTimer = useRef<number | null>(null);

  useEffect(() => {
    setLocalState(uiEvidence.chatListState);
  }, [uiEvidence.chatListState]);

  useEffect(() => () => {
    if (recoveryTimer.current !== null) window.clearTimeout(recoveryTimer.current);
  }, []);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter(
      (conv) => conv.name.toLowerCase().includes(q) || conv.lastMessage.toLowerCase().includes(q),
    );
  }, [conversations, searchQuery]);

  function getPreview(conv: Conversation): string {
    if (conv.isGroup && conv.lastSender) return `${conv.lastSender}: ${conv.lastMessage}`;
    return conv.lastMessage || copy['mobile.chat.emptyThread'];
  }

  function handleRetry() {
    setLocalState('refreshing');
    recoveryTimer.current = window.setTimeout(() => setLocalState('ready'), 800);
  }

  const visibleConversations = localState === 'empty' ? [] : filteredConversations;

  return (
    <div className="mp-page" data-prototype-page="chats">
      <header className="mp-header">
        <h1 className="mp-header-title">Chats</h1>
        <button type="button" className="mp-header-action" aria-label="Compose">
          <Pencil size={20} />
        </button>
      </header>

      <div className="mp-search-bar">
        <Input
          prefix={<Search size={16} className="mp-search-icon" />}
          placeholder="Search conversations"
          allowClear
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            listMemory.save('chat-query', { query: e.target.value });
          }}
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
            icon={<MessageCircle size={22} />}
            title={copy['mobile.chat.emptyTitle']}
            detail={copy['mobile.chat.emptySubtitle']}
          />
        )}
        {localState !== 'initial-loading' && localState !== 'empty' && (
        <PrototypeListWindow items={visibleConversations} itemKey={conversationKey}
          surfaceKey={`conversations:${searchQuery.trim().toLowerCase()}`} memory={listMemory}>
          {(window) => (
        <List
          rowKey="key"
          dataSource={window}
          locale={{ emptyText: copy['mobile.chat.noSearchResults'] }}
          renderItem={(conv) => (
            <List.Item className="mp-conversation-item" data-scroll-anchor-id={conv.key}
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
                  <Text strong ellipsis>{conv.name}</Text>
                  {(conv.isGroup || conv.pinned || conv.muted) && (
                    <span className="mp-conv-relationship">
                      {[
                        conv.isGroup ? `${conv.memberCount ?? ''} member group` : '',
                        conv.pinned ? 'Pinned' : '',
                        conv.muted ? 'Muted' : '',
                      ].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="mp-conv-preview">{getPreview(conv)}</span>
              </span>
              <div className="mp-conv-meta">
                <Text type="secondary" className="mp-conv-time">{conv.time}</Text>
                {conv.unread > 0 && <Badge count={conv.unread} className="mp-conv-badge" />}
              </div>
            </List.Item>
          )}
        />
          )}
        </PrototypeListWindow>
        )}
      </div>
    </div>
  );
}
