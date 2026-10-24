import { useLayoutEffect, useRef, useState } from 'react';
import { Input, Typography } from 'antd';
import { ArrowLeft, Plus, Send } from 'lucide-react';
import type { Message, Conversation } from '../types';
import { demoAvatarUrls } from '../data';
import { IdentityAvatar } from './IdentityAvatar';

const { Text } = Typography;

export function ThreadView({ message, conversation, onBack, targetId, onReply }: {
  message: Message; conversation: Conversation; onBack: () => void; targetId?: string;
  onReply: (reply: Message) => void;
}) {
  const [threadInput, setThreadInput] = useState('');
  const replies = message.threadReplies ?? [];
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!targetId) return;
    const row = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-thread-message-id]') ?? [])
      .find(item => item.dataset.threadMessageId === targetId);
    const viewport = row?.closest<HTMLElement>('[data-thread-viewport]');
    if (row && viewport) viewport.scrollTop += row.getBoundingClientRect().top
      - viewport.getBoundingClientRect().top - (viewport.clientHeight - row.clientHeight) / 2;
    row?.focus({ preventScroll: true });
  }, [targetId]);

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
    onReply(newReply);
    setThreadInput('');
  }

  return (
    <div className="mp-thread-view" ref={root}>
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

      <div className="mp-thread-replies-header">{replies.length} replies</div>

      <div data-thread-viewport style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {replies.map((reply) => (
          <div key={reply.id} className="mp-thread-reply-item" data-thread-message-id={reply.id}
            data-search-target={reply.id === targetId || undefined} tabIndex={-1}>
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
        <button type="button" className="mp-composer-attach" aria-label="Attach"><Plus size={22} /></button>
        <Input.TextArea
          className="mp-composer-input"
          value={threadInput}
          placeholder="Reply in thread"
          autoSize={{ minRows: 1, maxRows: 4 }}
          onChange={(e) => setThreadInput(e.target.value)}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleThreadSend(); } }}
        />
        <button
          type="button"
          className={`mp-composer-send ${threadInput.trim() ? 'active' : ''}`}
          aria-label="Send"
          onClick={handleThreadSend}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
