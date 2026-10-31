/**
 * ConversationView — full conversation surface: header (increment 11),
 * message stream with service/group anatomy, thread sheet, detail sheet,
 * in-conversation search, and composer. Rich composer controls land in
 * increment 13.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar, Empty, IconButton, TextArea } from '@peers-touch/ui';
import type { ChatMessage, Conversation, ThreadReply } from './chat-data';
import { SEED_THREADS } from './chat-data';
import { ConversationHeader, DetailSheet, MessageSearchDialog, ThreadSheet } from './ConversationPanels';
import type { CallKind } from './CallOverlay';

export function ConversationView({ conversation, messages, onSend, onTogglePin, onToggleMute, onStartCall }: {
  conversation: Conversation;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onStartCall: (kind: CallKind) => void;
  header?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, ThreadReply[]>>(SEED_THREADS);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation.id]);

  useEffect(() => {
    setInfoOpen(false);
    setThreadId(null);
  }, [conversation.id]);

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

  const threadMessage = messages.find(m => m.id === threadId) ?? null;
  const replyInThread = (text: string) => {
    if (!threadId) return;
    setThreads(map => ({ ...map, [threadId]: [...(map[threadId] ?? []), {
      id: `local-${Date.now()}`, from: 'me', text, at: '刚刚',
    }] }));
  };

  return (
    <section className="sk-conv-view" aria-label={`与 ${conversation.name} 的对话`}>
      <ConversationHeader conversation={conversation}
        pinned={!!conversation.pinned} muted={!!conversation.muted}
        onAudio={() => onStartCall('audio')}
        onVideo={() => onStartCall('video')}
        onSearch={() => setSearchOpen(true)}
        onInfo={() => setInfoOpen(value => !value)} />

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
                {m.threadCount ? (
                  <button type="button" className="sk-thread-entry"
                    data-thread-for={m.id}
                    onClick={() => setThreadId(m.id)}>
                    {threads[m.id]?.length ?? m.threadCount} 条回复 · 查看话题
                  </button>
                ) : null}
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

      {infoOpen && (
        <DetailSheet conversation={conversation}
          onClose={() => setInfoOpen(false)}
          onTogglePin={() => onTogglePin(conversation.id)}
          onToggleMute={() => onToggleMute(conversation.id)} />
      )}
      {threadId && threadMessage && (
        <ThreadSheet root={threadMessage}
          initialReplies={threads[threadId] ?? []}
          onClose={() => setThreadId(null)}
          onReply={replyInThread} />
      )}
      <MessageSearchDialog open={searchOpen} messages={messages}
        conversationName={conversation.name}
        onClose={() => setSearchOpen(false)}
        onLocate={() => { /* result list closes; stream stays for follow-up increments */ }} />
    </section>
  );
}
