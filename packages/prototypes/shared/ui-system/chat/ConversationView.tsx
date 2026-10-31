/**
 * ConversationView — message stream + composer (increments 2, 11–13).
 * Local text state; header actions and rich composer land in later
 * increments. Peer group messages show the sender identity row.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar, Empty, IconButton, TextArea } from '@peers-touch/ui';
import type { ChatMessage, Conversation } from './chat-data';

export function ConversationView({ conversation, messages, onSend, header }: {
  conversation: Conversation;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  header?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation.id]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };
  const onEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    send();
  };

  return (
    <section className="sk-conv-view" aria-label={`与 ${conversation.name} 的对话`}>
      {header}
      <div className="sk-msg-stream" ref={scrollRef}>
        {messages.length === 0 && (
          <Empty className="sk-conversation-empty" description="还没有消息，发个招呼吧" />
        )}
        {messages.map(m => (
          m.kind === 'service' ? (
            <div key={m.id} className="sk-msg-service"><span>{m.text}</span></div>
          ) : (
            <div key={m.id} className={`sk-msg sk-msg-${m.from}`}>
              {m.from === 'peer' && (
                conversation.kind === 'group' && m.senderName
                  ? <Avatar name={m.senderName} background={m.senderTone ?? conversation.tone} size={28}
                      className="sk-msg-avatar" style={{ borderRadius: 8 }} />
                  : <Avatar name={conversation.name} background={conversation.tone} size={32}
                      className="sk-msg-avatar" style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
              )}
              <div className="sk-msg-col">
                {m.from === 'peer' && conversation.kind === 'group' && m.senderName && (
                  <span className="sk-msg-sender">{m.senderName}</span>
                )}
                <div className="sk-msg-bubble">
                  <p>{m.text}</p>
                  <time>{m.at}</time>
                </div>
              </div>
            </div>
          )
        ))}
      </div>
      <div className="sk-composer">
        <TextArea framing="embedded" minimumRows={1} maximumRows={4}
          className="sk-composer-input" value={draft} aria-label="输入消息"
          data-composer-value={draft}
          onValueChange={setDraft}
          onEnter={onEnter}
          placeholder={`发消息给 ${conversation.name}…`} />
        <IconButton iconId="send" iconSize={16} label="发送消息" actionId="sk.send-message"
          emphasis="primary"
          availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入消息' }}
          onActivate={send} />
      </div>
    </section>
  );
}
