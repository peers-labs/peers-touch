import { useState } from 'react';
import { Input, Typography } from 'antd';
import { ArrowLeft, Send } from 'lucide-react';
import type { Message, Conversation } from '../types';
import { demoAvatarUrls } from '../data';
import { IdentityAvatar } from './IdentityAvatar';

const { Text } = Typography;

export function ThreadView({ message, conversation, onBack }: { message: Message; conversation: Conversation; onBack: () => void }) {
  const [threadInput, setThreadInput] = useState('');
  const [localReplies, setLocalReplies] = useState<Message[]>(message.threadReplies ?? []);

  function handleThreadSend() {
    const text = threadInput.trim();
    if (!text) return;
    const newReply: Message = {
      id: `tr-${Date.now()}`,
      mine: true,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
    };
    setLocalReplies((prev) => [...prev, newReply]);
    setThreadInput('');
  }

  return (
    <div className="mp-thread-view">
      <header className="mp-thread-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="mp-thread-contact">
          <div className="mp-thread-contact-info">
            <Text strong className="mp-thread-name">Thread</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>{message.mine ? 'You' : conversation.name}</Text>
          </div>
        </div>
      </header>

      <div className="mp-thread-root-msg">
        <div className="mp-thread-root-sender">{message.mine ? 'You' : conversation.name}</div>
        <div className="mp-thread-root-text">{message.text}</div>
      </div>

      <div className="mp-thread-replies-header">{localReplies.length} replies</div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {localReplies.map((reply) => (
          <div key={reply.id} className="mp-thread-reply-item">
            <IdentityAvatar
              name={reply.mine ? 'Alice Chen' : conversation.name}
              initials={reply.mine ? 'AC' : conversation.avatar}
              src={reply.mine ? demoAvatarUrls.alice : conversation.avatarUrl}
              kind={conversation.isGroup && !reply.mine ? 'group' : 'person'}
              size={32}
            />
            <div className="mp-thread-reply-content">
              <div className="mp-thread-reply-name">{reply.mine ? 'You' : conversation.name}</div>
              <div className="mp-thread-reply-text">{reply.text}</div>
              <div className="mp-thread-reply-time">{reply.time}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mp-composer">
        <div className="mp-composer-dock">
          <Input.TextArea
            className="mp-composer-input"
            value={threadInput}
            placeholder="Reply in thread"
            autoSize={{ minRows: 1, maxRows: 4 }}
            onChange={(e) => setThreadInput(e.target.value)}
            onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleThreadSend(); } }}
          />
          <div className="mp-composer-tools mp-composer-tools--end">
            <button
              type="button"
              className={`mp-composer-send ${threadInput.trim() ? 'active' : ''}`}
              aria-label="Send"
              disabled={!threadInput.trim()}
              onClick={handleThreadSend}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
