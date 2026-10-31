/**
 * ConversationView — full conversation surface: header, message stream
 * (service/group/reactions/reply-quote/link-preview/@mention/attachment/
 * voice anatomy), hover action bar, and the rich composer. Thread/detail/
 * search sheets and call overlay stay one level up in this file.
 */
import { useEffect, useRef, useState } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { Avatar, Empty } from '@peers-touch/ui';
import type { ChatMessage, Conversation, ThreadReply } from './chat-data';
import { SEED_THREADS } from './chat-data';
import { ConversationHeader, DetailSheet, MessageSearchDialog, ThreadSheet } from './ConversationPanels';
import {
  DeleteConfirm, ForwardDialog, MessageActionBar, MessageReactions,
} from './MessageActions';
import { MessageAttachments } from './MessageAttachments';
import { VoicePlayer } from './VoiceNote';
import { ChatComposer, type ComposerPayload } from './ChatComposer';
import type { CallKind } from './CallOverlay';

const MENTION_RE = new RegExp('(@[\\u4e00-\\u9fa5\\w·]+)', 'g');

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
  onSend: (payload: ComposerPayload) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onReact: (messageId: string, kind: string) => void;
  onDelete: (messageId: string) => void;
  onForward: (message: ChatMessage, conversationId: string, name: string) => void;
  onStartCall: (kind: CallKind) => void;
  onBack: () => void;
  conversations: Conversation[];
}) {
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

  const submit = (payload: ComposerPayload) => {
    onSend({
      ...payload,
      replyTo: replyTarget
        ? {
            who: replyTarget.from === 'me' ? '我' : (replyTarget.senderName ?? conversation.name),
            text: replyTarget.text,
          }
        : undefined,
    });
    setReplyTarget(null);
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
                <div className="sk-msg-bubble" data-message-kind={m.kind ?? 'text'}>
                  {m.replyTo && (
                    <div className="sk-reply-quote" data-reply-to>
                      <span>{m.replyTo.who}</span>
                      <p>{m.replyTo.text}</p>
                    </div>
                  )}
                  {m.kind === 'voice' ? (
                    <VoicePlayer url={m.voiceUrl} durationSeconds={m.voiceSeconds ?? 0} />
                  ) : (
                    <>
                      {m.text && <p>{renderRichText(m.text)}</p>}
                      {m.attachments && m.attachments.length > 0 && (
                        <MessageAttachments attachments={m.attachments} />
                      )}
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
                    </>
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

      <ChatComposer key={conversation.id} groupMembers={conversation.members}
        replyTarget={replyTarget ? {
          who: replyTarget.from === 'me' ? '我' : (replyTarget.senderName ?? conversation.name),
          text: replyTarget.text,
        } : null}
        placeholder={`发消息给 ${conversation.name}…`}
        onCancelReply={() => setReplyTarget(null)}
        onSend={submit} />

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
