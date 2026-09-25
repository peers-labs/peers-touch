import { useMemo, useState } from 'react';
import { Avatar, Badge, Input, List, Typography } from 'antd';
import { BellOff, Pencil, Pin, Search, Users } from 'lucide-react';
import type { Conversation } from '../types';
import { demoConversations } from '../data';
import copy from '../../../../../locales/en/common.json';
import { PrototypeListWindow } from '../components/PrototypeListWindow';
import type { PrototypeListMemory } from '../listPresentation';

const { Text } = Typography;
const conversationKey = (conversation: Conversation) => conversation.key;

export function ChatPage({ conversations = demoConversations, listMemory, onConversationClick }: {
  conversations?: Conversation[];
  listMemory: PrototypeListMemory;
  onConversationClick: (conv: Conversation) => void;
}) {
  const [searchQuery, setSearchQuery] = useState(() => listMemory.read('chat-query')?.query ?? '');

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
          prefix={<Search size={16} color="#9ca0ab" />}
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
        <PrototypeListWindow items={filteredConversations} itemKey={conversationKey}
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
              <List.Item.Meta
                avatar={
                  <span className="mp-avatar-frame">
                    <Avatar style={{ background: conv.avatarGradient, borderRadius: 14 }}>{conv.avatar}</Avatar>
                    {conv.online && <span className="mp-online-dot" />}
                  </span>
                }
                title={
                  <span className="mp-conv-title-row">
                    {conv.pinned && <Pin size={12} className="mp-conv-pin" />}
                    <Text strong>{conv.name}</Text>
                    {conv.isGroup && <Users size={12} className="mp-conv-group-icon" />}
                    {conv.muted && <BellOff size={12} className="mp-conv-muted" />}
                  </span>
                }
                description={<span className="mp-conv-preview">{getPreview(conv)}</span>}
              />
              <div className="mp-conv-meta">
                <Text type="secondary" className="mp-conv-time">{conv.time}</Text>
                {conv.unread > 0 && <Badge count={conv.unread} className="mp-conv-badge" />}
              </div>
            </List.Item>
          )}
        />
          )}
        </PrototypeListWindow>
      </div>
    </div>
  );
}
