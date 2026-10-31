/**
 * ConversationView — full conversation surface: header, message stream
 * (service/group/reactions/reply-quote/link-preview/@mention anatomy),
 * hover action bar, reply composer, thread/detail/search sheets.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link as LinkIcon, X } from 'lucide-react';
import { Avatar, Empty, IconButton, TextArea } from '@peers-touch/ui';
import type { ChatMessage, Conversation, ThreadReply } from './chat-data';
import { SEED_THREADS } from './chat-data';
import { ConversationHeader, DetailSheet, MessageSearchDialog, ThreadSheet } from './ConversationPanels';
import {
  DeleteConfirm, ForwardDialog, MessageActionBar, MessageReactions,
} from './MessageActions';
import type { CallKind } from './CallOverlay';

const MENTION_RE = /(@[\u4e00-\u9fa5\w·]+)/g;

function renderRichText(text: string) {
  return text.split(MENTION_RE).map((part, index) => {
    if (index % 2 === 1) return <mark key={index} className="sk-mention">{part}</mark>;
    return <span key={index}>{part}</span>;
  });
}

export function ConversationView({ conversation, messages, onSend, onTogglePin, onToggleMute,
  onReact, onDelete, onForward, onStartCall, onBack, conversations }: {
  conversation: Conversation;
  messages: ChatMessage[];
  onSend: (text: string, replyTo?: { who: string; text: string }) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onReact: (messageId: string, kind: string) => void;
  onDelete: (messageId: string) => void;
  onForward: (message: ChatMessage, conversationId: string, name: string) => void;
  onStartCall: (kind: CallKind) => void;
  onBack: () => void;
  conversations: Conversation[];
  header?: ReactNode;
}) {
  const [draft, setDraft] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Record<string, ThreadReply[]>>(SEED_THREADS);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [toast, setToast] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation.id]);

  useEffect(() => {
    setInfoOpen(false);
    setThreadId(null);
    setReplyTarget(null);
  }, [conversation.id]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text, replyTarget
      ? { who: replyTarget.from === 'me' ? '我' : (replyTarget.senderName ?? conversation.name), text: replyTarget.text }
      : undefined);
    setDraft('');
    setReplyTarget(null);
  };
  const onEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    send();
  };

  // Mention popover only while typing a live @ token (no whitespace after @);
  // an empty draft must not resolve to the include('') match-all set.
  const atIndex = draft.lastIndexOf('@');
  const mentionTail = atIndex >= 0 ? draft.slice(atIndex + 1) : '';
  const mentionName = mentionTail.split(/\s/)[0];
  const mentionActive = atIndex >= 0 && !mentionTail.includes(' ');
  const mentionCandidates = mentionActive && conversation.kind === 'group'
    ? (conversation.members ?? []).filter(m => m.name.includes(mentionName)).slice(0, 5)
    : [];
  const insertMention = (name: string) => {
    const at = draft.lastIndexOf('@');
    setDraft(`${draft.slice(0, at)}@${name} `);
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
        onBack={onBack}
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
            <div key={m.id} className={`sk-msg sk-msg-${m.from}`} data-message-id={m.id}>
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
                  {m.replyTo && (
                    <div className="sk-reply-quote" data-reply-to>
                      <span>{m.replyTo.who}</span>
                      <p>{m.replyTo.text}</p>
                    </div>
                  )}
                  <p>{renderRichText(m.text)}</p>
                  {m.link && (
                    <a className="sk-link-card" href={m.link.url} onClick={e => e.preventDefault()}
                      data-link-preview>
                      <span className="sk-link-icon"><LinkIcon size={14} /></span>
                      <span className="sk-link-id">
                        <strong>{m.link.title}</strong>
                        <span>{m.link.desc}</span>
                      </span>
                    </a>
                  )}
                  <time>{m.at}</time>
                </div>
                <MessageReactions message={m} />
                {m.threadCount ? (
                  <button type="button" className="sk-thread-entry"
                    data-thread-for={m.id}
                    onClick={() => setThreadId(m.id)}>
                    {(threads[m.id]?.length ?? m.threadCount)} 条回复 · 查看话题
                  </button>
                ) : null}
              </div>
              <MessageActionBar
                canDelete={m.from === 'me'}
                copied={copiedId === m.id}
                onReact={kind => onReact(m.id, kind)}
                onReply={() => setReplyTarget(m)}
                onThread={() => setThreadId(m.id)}
                onCopy={() => {
                  void navigator.clipboard?.writeText(m.text);
                  setCopiedId(m.id);
                  flash('已复制到剪贴板');
                }}
                onForwardOpen={() => setForwardTarget(m)}
                onDeleteOpen={() => setDeleteTarget(m)} />
            </div>
          )
        ))}
      </div>

      {replyTarget && (
        <div className="sk-reply-bar" data-reply-bar>
          <div>
            <span>回复 {replyTarget.from === 'me' ? '我' : (replyTarget.senderName ?? conversation.name)}</span>
            <p>{replyTarget.text}</p>
          </div>
          <button type="button" className="sk-reply-cancel" aria-label="取消回复"
            onClick={() => setReplyTarget(null)}><X size={14} /></button>
        </div>
      )}
      <div className="sk-composer">
        <div className="sk-composer-input-wrap">
          {conversation.kind === 'group' && mentionCandidates.length > 0 && (
            <div className="sk-mention-pop" data-mention-pop>
              {mentionCandidates.map(member => (
                <button key={member.name} type="button" className="sk-mention-row"
                  data-mention-name={member.name} onClick={() => insertMention(member.name)}>
                  @{member.name}
                </button>
              ))}
            </div>
          )}
          <TextArea framing="embedded" minimumRows={1} maximumRows={4}
            className="sk-composer-input" value={draft} aria-label="输入消息"
            data-composer-value={draft}
            onValueChange={setDraft}
            onEnter={onEnter}
            placeholder={`发消息给 ${conversation.name}…`} />
        </div>
        <IconButton iconId="send" iconSize={16} label="发送消息" actionId="sk.send-message"
          emphasis="primary"
          availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入消息' }}
          onActivate={send} />
      </div>

      {toast && <div className="sk-chat-toast" role="status">{toast}</div>}

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
        onLocate={() => { /* scroll-to-result lands with follow-up increments */ }} />

      <ForwardDialog open={!!forwardTarget} message={forwardTarget}
        conversations={conversations.filter(c => c.id !== conversation.id)}
        onClose={() => setForwardTarget(null)}
        onForward={(conversationId, name) => {
          if (forwardTarget) {
            onForward(forwardTarget, conversationId, name);
            flash(`已转发到「${name}」`);
          }
          setForwardTarget(null);
        }} />
      <DeleteConfirm open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) onDelete(deleteTarget.id);
          setDeleteTarget(null);
        }} />
    </section>
  );
}
