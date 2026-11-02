import { useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon, Text, TextArea } from '@peers-touch/ui';
import type { Message, Conversation } from '../types';
import { demoAvatarUrls } from '../data';
import { IdentityAvatar } from './IdentityAvatar';

export function ThreadView({ message, conversation, onBack, targetId, onReply }: {
  message: Message; conversation: Conversation; onBack: () => void; targetId?: string;
  onReply: (reply: Message) => void;
}) {
  const t = useT();
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
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label={t('mobile.chat.back')}>
          <Icon iconId="arrow-left" size={22} />
        </button>
        <div className="mp-thread-contact">
          <div className="mp-thread-contact-info">
            <Text strong className="mp-thread-name">{t('mobile.ui.thread')}</Text>
            <Text tone="muted" style={{ fontSize: 11 }}>{message.mine ? 'You' : conversation.name}</Text>
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
        <button type="button" className="mp-composer-attach" aria-label={t('mobile.chat.attach')}><Icon iconId="plus" size={22} /></button>
        <TextArea
          className="mp-composer-input"
          value={threadInput}
          placeholder={t('mobile.thread.replyPlaceholder')}
          minimumRows={1}
          maximumRows={4}
          framing="embedded"
          onValueChange={setThreadInput}
          onEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); handleThreadSend(); } }}
        />
        <button
          type="button"
          className={`mp-composer-send ${threadInput.trim() ? 'active' : ''}`}
          aria-label={t('mobile.chat.send')}
          disabled={!threadInput.trim()}
          onClick={handleThreadSend}
        >
          <Icon iconId="send" size={18} />
        </button>
      </div>
    </div>
  );
}
