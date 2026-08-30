import { useMemo, useState } from 'react';
import { Avatar, Badge, Input, List, Typography } from 'antd';
import { BellOff, Pencil, Pin, Search, Users } from 'lucide-react';
import type { Conversation } from '../types';
import { demoConversations } from '../data';

const { Text } = Typography;

export function ChatPage({ onConversationClick }: { onConversationClick: (conv: Conversation) => void }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return demoConversations;
    const q = searchQuery.toLowerCase();
    return demoConversations.filter(
      (conv) => conv.name.toLowerCase().includes(q) || conv.lastMessage.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  function getPreview(conv: Conversation): string {
    if (conv.isGroup && conv.lastSender) return `${conv.lastSender}: ${conv.lastMessage}`;
    return conv.lastMessage;
  }

  return (
    <div className="mp-page">
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
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="mp-list-panel">
        <List
          dataSource={filteredConversations}
          renderItem={(conv) => (
            <List.Item className="mp-conversation-item" onClick={() => onConversationClick(conv)}>
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
      </div>
    </div>
  );
}
