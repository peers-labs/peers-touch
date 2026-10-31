/**
 * ConversationView — full conversation surface: header, message stream
 * (service/group/reactions/reply-quote/link-preview/@mention/attachment/
 * voice/delivery-status/edit/recall/pin/emoji-only/typing anatomy), hover
 * action bar, and the rich composer. Thread/detail/search sheets and the
 * call overlay stay one level up in this file.
 */
import { useEffect, useRef, useState } from 'react';
import { Link as LinkIcon, Pin, Undo2 } from 'lucide-react';
import { Avatar, Empty } from '@peers-touch/ui';
import type { ChatMessage, Conversation, ThreadReply } from './chat-data';
import { SEED_THREADS } from './chat-data';
import { ConversationHeader, DetailSheet, MessageSearchDialog, ThreadSheet } from './ConversationPanels';
import {
  DeleteConfirm, DeliveryMeta, ForwardDialog, isEmojiOnly, MessageActionBar,
  MessageReactions, type MessageActionTarget,
} from './MessageActions';
import { MessageAttachments } from './MessageAttachments';
import { VoicePlayer } from './VoiceNote';
import { ChatComposer, type ComposerPayload } from './ChatComposer';
import { CallOverlay, type CallKind } from './CallOverlay';

const MENTION_RE = new RegExp('(@[\\u4e00-\\u9fa5\\w·]+)', 'g');

function renderRichText(text: string) {
  return text.split(MENTION_RE).map((part, index) => {
    if (index % 2 === 1) return <mark key={index} className="sk-mention">{part}</mark>;
    return <span key={index}>{part}</span>;
  });
}

export function ConversationView({ conversation, messages, call, peerTyping, onEndCall, onSimulateIncoming,
  onSend, onTogglePin, onToggleMute, onReact, onEditMessage, onRecallMessage, onPinMessage,
  onRetryMessage, onDelete, onForward, onStartCall, onBack, conversations }: {
  conversation: Conversation;
  messages: ChatMessage[];
  call: { conversationId: string; kind: CallKind; direction: 'in' | 'out' } | null;
  peerTyping?: boolean;
  onEndCall: () => void;
  onSimulateIncoming: (kind: CallKind) => void;
  onSend: (payload: ComposerPayload) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onEditMessage: (conversationId: string, messageId: string, text: string) => void;
  onRecallMessage: (conversationId: string, messageId: string) => void;
  onPinMessage: (conversationId: string, messageId: string) => void;
  onRetryMessage: (conversationId: string, messageId: string) => void;
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
  const [editTarget, setEditTarget] = useState<ChatMessage | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [toast, setToast] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation.id, peerTyping]);

  useEffect(() => {
    setInfoOpen(false);
    setThreadId(null);
    setReplyTarget(null);
    setEditTarget(null);
  }, [conversation.id]);

  const flash = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };

  const submit = (payload: ComposerPayload) => {
    onSend({
      ...payload,
      replyTo: (replyTarget && !payload.editId)
        ? {
            who: replyTarget.from === 'me' ? '我' : (replyTarget.senderName ?? conversation.name),
            text: replyTarget.text,
          }
        : undefined,
    });
    setReplyTarget(null);
    setEditTarget(null);
  };

  const handleMenuAction = (message: ChatMessage, action: MessageActionTarget) => {
    switch (action) {
      case 'thread': setThreadId(message.id); break;
      case 'pin': onPinMessage(conversation.id, message.id); flash(message.pinned ? '已取消置顶' : '消息已置顶'); break;
      case 'copy':
        void navigator.clipboard?.writeText(message.text);
        setCopiedId(message.id);
        flash('已复制到剪贴板');
        break;
      case 'edit': setReplyTarget(null); setEditTarget(message); break;
      case 'recall': onRecallMessage(conversation.id, message.id); flash('消息已撤回'); break;
      case 'delete': setDeleteTarget(message); break;
    }
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
        {messages.map(m => {
          if (m.kind === 'service') {
            return <div key={m.id} className="sk-msg-service"><span>{m.text}</span></div>;
          }
          if (m.recalled) {
            return (
              <div key={m.id} className={`sk-msg sk-msg-${m.from}`} data-message-id={m.id}>
                {m.from === 'peer' && (
                  <Avatar name={m.senderName ?? conversation.name}
                    background={m.senderTone ?? conversation.tone} size={28}
                    className="sk-msg-avatar" style={{ borderRadius: 8 }} />
                )}
                <div className="sk-msg-col">
                  <span className="sk-recalled-tombstone" data-recalled>
                    <Undo2 size={11} /> {m.from === 'me' ? '你撤回了一条消息' : '对方撤回了一条消息'}
                  </span>
                </div>
              </div>
            );
          }
          const emojiOnly = isEmojiOnly(m.text);
          return (
            <div key={m.id} className={`sk-msg sk-msg-${m.from}${emojiOnly ? ' is-emoji-only' : ''}`} data-message-id={m.id}>
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
                {emojiOnly ? (
                  <div className="sk-emoji-only-bubble" data-emoji-only>{renderRichText(m.text)}</div>
                ) : (
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
                )}
                <div className="sk-msg-under">
                  <MessageReactions message={m} />
                  {m.edited && <span className="sk-msg-edited" data-msg-edited>已编辑</span>}
                  {m.pinned && (
                    <span className="sk-msg-pinned-chip" data-msg-pinned><Pin size={10} /> 置顶</span>
                  )}
                  {m.threadCount ? (
                    <button type="button" className="sk-thread-entry"
                      data-thread-for={m.id}
                      onClick={() => setThreadId(m.id)}>
                      {(threads[m.id]?.length ?? m.threadCount)} 条回复 · 查看话题
                    </button>
                  ) : null}
                  <DeliveryMeta message={m} onRetry={() => onRetryMessage(conversation.id, m.id)} />
                  {emojiOnly && <span className="sk-emoji-only-time"><time>{m.at}</time></span>}
                </div>
              </div>
              <MessageActionBar
                message={m}
                canDelete={m.from === 'me'}
                copied={copiedId === m.id}
                onReact={emoji => onReact(m.id, emoji)}
                onReply={() => { setEditTarget(null); setReplyTarget(m); }}
                onThread={() => setThreadId(m.id)}
                onCopy={() => {
                  void navigator.clipboard?.writeText(m.text);
                  setCopiedId(m.id);
                  flash('已复制到剪贴板');
                }}
                onForwardOpen={() => setForwardTarget(m)}
                onMenuAction={action => handleMenuAction(m, action)} />
            </div>
          );
        })}
        {peerTyping && (
          <div className="sk-typing-row" data-chat-typing aria-label="对方正在输入">
            <Avatar name={conversation.name} background={conversation.tone} size={28}
              style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
            <span className="sk-typing-bubble">
              <i /><i /><i />
            </span>
          </div>
        )}
      </div>

      <ChatComposer key={conversation.id} groupMembers={conversation.members}
        replyTarget={replyTarget ? {
          who: replyTarget.from === 'me' ? '我' : (replyTarget.senderName ?? conversation.name),
          text: replyTarget.text,
        } : null}
        editTarget={editTarget ? { id: editTarget.id, text: editTarget.text } : null}
        placeholder={`发消息给 ${conversation.name}…`}
        onCancelReply={() => setReplyTarget(null)}
        onCancelEdit={() => setEditTarget(null)}
        onSend={submit} />

      {toast && <div className="sk-chat-toast" role="status">{toast}</div>}

      {infoOpen && (
        <DetailSheet conversation={conversation}
          onClose={() => setInfoOpen(false)}
          onTogglePin={() => onTogglePin(conversation.id)}
          onToggleMute={() => onToggleMute(conversation.id)}
          onSimulateIncoming={conversation.kind === 'person' ? onSimulateIncoming : undefined} />
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

      {call && (
        <CallOverlay conversation={conversation} kind={call.kind}
          direction={call.direction} onEnd={onEndCall} />
      )}
    </section>
  );
}
