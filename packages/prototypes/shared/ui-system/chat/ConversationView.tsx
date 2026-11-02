/**
 * ConversationView — full conversation surface: header, message stream
 * (service/group/reactions/reply-quote/link-preview/@mention/attachment/
 * voice/delivery-status/edit/recall/pin/emoji-only/typing anatomy), hover
 * action bar, and the rich composer. Thread/detail/search sheets and the
 * call overlay stay one level up in this file.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link as LinkIcon, Pin, Undo2 } from 'lucide-react';
import { Avatar, Empty } from '@peers-touch/ui';
import type { ChatMessage, Conversation, ThreadReply } from './chat-data';
import { SEED_THREADS, VIEWER_NAME, VIEWER_TONE } from './chat-data';
import { ConversationHeader, DetailSheet, MessageSearchDialog, ThreadSheet } from './ConversationPanels';
import {
  DeleteConfirm, DeliveryMeta, ForwardDialog, isEmojiOnly, MessageActionBar,
  MessageReactions, type MessageActionTarget,
} from './MessageActions';
import { MessageAttachments } from './MessageAttachments';
import { VoicePlayer } from './VoiceNote';
import { ChatComposer, type ComposerPayload } from './ChatComposer';
import { CallOverlay, type CallKind } from './CallOverlay';
import { useT } from '../prefs';

const MENTION_RE = new RegExp('(@[\\u4e00-\\u9fa5\\w·]+)', 'g');

function renderRichText(text: string) {
  return text.split(MENTION_RE).map((part, index) => {
    if (index % 2 === 1) return <mark key={index} className="sk-mention">{part}</mark>;
    return <span key={index}>{part}</span>;
  });
}

export function ConversationView({ conversation, messages, call, peerTyping, onEndCall, onSimulateIncoming,
  onSend, onTogglePin, onToggleMute, onReact, onEditMessage, onRecallMessage, onPinMessage,
  onRetryMessage, onDelete, onForward, onStartCall, onBack, conversations, people,
  onClearHistory, onDeleteConversation, onRenameConversation,
  onSetGroupAvatar, onSetMyNickname, onSetChatBackground,
  onAddGroupMembers, onRemoveGroupMember, onSetGroupMemberRole,
  onDissolveGroup, onLeaveGroup }: {
  conversation: Conversation;
  messages: ChatMessage[];
  call: { conversationId: string; kind: CallKind; direction: 'in' | 'out'; multi?: boolean } | null;
  peerTyping?: boolean;
  onEndCall: () => void;
  onSimulateIncoming: (kind: CallKind, multiDevice?: boolean) => void;
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
  /** Station-local friend candidates for the group add-member dialog. */
  people: { id?: string; name: string; tone: string }[];
  onClearHistory: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onRenameConversation: (conversationId: string, name: string) => void;
  onSetGroupAvatar: (conversationId: string, avatarImage: string) => void;
  onSetMyNickname: (conversationId: string, nickname: string) => void;
  onSetChatBackground: (conversationId: string, background: string, backgroundImage?: string) => void;
  onAddGroupMembers: (conversationId: string, members: { name: string; tone: string }[]) => void;
  onRemoveGroupMember: (conversationId: string, name: string) => void;
  onSetGroupMemberRole: (conversationId: string, name: string, role: 'owner' | 'admin' | 'member') => void;
  onDissolveGroup: (conversationId: string) => void;
  onLeaveGroup: (conversationId: string) => void;
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
  const { t } = useT();
  // Squared-square avatar geometry: group senders keep the 8px tile, direct
  // chats the skin radius — applies to both peers and the viewer.
  const avatarRadius: string | number = conversation.kind === 'group' ? 8 : 'var(--sk-avatar-radius)';

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
            who: replyTarget.from === 'me' ? t('common.me') : (replyTarget.senderName ?? conversation.name),
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
      case 'pin': onPinMessage(conversation.id, message.id); flash(message.pinned ? t('msg.unpinned') : t('msg.pinDone')); break;
      case 'copy':
        void navigator.clipboard?.writeText(message.text);
        setCopiedId(message.id);
        flash(t('msg.copied'));
        break;
      case 'edit': setReplyTarget(null); setEditTarget(message); break;
      case 'recall': onRecallMessage(conversation.id, message.id); flash(t('msg.recalled')); break;
      case 'delete': setDeleteTarget(message); break;
    }
  };

  const threadMessage = messages.find(m => m.id === threadId) ?? null;
  const replyInThread = (text: string) => {
    if (!threadId) return;
    setThreads(map => ({ ...map, [threadId]: [...(map[threadId] ?? []), {
      id: `local-${Date.now()}`, from: 'me', text, at: t('time.justNow'),
    }] }));
  };

  return (
    <section className="sk-conv-view" aria-label={t('conv.aria', { name: conversation.name })}
      data-chat-background={conversation.backgroundImage ? 'image' : (conversation.background ?? 'default')}
      style={conversation.backgroundImage
        ? { '--sk-chat-bg-image': `url("${conversation.backgroundImage}")` } as CSSProperties
        : undefined}>
      <ConversationHeader conversation={conversation}
        infoOpen={infoOpen}
        onBack={onBack}
        onAudio={() => onStartCall('audio')}
        onVideo={() => onStartCall('video')}
        onInfo={() => setInfoOpen(value => !value)} />

      <div className="sk-msg-stream" ref={scrollRef}>
        {messages.length === 0 && (
          <Empty className="sk-conversation-empty" description={t('conv.empty')} />
        )}
        {messages.map(m => {
          if (m.kind === 'service') {
            return <div key={m.id} className="sk-msg-service"><span>{m.text}</span></div>;
          }
          if (m.recalled) {
            return (
              <div key={m.id} className={`sk-msg sk-msg-${m.from}`} data-message-id={m.id}>
                {m.from === 'peer' ? (
                  <Avatar name={m.senderName ?? conversation.name}
                    background={m.senderTone ?? conversation.tone} size={32}
                    className="sk-msg-avatar" style={{ borderRadius: avatarRadius }} />
                ) : (
                  <Avatar name={VIEWER_NAME} background={VIEWER_TONE} size={32}
                    className="sk-msg-avatar sk-msg-avatar-self" style={{ borderRadius: avatarRadius }} />
                )}
                <div className="sk-msg-col">
                  <span className="sk-recalled-tombstone" data-recalled>
                    <Undo2 size={11} /> {m.from === 'me' ? t('msg.recalledMe') : t('msg.recalledPeer')}
                  </span>
                </div>
              </div>
            );
          }
          const emojiOnly = isEmojiOnly(m.text);
          return (
            <div key={m.id} className={`sk-msg sk-msg-${m.from}${emojiOnly ? ' is-emoji-only' : ''}`} data-message-id={m.id}>
              {m.from === 'peer' ? (
                conversation.kind === 'group' && m.senderName
                  ? <Avatar name={m.senderName} background={m.senderTone ?? conversation.tone} size={32}
                      className="sk-msg-avatar" style={{ borderRadius: 8 }} />
                  : <Avatar name={conversation.name} background={conversation.tone} size={32}
                      className="sk-msg-avatar" style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
              ) : (
                <Avatar name={VIEWER_NAME} background={VIEWER_TONE} size={32}
                  className="sk-msg-avatar sk-msg-avatar-self" style={{ borderRadius: avatarRadius }} />
              )}
              <div className="sk-msg-col">
                {m.from === 'peer' && conversation.kind === 'group' && m.senderName && (
                  <span className="sk-msg-sender">{m.senderName}</span>
                )}
                {/* Bubble + hover toolbar share one anchor box so the bar hugs
                    the bubble edge instead of the sender-name column. */}
                <div className="sk-msg-main">
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
                    </div>
                  )}
                  {/* Toolbar hugs the bubble: right of peer bubbles, left of
                      own bubbles in sides mode (Feishu parity). */}
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
                      flash(t('msg.copied'));
                    }}
                    onForwardOpen={() => setForwardTarget(m)}
                    onMenuAction={action => handleMenuAction(m, action)} />
                </div>
                <div className="sk-msg-under">
                  <time className="sk-msg-time">{m.at}</time>
                  <MessageReactions message={m} />
                  {m.edited && <span className="sk-msg-edited" data-msg-edited>{t('msg.edited')}</span>}
                  {m.pinned && (
                    <span className="sk-msg-pinned-chip" data-msg-pinned><Pin size={10} /> {t('msg.pinned')}</span>
                  )}
                  {m.threadCount ? (
                    <button type="button" className="sk-thread-entry"
                      data-thread-for={m.id}
                      onClick={() => setThreadId(m.id)}>
                        {t('msg.threadReplies', { n: threads[m.id]?.length ?? m.threadCount })}
                    </button>
                  ) : null}
                  <DeliveryMeta message={m} onRetry={() => onRetryMessage(conversation.id, m.id)} />
                </div>
              </div>
            </div>
          );
        })}
        {peerTyping && (
          <div className="sk-typing-row" data-chat-typing aria-label={t('conv.typingAria')}>
            <Avatar name={conversation.name} background={conversation.tone} size={32}
              style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
            <span className="sk-typing-bubble">
              <i /><i /><i />
            </span>
          </div>
        )}
      </div>

      <ChatComposer key={conversation.id} groupMembers={conversation.members}
        replyTarget={replyTarget ? {
          who: replyTarget.from === 'me' ? t('common.me') : (replyTarget.senderName ?? conversation.name),
          text: replyTarget.text,
        } : null}
        editTarget={editTarget ? { id: editTarget.id, text: editTarget.text } : null}
        placeholder={t('composer.placeholder', { name: conversation.name })}
        onCancelReply={() => setReplyTarget(null)}
        onCancelEdit={() => setEditTarget(null)}
        onSend={submit} />

      {toast && <div className="sk-chat-toast" role="status">{toast}</div>}

      {infoOpen && (
        <DetailSheet conversation={conversation} messages={messages} people={people}
          onClose={() => setInfoOpen(false)}
          onTogglePin={() => onTogglePin(conversation.id)}
          onToggleMute={() => onToggleMute(conversation.id)}
          onSearchMessages={() => { setInfoOpen(false); setSearchOpen(true); }}
          onClearHistory={() => onClearHistory(conversation.id)}
          onDeleteConversation={() => onDeleteConversation(conversation.id)}
          onRenameConversation={name => onRenameConversation(conversation.id, name)}
          onSetGroupAvatar={url => onSetGroupAvatar(conversation.id, url)}
          onSetMyNickname={name => onSetMyNickname(conversation.id, name)}
          onSetChatBackground={(background, image) => onSetChatBackground(conversation.id, background, image)}
          onAddGroupMembers={members => onAddGroupMembers(conversation.id, members)}
          onRemoveGroupMember={name => onRemoveGroupMember(conversation.id, name)}
          onSetGroupMemberRole={(name, role) => onSetGroupMemberRole(conversation.id, name, role)}
          onDissolve={() => onDissolveGroup(conversation.id)}
          onLeave={() => onLeaveGroup(conversation.id)}
          onSimulateIncoming={conversation.kind === 'person' ? onSimulateIncoming : undefined} />
      )}
      {threadId && threadMessage && (
        <ThreadSheet root={threadMessage} peerName={conversation.name}
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
            flash(t('msg.forwarded', { name }));
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
          direction={call.direction} multi={call.multi} onEnd={onEndCall} />
      )}
    </section>
  );
}
