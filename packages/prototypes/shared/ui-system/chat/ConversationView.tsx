/**
 * ConversationView — full conversation surface: header, message stream
 * (service/group/reactions/reply-quote/link-preview/@mention/attachment/
 * voice/delivery-status/edit/recall/pin/emoji-only/typing anatomy), hover
 * action bar, and the rich composer. Thread/detail/search sheets and the
 * call overlay stay one level up in this file.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Bookmark, Check, Copy, CornerUpRight, EyeOff, Link as LinkIcon, Pin, Undo2, X } from 'lucide-react';
import { Avatar, Button, Empty } from '@peers-touch/ui';
import type { ChatMessage, Conversation } from './chat-data';
import { VIEWER_NAME, VIEWER_TONE } from './chat-data';
import { ConversationHeader, DetailSheet, MessageSearchDialog, ThreadSheet } from './ConversationPanels';
import {
  DeliveryMeta, ForwardDialog, HideConfirm, isEmojiOnly, MessageActionBar,
  MessageReactions, ReportDialog, type MessageActionTarget,
} from './MessageActions';
import { MessageAttachments } from './MessageAttachments';
import { ActivityCard } from './ActivityCard';
import { VoicePlayer } from './VoiceNote';
import { ChatComposer, type ComposerPayload } from './ChatComposer';
import { CallOverlay, type CallKind } from './CallOverlay';
import { ChatAvatarTrigger } from './ChatIdentity';
import { useT } from '../prefs';
import type { ReactionKind } from '../../chat-domain';
import type { DrawerLeaf, resolveDrawerAssembly } from '@peers-touch/ui';
import type { ConversationWorkingState } from './conversation-working-state';

const MENTION_RE = new RegExp('(@[\\u4e00-\\u9fa5\\w·]+)', 'g');

function renderRichText(text: string) {
  return text.split(MENTION_RE).map((part, index) => {
    if (index % 2 === 1) return <mark key={index} className="sk-mention">{part}</mark>;
    return <span key={index}>{part}</span>;
  });
}

export function ConversationView({ conversation, messages, call, peerTyping, onEndCall, onSimulateIncoming,
  working, presentation, leaf, leafContent, leafProgress, onLeafChange,
  onSend, onTogglePin, onToggleMute, onReact, onEditMessage, onRecallMessage, onPinMessage,
  onMarkMessageForLater: markForLater,
  onRetryMessage, onHideMessages, onForwardMessages, onStartCall, onBack, conversations, people,
  onClearHistory, onDeleteConversation, onRenameConversation,
  onSetGroupAvatar, onSetMyNickname, onSetChatBackground,
  onAddGroupMembers, onRemoveGroupMember, onSetGroupMemberRole,
  onDissolveGroup, onLeaveGroup,
  onOpenMomentsProfile, onOpenMoment }: {
  conversation: Conversation;
  working: ConversationWorkingState;
  presentation: ReturnType<typeof resolveDrawerAssembly>;
  leaf: DrawerLeaf | null;
  leafContent: DrawerLeaf | null;
  leafProgress: number;
  onLeafChange: (leaf: DrawerLeaf | null) => void;
  messages: ChatMessage[];
  call: { conversationId: string; kind: CallKind; direction: 'in' | 'out'; multi?: boolean } | null;
  peerTyping?: boolean;
  onEndCall: () => void;
  onSimulateIncoming: (kind: CallKind, multiDevice?: boolean) => void;
  onSend: (payload: ComposerPayload) => void;
  onTogglePin: (id: string) => void;
  onToggleMute: (id: string) => void;
  onReact: (messageId: string, kind: ReactionKind) => void;
  onEditMessage: (conversationId: string, messageId: string, text: string) => void;
  onRecallMessage: (conversationId: string, messageId: string) => void;
  onPinMessage: (conversationId: string, messageId: string) => void;
  onMarkMessageForLater: (conversationId: string, messageId: string) => void;
  onRetryMessage: (conversationId: string, messageId: string) => void;
  /** HideMessageForActorIntent: remove from this viewer's local view only. */
  onHideMessages: (messageIds: string[]) => void;
  onForwardMessages: (messages: ChatMessage[], conversationId: string) => void;
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
  /** Cross to the moments surface: open the person's full profile / a moment. */
  onOpenMomentsProfile?: (name: string) => void;
  onOpenMoment?: (momentId: string) => void;
}) {
  const infoOpen = leaf?.kind === 'detail';
  const setInfoOpen = (next: boolean) => onLeafChange(next ? { kind: 'detail' } : null);
  const [searchOpen, setSearchOpen] = useState(false);
  const threadId = leafContent?.kind === 'thread' ? leafContent.messageId : null;
  const setThreadId = (id: string | null) => onLeafChange(id ? { kind: 'thread', messageId: id } : null);
  const threads = useSyncExternalStore(working.subscribe, () => working.snapshot.threads);
  const threadDrafts = useSyncExternalStore(working.subscribe, () => working.snapshot.threadDrafts);
  const controls = useSyncExternalStore(working.subscribe, () => working.snapshot.controls);
  const replyTarget = controls.reply;
  const editTarget = controls.edit;
  const setReplyTarget = (reply: ChatMessage | null) => working.patchControls({ reply });
  const setEditTarget = (edit: ChatMessage | null) => working.patchControls({ edit });
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [forwardTargets, setForwardTargets] = useState<ChatMessage[]>([]);
  const [hideTargetIds, setHideTargetIds] = useState<string[] | null>(null);
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  // Bulk multiselect: a pure client-side mode (no protocol command of its
  // own) that batches forward / copy / hide over chosen messages.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const { t, locale } = useT();
  useLayoutEffect(() => {
    if (!leaf) return;
    if (leafProgress === 1) {
      leafRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus({ preventScroll: true });
    } else if (leafProgress === 0) {
      sectionRef.current?.focus({ preventScroll: true });
    }
  }, [leaf?.kind, leafProgress]);
  // Squared-square avatar geometry: group senders keep the 8px tile, direct
  // chats the skin radius — applies to both peers and the viewer.
  const avatarRadius: string | number = conversation.kind === 'group' ? 8 : 'var(--sk-avatar-radius)';

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const restore = () => {
      const anchor = working.reading;
      if (anchor.atTail) el.scrollTop = el.scrollHeight;
      else {
        const row = [...el.querySelectorAll<HTMLElement>('[data-message-id]')]
          .find(item => item.dataset.messageId === anchor.messageId);
        if (row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset;
        else el.scrollTop = anchor.top;
      }
    };
    restore();
    // Width, height and composer growth change the same reading viewport.
    const observer = new ResizeObserver(restore);
    observer.observe(el);
    return () => observer.disconnect();
  }, [working, messages.length, conversation.id, peerTyping, presentation.workWidth]);

  useEffect(() => {
    setInfoOpen(false);
    setThreadId(null);
    exitSelectMode();
  }, [conversation.id]);

  const selectableMessages = useMemo(
    () => messages.filter(m => m.kind !== 'service' && m.kind !== 'activity' && !m.recalled),
    [messages],
  );
  // Day separators derive from message timestamps, mirroring desktop's
  // buildChatMessageSurfaceItems showDateSeparator behavior.
  const streamEntries = useMemo(() => {
    const nowYear = new Date().getFullYear();
    let previousDay = '';
    return messages.map((message) => {
      const day = message.ts ? new Date(message.ts).toDateString() : '';
      let dateLabel: string | undefined;
      if (day && day !== previousDay) {
        const date = new Date(message.ts!);
        dateLabel = date.toLocaleDateString(
          locale === 'en' ? 'en-US' : 'zh-CN',
          date.getFullYear() === nowYear
            ? { month: 'short', day: 'numeric' }
            : { year: 'numeric', month: 'short', day: 'numeric' },
        );
      }
      if (day) previousDay = day;
      return { message, dateLabel };
    });
  }, [messages, locale]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function enterSelectMode(seedId: string) {
    setSelectMode(true);
    setSelectedIds([seedId]);
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds([]);
  }
  const toggleSelected = (id: string) => setSelectedIds(list =>
    list.includes(id) ? list.filter(entry => entry !== id) : [...list, id]);

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
      case 'multiselect': enterSelectMode(message.id); break;
      case 'edit':
        working.patchComposer({ editText: message.text, caret: { start: message.text.length, end: message.text.length } });
        setReplyTarget(null); setEditTarget(message); break;
      case 'recall': onRecallMessage(conversation.id, message.id); flash(t('msg.recalled')); break;
      case 'report': setReportTarget(message); break;
      case 'mark-later':
        markForLater(conversation.id, message.id);
        flash(message.markedForLater ? t('action.markLaterRemoved') : t('action.markLaterDone'));
        break;
      case 'hide': setHideTargetIds([message.id]); break;
    }
  };

  const selectedMessages = selectableMessages.filter(m => selectedSet.has(m.id));

  const bulkCopy = () => {
    if (!selectedMessages.length) return;
    void navigator.clipboard?.writeText(selectedMessages.map(m => m.text).filter(Boolean).join('\n'));
    flash(selectedMessages.length === 1 ? t('select.copyOne') : t('select.copyMany', { n: selectedMessages.length }));
  };

  const threadMessage = messages.find(m => m.id === threadId) ?? null;
  const replyInThread = (text: string) => {
    if (!threadId) return;
    working.replyInThread(threadId, {
      id: `local-${Date.now()}`, from: 'me', text, at: t('time.justNow'),
    });
  };

  return (
    <section ref={sectionRef} tabIndex={-1} className="sk-conv-view" aria-label={t('conv.aria', { name: conversation.name })}
      data-chat-background={conversation.backgroundImage ? 'image' : (conversation.background ?? 'default')}
      data-select-mode={selectMode ? 'true' : 'false'}
      style={conversation.backgroundImage
        ? { '--sk-chat-bg-image': `url("${conversation.backgroundImage}")` } as CSSProperties
        : undefined}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented &&
            !(event.target as HTMLElement).closest('.pt-modal-layer')) {
          event.preventDefault();
          if (leaf) onLeafChange(null); else onBack();
        }
      }}>
      <div className="sk-work-task" inert={!!leaf || leafProgress > 0} aria-hidden={!!leaf || leafProgress > 0}
        style={{ '--sk-composer-budget': `${presentation.composerBudget}px` } as CSSProperties}>
      <ConversationHeader conversation={conversation}
        infoOpen={infoOpen}
        compactTools={presentation.workToolsCompact}
        onBack={onBack}
        onAudio={() => onStartCall('audio')}
        onVideo={() => onStartCall('video')}
        onInfo={() => setInfoOpen(!infoOpen)} />

      <div className="sk-msg-stream" ref={scrollRef} onScroll={() => {
        const el = scrollRef.current;
        if (!el) return;
        const top = el.getBoundingClientRect().top;
        const row = [...el.querySelectorAll<HTMLElement>('[data-message-id]')]
          .find(item => item.getBoundingClientRect().bottom > top);
        working.reading = {
          messageId: row?.dataset.messageId ?? null,
          offset: row ? row.getBoundingClientRect().top - top : 0,
          top: el.scrollTop,
          atTail: el.scrollHeight - el.clientHeight - el.scrollTop <= 4,
        };
      }}>
        {messages.length === 0 && (
          <Empty className="sk-conversation-empty"
            description={conversation.selfDirect ? t('conv.emptySelf') : t('conv.empty')} />
        )}
        {streamEntries.map(({ message: m, dateLabel }) => {
          const datePill = dateLabel
            ? <div className="sk-msg-date" data-date-separator><span>{dateLabel}</span></div>
            : null;
          if (m.kind === 'service') {
            return <div key={m.id}>{datePill}<div className="sk-msg-service"><span>{m.text}</span></div></div>;
          }
          if (m.kind === 'activity' && m.activity) {
            return <div key={m.id}>{datePill}
              <div className="sk-msg-activity" data-activity-message>
                <ActivityCard event={m.activity} />
              </div>
            </div>;
          }
          if (m.recalled) {
            return (
              <div key={m.id}>
                {datePill}
                <div className={`sk-msg sk-msg-${m.from}`} data-message-id={m.id}>
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
              </div>
            );
          }
          const emojiOnly = isEmojiOnly(m.text);
          const checked = selectedSet.has(m.id);
          return (
            <div key={m.id}>
              {datePill}
            <div
              className={`sk-msg sk-msg-${m.from}${emojiOnly ? ' is-emoji-only' : ''}${selectMode ? ' is-selectable' : ''}${checked ? ' is-selected' : ''}`}
              data-message-id={m.id}
              onClick={selectMode ? () => toggleSelected(m.id) : undefined}>
              {selectMode && (
                <button type="button" className="sk-msg-select-check"
                  role="checkbox" aria-checked={checked} aria-label={t('select.count', { n: 1 })}
                  data-select-check={m.id} data-checked={checked ? 'true' : 'false'}
                  onClick={event => { event.stopPropagation(); toggleSelected(m.id); }}>
                  {checked && <Check size={13} />}
                </button>
              )}
              {m.from === 'peer' ? (
                <ChatAvatarTrigger
                  name={conversation.kind === 'group' && m.senderName ? m.senderName : conversation.name}
                  tone={conversation.kind === 'group' && m.senderName
                    ? (m.senderTone ?? conversation.tone)
                    : conversation.tone}
                  conversation={conversation}
                  onOpenMomentsProfile={onOpenMomentsProfile}
                  onOpenMoment={onOpenMoment}>
                  {conversation.kind === 'group' && m.senderName
                    ? <Avatar name={m.senderName} background={m.senderTone ?? conversation.tone} size={32}
                        className="sk-msg-avatar" style={{ borderRadius: 8 }} />
                    : <Avatar name={conversation.name} background={conversation.tone} size={32}
                        className="sk-msg-avatar" style={{ borderRadius: 'var(--sk-avatar-radius)' }} />}
                </ChatAvatarTrigger>
              ) : (
                <ChatAvatarTrigger name={VIEWER_NAME} tone={VIEWER_TONE}
                  conversation={conversation}
                  onOpenMomentsProfile={onOpenMomentsProfile}
                  onOpenMoment={onOpenMoment}>
                  <Avatar name={VIEWER_NAME} background={VIEWER_TONE} size={32}
                    className="sk-msg-avatar sk-msg-avatar-self" style={{ borderRadius: avatarRadius }} />
                </ChatAvatarTrigger>
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
                      own bubbles in sides mode (Feishu parity). It yields to
                      the selection checkboxes in multiselect mode. */}
                  {!selectMode && (
                    <MessageActionBar
                      message={m}
                      copied={copiedId === m.id}
                      onReact={kind => onReact(m.id, kind)}
                      onReply={() => { setEditTarget(null); setReplyTarget(m); }}
                      onThread={() => setThreadId(m.id)}
                      onCopy={() => {
                        void navigator.clipboard?.writeText(m.text);
                        setCopiedId(m.id);
                        flash(t('msg.copied'));
                      }}
                      onForwardOpen={() => setForwardTargets([m])}
                      onMenuAction={action => handleMenuAction(m, action)} />
                  )}
                </div>
                <div className="sk-msg-under">
                  <time className="sk-msg-time">{m.at}</time>
                  <MessageReactions message={m} onToggle={kind => onReact(m.id, kind)} />
                  {m.edited && <span className="sk-msg-edited" data-msg-edited>{t('msg.edited')}</span>}
                  {m.pinned && (
                    <span className="sk-msg-pinned-chip" data-msg-pinned><Pin size={10} /> {t('msg.pinned')}</span>
                  )}
                  {m.markedForLater && (
                    <span className="sk-msg-marked-chip" data-msg-marked><Bookmark size={10} /> {t('action.markLater')}</span>
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

      {selectMode ? (
        <div className="sk-bulk-bar" data-bulk-bar role="toolbar" aria-label={t('action.multiselect')}>
          <span className="sk-bulk-count" data-bulk-count>{t('select.count', { n: selectedIds.length }) }</span>
          <span className="sk-bulk-spacer" />
          <Button actionId="bulk.forward" emphasis="quiet" density="compact"
            leading={<CornerUpRight size={14} />} label={t('select.forward')}
            availability={selectedIds.length
              ? { kind: 'enabled' }
              : { kind: 'disabled', reason: t('select.emptyHint') }}
            onActivate={() => setForwardTargets(selectedMessages)} />
          <Button actionId="bulk.copy" emphasis="quiet" density="compact"
            leading={<Copy size={14} />} label={t('select.copy')}
            availability={selectedIds.length
              ? { kind: 'enabled' }
              : { kind: 'disabled', reason: t('select.emptyHint') }}
            onActivate={bulkCopy} />
          <Button actionId="bulk.hide" emphasis="quiet" density="compact" tone="danger"
            leading={<EyeOff size={14} />} label={t('select.hide')}
            availability={selectedIds.length
              ? { kind: 'enabled' }
              : { kind: 'disabled', reason: t('select.emptyHint') }}
            onActivate={() => setHideTargetIds(selectedIds)} />
          <Button actionId="bulk.cancel" emphasis="quiet" density="compact"
            leading={<X size={14} />} label={t('select.cancel')}
            onActivate={exitSelectMode} />
        </div>
      ) : null}
      <div className="sk-working-composer" hidden={selectMode}>
        <ChatComposer working={working} budget={presentation.composerBudget}
          compactTools={presentation.workToolsCompact} groupMembers={conversation.members}
          replyTarget={replyTarget ? {
            who: replyTarget.from === 'me' ? t('common.me') : (replyTarget.senderName ?? conversation.name),
            text: replyTarget.text,
          } : null}
          editTarget={editTarget ? { id: editTarget.id, text: editTarget.text } : null}
          placeholder={conversation.selfDirect
            ? t('composer.selfPlaceholder')
            : t('composer.placeholder', { name: conversation.name })}
          onCancelReply={() => setReplyTarget(null)}
          onCancelEdit={() => setEditTarget(null)}
          onSend={submit} />
      </div>
      </div>

      {toast && <div className="sk-chat-toast" role="status">{toast}</div>}

      <div ref={leafRef} className="sk-leaf-guide" data-drawn={!!leaf || leafProgress > 0}
        data-leaf-kind={leafContent?.kind} inert={!leaf || leafProgress < 1} aria-hidden={!leaf}>
      {leafContent?.kind === 'detail' && (
        <DetailSheet key={`detail-${conversation.id}`} active={infoOpen}
          conversation={conversation} messages={messages} people={people}
          onClose={() => setInfoOpen(false)}
          onLocateMessage={(id) => {
            setInfoOpen(false);
            requestAnimationFrame(() => {
              const row = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
              if (row && scrollRef.current) scrollRef.current.scrollTop +=
                row.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top;
            });
          }}
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
          onSimulateIncoming={conversation.kind === 'person' && !conversation.selfDirect ? onSimulateIncoming : undefined} />
      )}
      {leafContent?.kind === 'thread' && threadId && threadMessage && (
        <ThreadSheet key={`${conversation.id}-${threadId}`} active={leaf?.kind === 'thread'} root={threadMessage}
          peerName={conversation.selfDirect ? t('contacts.savedMessages') : conversation.name}
          replies={threads[threadId] ?? []}
          draft={threadDrafts[threadId] ?? ''}
          onDraftChange={text => working.setThreadDraft(threadId, text)}
          onClose={() => setThreadId(null)}
          onReply={replyInThread} />
      )}
      </div>
      <MessageSearchDialog open={searchOpen} messages={messages}
        conversationName={conversation.selfDirect ? t('contacts.savedMessages') : conversation.name}
        onClose={() => setSearchOpen(false)}
        onLocate={message => {
          // Scroll the located row into view (same owner as bookmark locate).
          requestAnimationFrame(() => {
            const row = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${message.id}"]`);
            if (row && scrollRef.current) scrollRef.current.scrollTop +=
              row.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top;
          });
        }} />

      <ForwardDialog open={forwardTargets.length > 0} messages={forwardTargets}
        conversations={conversations.filter(c => c.id !== conversation.id)}
        onClose={() => setForwardTargets([])}
        onForward={(targetId, name) => {
          const count = forwardTargets.length;
          onForwardMessages(forwardTargets, targetId);
          flash(count > 1
            ? t('select.forwardDone', { n: count, name })
            : t('msg.forwarded', { name }));
          setForwardTargets([]);
          exitSelectMode();
        }} />
      <HideConfirm open={hideTargetIds !== null} count={hideTargetIds?.length ?? 0}
        onCancel={() => setHideTargetIds(null)}
        onConfirm={() => {
          if (hideTargetIds) onHideMessages(hideTargetIds);
          flash(t('msg.hideDone'));
          setHideTargetIds(null);
          exitSelectMode();
        }} />
      <ReportDialog open={reportTarget !== null}
        onCancel={() => setReportTarget(null)}
        onSubmit={() => {
          setReportTarget(null);
          flash(t('report.done'));
        }} />

      {call && (
        <CallOverlay conversation={conversation} kind={call.kind}
          direction={call.direction} multi={call.multi} onEnd={onEndCall} />
      )}
    </section>
  );
}
