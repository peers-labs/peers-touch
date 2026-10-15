import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Typography } from 'antd';
import {
  AlertCircle, ArrowLeft, Check, CheckCheck, ChevronRight, Clock,
  Copy, CornerUpLeft, EyeOff, File, Flag as FlagIcon, Forward,
  Image as ImageIcon, LockKeyhole,
  MessageSquare, MoreVertical, Pencil, Phone, Pin,
  RefreshCw, RotateCcw, ShieldX, Video, X,
} from 'lucide-react';
import type { Conversation, Message, MessageStatus, MobileUiEvidence, ReactionKind } from '../types';
import { REACTION_EMOJI, REACTION_KINDS } from '../types';
import { demoMessages, releaseSender } from '../data';
import { messageSender, mobileMessageClusters } from '../messagePresentation';
import { ReactionChip } from '../../../../shared/ReactionChip';
import { ReactionPicker } from '../../../../shared/ReactionPicker';
import { InlineMessageReplies } from '../../../../shared/InlineMessageReplies';
import { MessageAuthor } from '../../../../shared/MessageAuthor';
import { PinnedMessageCarousel } from '../../../../shared/PinnedMessageCarousel';
import {
  MobileMessageComposer,
  type MobileComposerAttachment,
} from '../components/MobileMessageComposer';
import { ThreadView } from '../components/ThreadView';
import { ForwardPicker } from '../components/ForwardPicker';
import { ChatHistorySearch } from '../components/ChatHistorySearch';
import { PrototypeListWindow, type PrototypeListHandle } from '../components/PrototypeListWindow';
import type { PrototypeListMemory } from '../listPresentation';
import type { SearchDemoControl } from '../searchDemo';
import copy from '../../../../../locales/en/common.json';
import {
  CHAT_JOURNEY,
  CHAT_JOURNEY_COPY,
  CHAT_JOURNEY_MESSAGE_ID,
  resolveChatJourneyLocale,
} from '../../../../shared/chat-journey';
import type { PrototypeCallMediaKind } from '../callPrototype';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import {
  InlineSurfaceNotice,
  RouteSurfaceState,
  ThreadSkeleton,
} from '../components/MobileSurfaceState';
import { useDismissableLayer } from '../components/useDismissableLayer';

const { Text } = Typography;
const messageKey = (message: Message) => message.id;
const reactionLabels: Record<ReactionKind, string> = {
  like: copy['mobile.moments.reaction.like'],
  love: copy['mobile.moments.reaction.love'],
  laugh: copy['mobile.moments.reaction.laugh'],
  wow: copy['mobile.moments.reaction.wow'],
  celebrate: copy['mobile.moments.reaction.celebrate'],
};

function toggleReaction(
  reactions: NonNullable<Message['reactions']>,
  kind: ReactionKind,
): NonNullable<Message['reactions']> {
  const found = reactions.find((reaction) => reaction.kind === kind);
  if (found?.byMe) {
    return reactions
      .map((reaction) => (
        reaction.kind === kind
          ? { ...reaction, byMe: false, count: reaction.count - 1 }
          : reaction
      ))
      .filter((reaction) => reaction.count > 0);
  }
  if (found) {
    return reactions.map((reaction) => (
      reaction.kind === kind
        ? { ...reaction, byMe: true, count: reaction.count + 1 }
        : reaction
    ));
  }
  return [...reactions, { kind, byMe: true, count: 1 }];
}

export function ChatThread({
  conversation,
  onBack,
  onStartCall,
  initialMessages = demoMessages,
  listMemory,
  searchDemo,
  uiEvidence,
  blocked,
  onBlockedChange,
}: {
  conversation: Conversation;
  onBack: () => void;
  onStartCall?: (mediaKind: PrototypeCallMediaKind) => void;
  initialMessages?: Message[];
  listMemory: PrototypeListMemory;
  searchDemo?: SearchDemoControl;
  uiEvidence: MobileUiEvidence;
  blocked: boolean;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionSheetMessage, setActionSheetMessage] = useState<Message | null>(null);
  const actionSheetRef = useRef<HTMLDivElement>(null);
  const closeActionSheet = useCallback(() => {
    setActionSheetMessage(null);
  }, []);
  useDismissableLayer({
    open: actionSheetMessage !== null,
    containerRef: actionSheetRef,
    onDismiss: closeActionSheet,
    dismissOnWindowBlur: true,
  });
  const [isTyping] = useState(
    initialMessages.length > 0
      && !initialMessages.some((message) => message.status === 'failed' || message.status === 'unknown'),
  );
  const [threadMessageId, setThreadMessageId] = useState<string | null>(null);
  const threadMessage = messages.find((message) => message.id === threadMessageId) ?? null;
  const [showPinnedMessages, setShowPinnedMessages] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const [showChatDetails, setShowChatDetails] = useState(false);
  const [detailsView, setDetailsView] = useState<'main' | 'search' | 'media' | 'files'>('main');
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const messageWindow = useRef<PrototypeListHandle>(null);
  const retryTimers = useRef<Set<number>>(new Set());
  const [isMuted, setIsMuted] = useState(conversation.muted ?? false);
  const [isStickyTop, setIsStickyTop] = useState(conversation.pinned ?? false);
  const [confirmAction, setConfirmAction] = useState<'clear' | 'block' | 'report' | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [threadState, setThreadState] = useState(uiEvidence.chatThreadState);
  const [checkingMessageIds, setCheckingMessageIds] = useState<Set<string>>(new Set());
  const locale = typeof window === 'undefined'
    ? 'en'
    : resolveChatJourneyLocale(window.location.search, window.navigator.language);
  const journeyCopy = CHAT_JOURNEY_COPY[locale];

  const clusterPositions = useMemo(
    () => mobileMessageClusters(messages, conversation),
    [messages, conversation],
  );

  useEffect(() => () => {
    retryTimers.current.forEach((timer) => window.clearTimeout(timer));
    retryTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!actionSheetMessage) return;
    requestAnimationFrame(() => actionSheetRef.current?.focus());
  }, [actionSheetMessage]);

  useLayoutEffect(() => {
    if (!targetMessageId || showChatDetails || showPinnedMessages || threadMessage) return;
    setTargetUnavailable(!messageWindow.current?.reveal(targetMessageId));
    setTargetMessageId(null);
  }, [targetMessageId, showChatDetails, showPinnedMessages, threadMessage]);

  useEffect(() => {
    setThreadState(uiEvidence.chatThreadState);
  }, [uiEvidence.chatThreadState]);

  function handleSend(attachment?: MobileComposerAttachment) {
    const text = inputValue.trim();
    if (!text && !attachment) return;

    if (editingMessage) {
      if (!text) return;
      setMessages((prev) => prev.map((m) =>
        m.id === editingMessage.id ? { ...m, text } : m,
      ));
      setEditingMessage(null);
      setInputValue('');
      return;
    }

    const newMsg: Message = {
      id: `m-${Date.now()}`,
      mine: true,
      text: text || undefined,
      image: attachment?.kind === 'image' && attachment.previewUrl
        ? `url("${attachment.previewUrl}") center / cover`
        : undefined,
      file: attachment?.kind === 'file'
        ? { name: attachment.name, size: attachment.size }
        : undefined,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
      reply: replyTo ? { name: messageSender(replyTo, conversation).name, text: replyTo.text || (replyTo.image ? '[Photo]' : '[File]') } : undefined,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputValue('');
    setReplyTo(null);
  }

  function handleThreadReply(messageId: string, text: string, attachment?: MobileComposerAttachment) {
    const reply: Message = {
      id: `tr-${Date.now()}`,
      mine: true,
      text: text || undefined,
      image: attachment?.kind === 'image' && attachment.previewUrl
        ? `url("${attachment.previewUrl}") center / cover`
        : undefined,
      file: attachment?.kind === 'file'
        ? { name: attachment.name, size: attachment.size }
        : undefined,
      timestamp: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), status: 'sent',
    };
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId || message.recalled || message.moderated) return message;
      return { ...message, threadReplies: [...(message.threadReplies ?? []), reply] };
    }));
  }

  function handleRetry(messageId: string) {
    // A recalled/moderated/failed row keeps status 'failed', but retry must
    // neither resurrect its content nor flip it to delivered.
    const targetLive = (list: Message[]) => {
      const target = list.find((message) => message.id === messageId);
      return Boolean(target && !target.recalled && !target.moderated);
    };
    setMessages((prev) => {
      if (!targetLive(prev)) return prev;
      return prev.map((message) => (
        message.id === messageId ? { ...message, status: 'sending' } : message
      ));
    });
    const timer = window.setTimeout(() => {
      retryTimers.current.delete(timer);
      setMessages((prev) => {
        // Hide-for-me (or Clear) during the retry window removes the row.
        if (!targetLive(prev)) return prev;
        const next = prev.map((message) => (
          message.id === messageId ? { ...message, status: 'delivered' as const } : message
        ));
        if (messageId !== CHAT_JOURNEY_MESSAGE_ID || next.some((message) => message.id === 'release-hold-mobile-ack')) {
          return next;
        }
        return [
          ...next,
          {
            id: 'release-hold-mobile-ack',
            mine: false,
            sender: releaseSender,
            text: CHAT_JOURNEY.messages.followup[locale],
            time: CHAT_JOURNEY.timestamps.recovered,
            status: 'read' as const,
          },
        ];
      });
    }, 900);
    retryTimers.current.add(timer);
  }

  function handleCheckStatus(messageId: string) {
    setCheckingMessageIds((current) => new Set(current).add(messageId));
    const timer = window.setTimeout(() => {
      retryTimers.current.delete(timer);
      setMessages((current) => {
        const resolved = current.map((message) => (
          message.id === messageId ? { ...message, status: 'delivered' as const } : message
        ));
        if (resolved.some((message) => message.id === 'release-hold-mobile-ack')) return resolved;
        return [
          ...resolved,
          {
            id: 'release-hold-mobile-ack',
            mine: false,
            sender: releaseSender,
            text: CHAT_JOURNEY.messages.followup[locale],
            time: CHAT_JOURNEY.timestamps.recovered,
            status: 'read' as const,
          },
        ];
      });
      setCheckingMessageIds((current) => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
    }, 900);
    retryTimers.current.add(timer);
  }

  function handleRouteRetry() {
    setThreadState('initial-loading');
    const timer = window.setTimeout(() => {
      retryTimers.current.delete(timer);
      setThreadState('ready');
    }, 800);
    retryTimers.current.add(timer);
  }

  function handleAction(action: string) {
    if (!actionSheetMessage) return;
    if (action === 'reply') {
      setReplyTo(actionSheetMessage);
    } else if (action === 'thread') {
      setThreadMessageId(actionSheetMessage.id);
    } else if (action === 'forward') {
      setForwardMessage(actionSheetMessage);
    } else if (action === 'copy') {
      if (actionSheetMessage.text && navigator.clipboard) {
        void navigator.clipboard.writeText(actionSheetMessage.text)
          .then(() => showToast('Copied to clipboard'))
          .catch(() => showToast('Copy unavailable'));
      } else {
        showToast('Copy unavailable');
      }
    } else if (action === 'edit') {
      setEditingMessage(actionSheetMessage);
      setInputValue(actionSheetMessage.text ?? '');
    } else if (action === 'hide-for-me') {
      setMessages((prev) => prev.filter((m) => m.id !== actionSheetMessage.id));
      showToast(copy['mobile.chat.deleteForMe']);
    } else if (action === 'moderate') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id
          ? { ...m, moderated: true, text: undefined, image: undefined, file: undefined }
          : m,
      ));
      showToast(copy['mobile.chat.moderatedMessage']);
    } else if (action === 'recall') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id ? { ...m, recalled: true, text: undefined, image: undefined, file: undefined } : m,
      ));
    } else if (action === 'pin') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id ? { ...m, pinned: !m.pinned } : m,
      ));
    } else if (action === 'flag') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id ? { ...m, flagged: !m.flagged } : m,
      ));
    }
    setActionSheetMessage(null);
  }

  function showToast(msg: string) {
    setToastMessage(msg);
    setToastKey((k) => k + 1);
  }

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2100);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, toastKey]);

  function handleReaction(msgId: string, kind: ReactionKind) {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      return { ...m, reactions: toggleReaction(m.reactions ?? [], kind) };
    }));
    setActionSheetMessage((current) => (
      current?.id === msgId
        ? { ...current, reactions: toggleReaction(current.reactions ?? [], kind) }
        : current
    ));
  }

  function renderReceipt(status?: MessageStatus) {
    if (status === 'unknown') return <AlertCircle size={14} className="mp-receipt mp-receipt--unknown" aria-label="Delivery outcome unknown" />;
    if (status === 'sending') return <RefreshCw size={13} className="mp-receipt mp-receipt--pending" aria-label={journeyCopy.retrying} />;
    if (status === 'read') return <CheckCheck size={14} className="mp-receipt mp-receipt--read" />;
    if (status === 'delivered') return <CheckCheck size={14} className="mp-receipt" />;
    if (status === 'sent') return <Check size={14} className="mp-receipt" />;
    return <Clock size={13} className="mp-receipt mp-receipt--pending" />;
  }

  const pinnedMessages = messages.filter((m) => m.pinned && !m.dateLabel && !m.recalled && !m.moderated);

  return (
    <div className="mp-thread">
      {!showChatDetails && !showPinnedMessages && !threadMessage && (
        <>
      <header className="mp-thread-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="mp-thread-contact">
          <IdentityAvatar
            name={conversation.name}
            initials={conversation.avatar}
            src={conversation.avatarUrl}
            kind={conversation.isGroup ? 'group' : 'person'}
            size={36}
            renderState={uiEvidence.avatarState}
          />
          <div className="mp-thread-contact-info">
            <Text strong className="mp-thread-name">{conversation.name}</Text>
          </div>
        </div>
        {!conversation.isGroup && onStartCall ? (
          <>
            <button
              type="button"
              className="mp-thread-action"
              aria-label="Start audio call"
              title="Start audio call"
              onClick={() => onStartCall('audio')}
            >
              <Phone size={19} />
            </button>
            <button
              type="button"
              className="mp-thread-action"
              aria-label="Start video call"
              title="Start video call"
              onClick={() => onStartCall('video')}
            >
              <Video size={19} />
            </button>
          </>
        ) : null}
        <button type="button" className="mp-thread-action" aria-label="More" onClick={() => setShowChatDetails(true)}>
          <MoreVertical size={19} />
        </button>
      </header>

      {threadState !== 'route-error' && (
        <PinnedMessageCarousel messages={pinnedMessages.map((message) => ({
          id: message.id, text: message.text || '[Media]', author: messageSender(message, conversation).name,
        }))} onJump={setTargetMessageId} />
      )}

      {threadState === 'route-error' ? (
        <RouteSurfaceState
          title="Conversation unavailable"
          detail="Peers could not restore this conversation. Your place is preserved."
          actionLabel="Retry"
          onAction={handleRouteRetry}
        />
      ) : (
        <>
          <div className="mp-thread-messages" data-prototype-page="messages">
            {threadState === 'initial-loading' ? (
              <ThreadSkeleton />
            ) : (
              <>
                {threadState === 'history-loading' && (
                  <InlineSurfaceNotice
                    title="Loading earlier messages"
                    detail="Visible messages stay anchored while history is inserted above."
                  />
                )}
                {targetUnavailable && (
                  <Text type="secondary" role="status">{copy['mobile.chat.messageUnavailable']}</Text>
                )}
                {messages.length === 0 && (
                  <RouteSurfaceState
                    title={copy['mobile.chat.emptyThread']}
                    detail="Messages sent in this conversation will appear here."
                  />
                )}
                <PrototypeListWindow items={messages} itemKey={messageKey}
                  surfaceKey={`messages:${conversation.key}`} memory={listMemory} size={200} initial="end"
                  controllerRef={messageWindow}>
                {(window) => window.map((msg) => {
                  if (msg.dateLabel) {
                    return (
                      <div key={msg.id} className="mp-date-separator" data-scroll-anchor-id={msg.id}>
                        <span className="mp-date-pill">{msg.dateLabel}</span>
                      </div>
                    );
                  }
                  if (msg.recalled || msg.moderated) {
                    return (
                      <div key={msg.id} className={`mp-message-row ${msg.mine ? 'mine' : 'peer'} cluster-start cluster-end`}
                        data-scroll-anchor-id={msg.id}>
                        <div className="mp-recalled-notice">
                          {msg.moderated ? <ShieldX size={12} /> : <RotateCcw size={12} />}
                          <span>
                            {msg.moderated
                              ? copy['mobile.chat.moderatedMessage']
                              : msg.mine
                                ? 'You recalled a message'
                                : `${messageSender(msg, conversation).name} recalled a message`}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  const cluster = clusterPositions.get(msg.id)!;
                  const sender = messageSender(msg, conversation);
                  const checking = checkingMessageIds.has(msg.id);
                  return (
                    <div key={msg.id}
                      className={`mp-message-row ${msg.mine ? 'mine' : 'peer'} ${cluster.start ? 'cluster-start' : ''} ${cluster.end ? 'cluster-end' : ''}`}
                      data-scroll-anchor-id={msg.id}
                      data-chat-message-id={msg.id}
                      data-chat-message-own={msg.mine ? 'true' : 'false'}
                      data-chat-cluster-start={cluster.start}
                      data-chat-cluster-end={cluster.end}>
                      {!msg.mine && (
                        <span className="mp-message-avatar-slot">
                          {cluster.start && (
                            <MessageAuthor name={sender.name}><IdentityAvatar
                              name={sender.name}
                              initials={sender.avatar}
                              src={sender.avatarUrl}
                              kind="person"
                              size={32}
                              renderState={uiEvidence.avatarState}
                            /></MessageAuthor>
                          )}
                        </span>
                      )}
                      <div className="mp-message-content">
                        {msg.flagged && (
                          <span className="mp-message-flag" title="Flagged on this device">
                            <FlagIcon size={12} fill="currentColor" />
                          </span>
                        )}
                        {msg.reply && (
                          <div className="mp-reply-quote">
                            <span className="mp-reply-name">{msg.reply.name}</span>
                            <span className="mp-reply-text">{msg.reply.text}</span>
                          </div>
                        )}
                        {msg.image && (
                          <div className="mp-message-image" style={{ background: msg.image }}>
                            <ImageIcon size={28} aria-hidden="true" />
                          </div>
                        )}
                        {msg.file && (
                          <div className="mp-message-file">
                            <div className="mp-file-icon"><File size={22} /></div>
                            <div className="mp-file-info">
                              <Text strong className="mp-file-name">{msg.file.name}</Text>
                              <Text type="secondary" className="mp-file-size">{msg.file.size}</Text>
                            </div>
                          </div>
                        )}
                        {msg.text && (
                          <div
                            className={`mp-bubble ${cluster.start ? 'cluster-start' : ''} ${cluster.end ? 'cluster-end' : ''}`}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              setActionSheetMessage(msg);
                            }}
                          >
                            {msg.pinned && <Pin size={11} className="mp-bubble-pin" />}
                            {msg.text}
                          </div>
                        )}
                        <InlineMessageReplies onOpenThread={() => setThreadMessageId(msg.id)}
                          replies={(msg.threadReplies ?? []).map((reply) => {
                          const author = messageSender(reply, conversation);
                          return {
                            id: reply.id, time: reply.time,
                            body: reply.moderated ? 'Message removed by a moderator'
                              : reply.recalled ? 'Message recalled' : reply.text || (reply.image ? '[Photo]' : '[File]'),
                            avatar: <MessageAuthor name={author.name}><IdentityAvatar name={author.name}
                              initials={author.avatar} src={author.avatarUrl} kind="person" size={20} /></MessageAuthor>,
                          };
                        })} />
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="mp-reaction-row">
                            {msg.reactions.map((reaction) => (
                              <ReactionChip
                                key={reaction.kind}
                                touch
                                emoji={REACTION_EMOJI[reaction.kind]}
                                count={reaction.count}
                                selected={reaction.byMe}
                                reactionId={reaction.kind}
                                label={(reaction.byMe
                                  ? copy['mobile.reaction.removeNamed']
                                  : copy['mobile.reaction.addNamed'])
                                  .replace('{{reaction}}', reactionLabels[reaction.kind])}
                                onClick={() => handleReaction(msg.id, reaction.kind)}
                              />
                            ))}
                            <ReactionChip
                              touch
                              onClick={() => setActionSheetMessage(msg)}
                              label={copy['mobile.reaction.add']}
                            />
                          </div>
                        )}
                        {(cluster.end || msg.status === 'failed' || msg.status === 'unknown') && (
                          <div className={`mp-message-meta ${msg.mine ? 'mine' : 'peer'}`}>
                            <span className="mp-message-time">{msg.time}</span>
                            {msg.mine && msg.status === 'failed' && (
                              <button
                                type="button"
                                className="mp-meta-action mp-meta-action--retry"
                                data-chat-inline-retry
                                aria-label={locale === 'zh' ? '失败，点击重试' : 'Failed, click to retry'}
                                onClick={() => handleRetry(msg.id)}
                              >
                                <RotateCcw size={11} />
                                {locale === 'zh' ? '失败，点击重试' : 'Failed, click to retry'}
                              </button>
                            )}
                            {msg.mine && msg.status === 'unknown' && (
                              <button
                                type="button"
                                className="mp-meta-action mp-meta-action--check"
                                data-chat-inline-check
                                disabled={checking}
                                onClick={() => handleCheckStatus(msg.id)}
                              >
                                <RefreshCw size={11} />
                                {checking ? 'Checking status…' : 'Check status'}
                              </button>
                            )}
                            {msg.mine && msg.status !== 'failed' && msg.status !== 'unknown'
                              ? renderReceipt(msg.status)
                              : null}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                </PrototypeListWindow>

                {isTyping && messages.length <= 200 && (
                  <div className="mp-message-row peer cluster-start cluster-end">
                    <span className="mp-message-avatar-slot">
                      {!conversation.isGroup && <IdentityAvatar
                        name={conversation.name}
                        initials={conversation.avatar}
                        src={conversation.avatarUrl}
                        kind="person"
                        size={32}
                        renderState={uiEvidence.avatarState}
                      />}
                    </span>
                    <div className="mp-typing-bubble">
                      <span className="mp-typing-dot" /><span className="mp-typing-dot" /><span className="mp-typing-dot" />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {replyTo && (
            <div className="mp-reply-banner">
              <CornerUpLeft size={16} className="mp-reply-banner-icon" />
              <div className="mp-reply-banner-content">
                <Text strong className="mp-reply-banner-name">Replying to {replyTo.mine ? 'yourself' : messageSender(replyTo, conversation).name}</Text>
                <Text type="secondary" className="mp-reply-banner-text">{replyTo.text || (replyTo.image ? '[Photo]' : '[File]')}</Text>
              </div>
              <button type="button" className="mp-reply-banner-close" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <X size={16} />
              </button>
            </div>
          )}

          {editingMessage && (
            <div className="mp-reply-banner">
              <Pencil size={16} className="mp-reply-banner-icon" />
              <div className="mp-reply-banner-content">
                <Text strong className="mp-reply-banner-name">Editing message</Text>
                <Text type="secondary" className="mp-reply-banner-text">{editingMessage.text}</Text>
              </div>
              <button type="button" className="mp-reply-banner-close" onClick={() => { setEditingMessage(null); setInputValue(''); }} aria-label="Cancel edit">
                <X size={16} />
              </button>
            </div>
          )}

          <MobileMessageComposer value={inputValue} onChange={setInputValue} onSend={handleSend}
            placeholder={conversation.isGroup ? 'Message the group…' : 'Message…'} state={threadState}
            allowAttachments={!editingMessage} />
        </>
      )}
        </>
      )}

      {/* Toast notification */}
      {toastMessage && <div key={toastKey} className="mp-toast">{toastMessage}</div>}

      {/* Feishu-style action sheet */}
      {actionSheetMessage && (
        <div className="mp-action-sheet-backdrop" onClick={closeActionSheet}>
          <div ref={actionSheetRef} className="mp-action-sheet" role="dialog" aria-modal="true"
            aria-label="Message actions" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="mp-action-sheet-handle" />

            {/* Reaction row */}
            {!actionSheetMessage.recalled && !actionSheetMessage.moderated && (
              <div className="mp-reaction-bar-wrapper">
                <ReactionPicker
                  label={copy['mobile.reaction.choose']}
                  items={REACTION_KINDS.map((kind) => {
                    const selected = actionSheetMessage.reactions
                      ?.some((reaction) => reaction.kind === kind && reaction.byMe) ?? false;
                    const action = selected
                      ? copy['mobile.reaction.removeNamed']
                      : copy['mobile.reaction.addNamed'];
                    return {
                      id: kind,
                      emoji: REACTION_EMOJI[kind],
                      selected,
                      label: action.replace('{{reaction}}', reactionLabels[kind]),
                    };
                  })}
                  onToggle={(kind) => handleReaction(actionSheetMessage.id, kind)}
                />
              </div>
            )}

            {/* Quick action grid: Reply, Forward, Reply in Thread, Copy */}
            <div className="mp-quick-actions-grid">
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('reply')}>
                <CornerUpLeft size={20} />
                <span>Reply</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('forward')}>
                <Forward size={20} />
                <span>Forward</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('thread')}>
                <MessageSquare size={20} />
                <span>Thread</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('copy')}>
                <Copy size={20} />
                <span>Copy</span>
              </button>
            </div>

            {/* List action groups */}
            {actionSheetMessage.mine && !actionSheetMessage.moderated && (
              <div className="mp-action-group">
                <button type="button" className="mp-action-item" onClick={() => handleAction('recall')}>
                  <RotateCcw size={19} /><span>Recall</span>
                </button>
                <button type="button" className="mp-action-item" onClick={() => handleAction('edit')}>
                  <Pencil size={19} /><span>Edit Message</span>
                </button>
              </div>
            )}

            <div className="mp-action-group">
              <button type="button" className="mp-action-item" onClick={() => handleAction('flag')}>
                <FlagIcon size={19} />
                <span>{actionSheetMessage.flagged ? 'Unflag on this device' : 'Flag on this device'}</span>
              </button>
            </div>

            <div className="mp-action-group">
              <button type="button" className="mp-action-item" onClick={() => handleAction('pin')}>
                <Pin size={19} /><span>{actionSheetMessage.pinned ? 'Unpin' : 'Pin'}</span>
              </button>
            </div>

            <div className="mp-action-group">
              {conversation.canModerate && !actionSheetMessage.moderated && (
                <button type="button" className="mp-action-item danger" onClick={() => handleAction('moderate')}>
                  <ShieldX size={19} /><span>{copy['mobile.chat.moderate']}</span>
                </button>
              )}
              <button type="button" className="mp-action-item danger" onClick={() => handleAction('hide-for-me')}>
                <EyeOff size={19} /><span>{copy['mobile.chat.deleteForMe']}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forward Picker Modal */}
      {forwardMessage && (
        <ForwardPicker
          sourceName={messageSender(forwardMessage, conversation).name}
          preview={forwardMessage.text || forwardMessage.file?.name || '[Photo]'}
          onSelect={(name) => {
            showToast(`Forwarded to ${name}`);
            setForwardMessage(null);
          }}
          onClose={() => setForwardMessage(null)}
        />
      )}

      {showPinnedMessages && (
        <div className="mp-pinned-page">
          <header className="mp-chat-details-header">
            <button type="button" className="mp-thread-back"
              onClick={() => setShowPinnedMessages(false)} aria-label="Back">
              <ArrowLeft size={22} />
            </button>
            <span className="mp-chat-details-title">Pinned messages</span>
          </header>
          <div className="mp-pinned-list">
            {pinnedMessages.length === 0 ? (
              <RouteSurfaceState
                title="No pinned messages"
                detail="Pinned messages will remain easy to find here."
              />
            ) : (
              pinnedMessages.map((message) => (
                <button key={message.id} type="button" className="mp-pinned-item"
                  onClick={() => {
                    setShowPinnedMessages(false);
                    setTargetMessageId(message.id);
                  }}>
                  <span className="mp-pinned-item-sender">{messageSender(message, conversation).name}</span>
                  <span className="mp-pinned-item-text">{message.text || '[Media]'}</span>
                  <span className="mp-pinned-item-time">{message.time}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Chat Details Panel */}
      {showChatDetails && (
        <div className="mp-chat-details">
          <header className="mp-chat-details-header">
            <button type="button" className="mp-thread-back" onClick={() => {
              if (detailsView !== 'main') { setDetailsView('main'); }
              else { setShowChatDetails(false); }
            }} aria-label="Back">
              <ArrowLeft size={22} />
            </button>
            <span className="mp-chat-details-title">
              {detailsView === 'main' && 'Details'}
              {detailsView === 'search' && 'Search Chat'}
              {detailsView === 'media' && 'Shared Media'}
              {detailsView === 'files' && 'Shared Files'}
            </span>
          </header>

          {/* Main Details View */}
          {detailsView === 'main' && (
            <div className="mp-chat-details-body">
              <div className="mp-chat-details-profile">
                <IdentityAvatar name={conversation.name} initials={conversation.avatar}
                  src={conversation.avatarUrl} kind={conversation.isGroup ? 'group' : 'person'}
                  size={56} renderState={uiEvidence.avatarState} />
                <Text strong style={{ fontSize: 16, marginTop: 8 }}>{conversation.name}</Text>
                {conversation.isGroup && <Text type="secondary">{conversation.memberCount} members</Text>}
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" onClick={() => setDetailsView('search')}>
                  <span className="mp-chat-details-label">Search Chat History</span>
                  <span className="mp-chat-details-meta" aria-hidden="true" />
                  <ChevronRight size={16} className="mp-row-chevron" />
                </button>
                <button type="button" className="mp-chat-details-item" onClick={() => {
                  setShowChatDetails(false);
                  setShowPinnedMessages(true);
                }}>
                  <span className="mp-chat-details-label">Pinned messages</span>
                  <span className="mp-chat-details-meta">{pinnedMessages.length}</span>
                  <ChevronRight size={16} className="mp-row-chevron" />
                </button>
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" onClick={() => setIsMuted(!isMuted)}>
                  <span>Mute Notifications</span>
                  <div className={`mp-toggle ${isMuted ? 'active' : ''}`}>
                    <div className="mp-toggle-thumb" />
                  </div>
                </button>
                <button type="button" className="mp-chat-details-item" onClick={() => setIsStickyTop(!isStickyTop)}>
                  <span>Sticky on Top</span>
                  <div className={`mp-toggle ${isStickyTop ? 'active' : ''}`}>
                    <div className="mp-toggle-thumb" />
                  </div>
                </button>
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" onClick={() => setDetailsView('media')}>
                  <span>Shared Media</span>
                  <ChevronRight size={16} className="mp-row-chevron" />
                </button>
                <button type="button" className="mp-chat-details-item" onClick={() => setDetailsView('files')}>
                  <span>Shared Files</span>
                  <ChevronRight size={16} className="mp-row-chevron" />
                </button>
              </div>

              <div className="mp-chat-details-section">
                <div className="mp-chat-details-item">
                  <span>Encryption</span>
                  <span className="mp-chat-details-meta"><LockKeyhole size={13} /> End-to-end encrypted</span>
                </div>
                <div className="mp-chat-details-item">
                  <span>Identity source</span>
                  <span className="mp-chat-details-meta">Local Station</span>
                </div>
              </div>

              <div className="mp-chat-details-section">
                <div className="mp-chat-details-section-label">On this device</div>
                <button type="button" className="mp-chat-details-item local-danger" onClick={() => setConfirmAction('clear')}>
                  <span>Clear local chat data</span>
                  <span className="mp-chat-details-meta">This device only</span>
                </button>
              </div>

              <div className="mp-chat-details-section">
                <div className="mp-chat-details-section-label">Safety</div>
                <button type="button" className="mp-chat-details-item danger" onClick={() => setConfirmAction('block')}>
                  <span>{blocked ? 'Unblock Contact' : 'Block Contact'}</span>
                </button>
                <button type="button" className="mp-chat-details-item report-danger" onClick={() => setConfirmAction('report')}>
                  <span>Report</span>
                  <span className="mp-chat-details-meta">Send to safety review</span>
                </button>
              </div>
            </div>
          )}

          {/* Search Chat History Sub-view */}
          {detailsView === 'search' && (
            <ChatHistorySearch messages={messages} conversationKey={conversation.key}
              senderName={(message) => messageSender(message, conversation).name} memory={listMemory} searchDemo={searchDemo} onSelect={(id) => {
                setTargetMessageId(id);
                setDetailsView('main');
                setShowChatDetails(false);
              }} />
          )}

          {/* Shared Media Sub-view */}
          {detailsView === 'media' && (
            <div className="mp-chat-details-body">
              <div className="mp-details-media-grid">
                {messages.filter((m) => m.image && !m.recalled && !m.moderated).length > 0 ? (
                  messages.filter((m) => m.image && !m.recalled && !m.moderated).map((m) => (
                    <div key={m.id} className="mp-details-media-thumb" style={{ background: m.image }} />
                  ))
                ) : (
                  <div className="mp-details-empty" style={{ gridColumn: '1/-1' }}>No shared photos yet</div>
                )}
              </div>
            </div>
          )}

          {detailsView === 'files' && (
            <div className="mp-chat-details-body">
              <div className="mp-details-file-list">
                {messages.filter((message) => message.file && !message.recalled && !message.moderated).length > 0 ? (
                  messages.filter((message) => message.file && !message.recalled && !message.moderated).map((message) => (
                    <button key={message.id} type="button" className="mp-details-file-item"
                      onClick={() => showToast(`${message.file?.name} ready to open`)}>
                      <span className="mp-file-icon"><File size={20} /></span>
                      <span className="mp-file-info">
                        <Text strong className="mp-file-name">{message.file?.name}</Text>
                        <Text type="secondary" className="mp-file-size">{message.file?.size} · {message.time}</Text>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="mp-details-empty">No shared files yet</div>
                )}
              </div>
            </div>
          )}

          {confirmAction && (
            <ConfirmationDialog
              title={confirmAction === 'clear'
                ? 'Clear Local Chat Data?'
                : confirmAction === 'block'
                  ? blocked ? 'Unblock Contact?' : 'Block Contact?'
                  : 'Report this contact?'}
              description={confirmAction === 'clear'
                ? 'Permanently removes messages, search entries, and unreferenced media from this device. Other devices and participants are not affected.'
                : confirmAction === 'block'
                  ? blocked
                    ? `${conversation.name} will be able to message you again.`
                    : `${conversation.name} will no longer be able to send you messages.`
                  : 'This will be reported to our safety team for review.'}
              confirmLabel={confirmAction === 'clear'
                ? 'Clear Local Data'
                : confirmAction === 'block'
                  ? blocked ? 'Unblock' : 'Block'
                  : 'Report'}
              onCancel={() => setConfirmAction(null)}
              onConfirm={() => {
                if (confirmAction === 'clear') {
                  setMessages([]);
                  showToast('Local chat data cleared');
                } else if (confirmAction === 'block') {
                  onBlockedChange(!blocked);
                  showToast(blocked ? 'Contact unblocked' : 'Contact blocked');
                } else {
                  showToast('Report submitted');
                }
                setConfirmAction(null);
              }}
            />
          )}
        </div>
      )}

      {/* Thread View overlay */}
      {threadMessage && (
        <ThreadView message={threadMessage} conversation={conversation}
          onReply={(text, attachment) => handleThreadReply(threadMessage.id, text, attachment)}
          onBack={() => setThreadMessageId(null)} />
      )}
    </div>
  );
}
