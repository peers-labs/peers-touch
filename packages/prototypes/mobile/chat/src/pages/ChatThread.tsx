import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { useLocale, useT } from '../i18n';
import { Icon, IconButton, Switch, Text, TextArea } from '@peers-touch/ui';
import type { Conversation, Message, MessageStatus, MobileUiEvidence } from '../types';
import { REACTION_EMOJI, REACTION_KINDS, type ReactionKind } from '../types';
import {
  QUICK_REACTION_KINDS, messageActionGroups, reportReasonKey, REPORT_REASONS, reactionLabel,
  type MessageActionId, type ReportReason,
} from '../../../../shared/chat-domain';
import { demoSelfIdentity } from '../data';
import { ThreadView } from '../components/ThreadView';
import { ForwardPicker } from '../components/ForwardPicker';
import { PrototypeListWindow, type PrototypeListHandle } from '../components/PrototypeListWindow';
import type { PrototypeListMemory } from '../listPresentation';
import {
  CHAT_JOURNEY,
  CHAT_JOURNEY_COPY,
  CHAT_JOURNEY_MESSAGE_ID,
} from '../../../../shared/chat-journey';
import type { PrototypeCallMediaKind } from '../callPrototype';
import { IdentityAvatar } from '../components/IdentityAvatar';
import { AttachmentCard } from '../components/AttachmentCard';
import {
  InlineSurfaceNotice,
  RouteSurfaceState,
  ThreadSkeleton,
} from '../components/MobileSurfaceState';

const messageKey = (message: Message) => message.id;

/** Map shared catalog action ids to the mobile prototype i18n keys. */
const ACTION_LABEL_KEYS: Record<MessageActionId, string> = {
  thread: 'mobile.chat.thread',
  pin: 'mobile.chat.pinMessage',
  copy: 'mobile.chat.copy',
  multiselect: 'mobile.chat.multiselect',
  'mark-later': 'mobile.chat.markLater',
  edit: 'mobile.chat.edit',
  recall: 'mobile.chat.recall',
  report: 'mobile.chat.report',
  moderate: 'mobile.chat.moderate',
  hide: 'mobile.chat.deleteForMe',
  reply: 'mobile.chat.reply',
  forward: 'mobile.chat.forward',
};
function mobileActionLabel(id: MessageActionId, t: (key: string) => string): string {
  return t(ACTION_LABEL_KEYS[id]);
}

export function ChatThread({ conversation, onBack, onStartCall, messages, onMessagesChange: setMessages, listMemory, uiEvidence, onSearch, onTargetConsumed, messageId, threadRootMessageId }: {
  conversation: Conversation;
  onBack: () => void;
  onStartCall?: (mediaKind: PrototypeCallMediaKind) => void;
  messages: Message[];
  onMessagesChange: Dispatch<SetStateAction<Message[]>>;
  listMemory: PrototypeListMemory;
  onSearch?: () => void;
  onTargetConsumed?: () => void;
  messageId?: string;
  threadRootMessageId?: string;
  uiEvidence: MobileUiEvidence;
}) {
  const t = useT();
  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionSheetMessage, setActionSheetMessage] = useState<Message | null>(null);
  const [isTyping] = useState(
    messages.length > 0
      && !messages.some((message) => message.status === 'failed' || message.status === 'unknown'),
  );
  const [threadMessage, setThreadMessage] = useState<Message | null>(() =>
    messages.find(message => message.id === threadRootMessageId) ?? null);
  const [showPinnedMessages, setShowPinnedMessages] = useState(false);
  const [showEmojiGrid, setShowEmojiGrid] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const [showChatDetails, setShowChatDetails] = useState(false);
  const [detailsView, setDetailsView] = useState<'main' | 'media' | 'marked'>('main');
  // Bulk multiselect: client-only mode batching forward / copy / hide.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Message-level moderation report (reason-coded), distinct from contact report.
  const [reportMessage, setReportMessage] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [forwardMessages, setForwardMessages] = useState<Message[]>([]);
  const [hideConfirmIds, setHideConfirmIds] = useState<string[] | null>(null);
  const [targetMessageId, setTargetMessageId] = useState<string | null>(messageId ?? null);
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const messageWindow = useRef<PrototypeListHandle>(null);
  const retryTimers = useRef<Set<number>>(new Set());
  const [isMuted, setIsMuted] = useState(conversation.muted ?? false);
  const [isStickyTop, setIsStickyTop] = useState(conversation.pinned ?? false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'clear' | 'block' | 'report' | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [threadState, setThreadState] = useState(uiEvidence.chatThreadState);
  const [checkingMessageIds, setCheckingMessageIds] = useState<Set<string>>(new Set());
  const locale = useLocale();
  const journeyCopy = CHAT_JOURNEY_COPY[locale];
  const failedMessages = messages.filter((message) => message.status === 'failed');

  const clusterPositions = useMemo(() => {
    const positions = new Map<string, { start: boolean; end: boolean }>();
    const sameCluster = (left?: Message, right?: Message) => Boolean(
      left
      && right
      && !left.dateLabel
      && !right.dateLabel
      && !left.recalled
      && !right.recalled
      && !left.moderated
      && !right.moderated
      && left.mine === right.mine,
    );
    messages.forEach((message, index) => {
      if (message.dateLabel) return;
      positions.set(message.id, {
        start: !sameCluster(messages[index - 1], message),
        end: !sameCluster(message, messages[index + 1]),
      });
    });
    return positions;
  }, [messages]);

  useEffect(() => () => {
    retryTimers.current.forEach((timer) => window.clearTimeout(timer));
    retryTimers.current.clear();
  }, []);

  useLayoutEffect(() => {
    if (!targetMessageId || showChatDetails || showPinnedMessages || threadMessage) return;
    setTargetUnavailable(!messageWindow.current?.reveal(targetMessageId));
    setTargetMessageId(null);
    onTargetConsumed?.();
  }, [targetMessageId, showChatDetails, showPinnedMessages, threadMessage]);

  useEffect(() => {
    setThreadState(uiEvidence.chatThreadState);
  }, [uiEvidence.chatThreadState]);

  function handleSend() {
    const text = inputValue.trim();
    if (!text) return;

    if (editingMessage) {
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
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
      reply: replyTo ? { name: replyTo.mine ? t('common.me') : conversation.name, text: replyTo.text || (replyTo.image ? t('mobile.chat.previewImage') : t('mobile.chat.previewFile')) } : undefined,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputValue('');
    setReplyTo(null);
  }

  function handleRetry(messageId: string) {
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

  const selectableMessages = useMemo(
    () => messages.filter(m => !m.dateLabel && !m.recalled && !m.moderated),
    [messages],
  );
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedMessages = selectableMessages.filter(m => selectedSet.has(m.id));

  function enterSelectMode(seedId?: string) {
    setSelectMode(true);
    setSelectedIds(seedId ? [seedId] : []);
    setActionSheetMessage(null);
    setShowEmojiGrid(false);
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds([]);
  }
  const toggleSelected = (id: string) => setSelectedIds(list =>
    list.includes(id) ? list.filter(entry => entry !== id) : [...list, id]);

  function handleAction(action: MessageActionId) {
    const message = actionSheetMessage;
    if (!message) return;
    switch (action) {
      case 'reply':
        setReplyTo(message);
        setActionSheetMessage(null);
        break;
      case 'thread':
        setThreadMessage(message);
        setActionSheetMessage(null);
        break;
      case 'forward':
        setForwardMessages([message]);
        setActionSheetMessage(null);
        break;
      case 'copy':
        if (message.text) void navigator.clipboard.writeText(message.text);
        showToast(t('mobile.chat.copied'));
        setActionSheetMessage(null);
        break;
      case 'edit':
        setEditingMessage(message);
        setInputValue(message.text ?? '');
        setActionSheetMessage(null);
        break;
      case 'hide':
        setHideConfirmIds([message.id]);
        setActionSheetMessage(null);
        break;
      case 'moderate':
        setMessages(prev => prev.map(m =>
          m.id === message.id
            ? { ...m, moderated: true, text: undefined, image: undefined, file: undefined }
            : m,
        ));
        showToast(t('mobile.chat.moderatedMessage'));
        setActionSheetMessage(null);
        break;
      case 'recall':
        setMessages(prev => prev.map(m =>
          m.id === message.id ? { ...m, recalled: true, text: undefined, image: undefined, file: undefined } : m,
        ));
        setActionSheetMessage(null);
        break;
      case 'pin':
        setMessages(prev => prev.map(m =>
          m.id === message.id ? { ...m, pinned: !m.pinned } : m,
        ));
        showToast(message.pinned ? t('mobile.chat.unpinMessage') : t('mobile.chat.pinMessage'));
        setActionSheetMessage(null);
        break;
      case 'multiselect':
        enterSelectMode(message.id);
        break;
      case 'mark-later':
        setMessages(prev => prev.map(m =>
          m.id === message.id ? { ...m, markedForLater: !m.markedForLater } : m,
        ));
        showToast(message.markedForLater
          ? t('mobile.chat.unmarkLater')
          : t('mobile.chat.markedForLater'));
        setActionSheetMessage(null);
        break;
      case 'report':
        setReportMessage(message);
        setReportReason(null);
        setActionSheetMessage(null);
        break;
    }
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

  // Multi-select reactions: the sheet stays open so several kinds can be
  // chosen in one pass; zero-count kinds drop off automatically.
  function handleReaction(msgId: string, kind: ReactionKind) {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      const existing = m.reactions ?? [];
      const found = existing.find((r) => r.kind === kind);
      if (found && found.byMe) {
        const updated = existing
          .map((r) => r.kind === kind ? { ...r, byMe: false, count: r.count - 1 } : r)
          .filter((r) => r.count > 0);
        return { ...m, reactions: updated };
      }
      if (found) {
        return { ...m, reactions: existing.map((r) => r.kind === kind ? { ...r, byMe: true, count: r.count + 1 } : r) };
      }
      return { ...m, reactions: [...existing, { kind, byMe: true, count: 1 }] };
    }));
  }

  function bulkCopy() {
    if (!selectedMessages.length) return;
    void navigator.clipboard.writeText(selectedMessages.map(m => m.text ?? '').filter(Boolean).join('\n'));
    showToast(t('mobile.chat.copied'));
  }

  function receiptIcon(status?: MessageStatus) {
    if (status === 'failed') return <Icon iconId="error" size={14} className="mp-receipt mp-receipt--failed" label={journeyCopy.deliveryFailed} />;
    if (status === 'unknown') return <Icon iconId="attention" size={14} className="mp-receipt mp-receipt--unknown" label={t('mobile.chat.receiptUnknown')} />;
    if (status === 'sending') return <Icon iconId="refresh-ccw" size={13} className="mp-receipt mp-receipt--pending" label={journeyCopy.retrying} />;
    if (status === 'read') return <Icon iconId="check-check" size={14} className="mp-receipt mp-receipt--read" label={t('mobile.chat.statusRead')} />;
    if (status === 'delivered') return <Icon iconId="check-check" size={14} className="mp-receipt" label={t('mobile.chat.statusDelivered')} />;
    if (status === 'sent') return <Icon iconId="check" size={14} className="mp-receipt" label={t('mobile.chat.statusSent')} />;
    return <Icon iconId="clock" size={13} className="mp-receipt mp-receipt--pending" label={t('mobile.chat.statusPending')} />;
  }

  const pinnedMessage = messages.find((m) => m.pinned && !m.dateLabel && !m.recalled && !m.moderated);
  const pinnedMessages = messages.filter((m) => m.pinned && !m.dateLabel && !m.recalled && !m.moderated);
  const markedMessages = messages.filter((m) => m.markedForLater && !m.dateLabel && !m.recalled && !m.moderated);

  // Long-press opens the same action sheet as right-click / secondary touch.
  const pressTimer = useRef<number | null>(null);
  function startLongPress(message: Message) {
    if (selectMode) return;
    pressTimer.current = window.setTimeout(() => setActionSheetMessage(message), 420);
  }
  function cancelLongPress() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }
  useEffect(() => cancelLongPress, []);

  // Mobile edit/recall have no time-window gate in the prototype; copy needs text.
  const actionGroupsFor = (message: Message) => messageActionGroups({
    mine: message.mine,
    canModerate: conversation.canModerate ?? false,
    hasText: Boolean(message.text),
    inMutationWindow: true,
  });

  return (
    <div className="mp-thread">
      {!showChatDetails && !showPinnedMessages && !threadMessage && (
        <>
      <header className="mp-thread-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label={t('mobile.chat.back')}>
          <Icon iconId="arrow-left" size={22} />
        </button>
        <div className="mp-thread-contact">
          <IdentityAvatar
            name={conversation.name}
            initials={conversation.avatar}
            src={conversation.avatarUrl}
            kind={conversation.isGroup ? 'group' : 'person'}
            size={32}
            renderState={uiEvidence.avatarState}
          />
          <div className="mp-thread-contact-info">
            <Text strong className="mp-thread-name">{conversation.name}</Text>
          </div>
        </div>
        {!conversation.isGroup && onStartCall ? (
          <>
            <IconButton actionId="thread.call-audio" iconId="phone" label={t('mobile.chat.startAudioCall')} emphasis="quiet"
              iconSize={19} onActivate={() => onStartCall('audio')} />
            <IconButton actionId="thread.call-video" iconId="video" label={t('mobile.chat.startVideoCall')} emphasis="quiet"
              iconSize={19} onActivate={() => onStartCall('video')} />
          </>
        ) : null}
        <IconButton actionId="thread.more" iconId="more-vertical" label={t('mobile.chat.moreActions')} emphasis="quiet"
          iconSize={19} onActivate={() => setShowChatDetails(true)} />
      </header>

      {failedMessages.length > 1 && (
        <InlineSurfaceNotice
          tone="error"
          title={`${failedMessages.length} messages need attention`}
          detail={t('mobile.chat.failedOwnRetry')}
        />
      )}

      {pinnedMessage && threadState !== 'route-error' && (
        <button type="button" className="mp-pinned-banner" onClick={() => setShowPinnedMessages(true)}>
          <Icon iconId="pin" size={14} />
          <span className="mp-pinned-banner-content">
            <Text tone="muted" className="mp-pinned-banner-label">{t('mobile.chat.messagePinned')}</Text>
            <Text className="mp-pinned-banner-text" truncate>{pinnedMessage.text || t('mobile.chat.mediaTag')}</Text>
          </span>
          <Icon iconId="chevron-right" size={16} />
        </button>
      )}

      {threadState === 'route-error' ? (
        <RouteSurfaceState
          title={t('mobile.chat.threadUnavailableTitle')}
          detail={t('mobile.chat.threadUnavailableBody')}
          actionLabel="Retry"
          onAction={handleRouteRetry}
        />
      ) : (
        <>
          <div className="mp-thread-messages" data-prototype-page="messages" data-ui-rows="chat-messages" data-ui-balance="inline">
            {threadState === 'initial-loading' ? (
              <ThreadSkeleton />
            ) : (
              <>
                {threadState === 'history-loading' && (
                  <InlineSurfaceNotice
                    title={t('mobile.chat.loadingHistory')}
                    detail={t('mobile.chat.loadingHistoryBody')}
                  />
                )}
                {targetUnavailable && (
                  <Text tone="secondary" role="status">{t('mobile.chat.messageUnavailable')}</Text>
                )}
                {messages.length === 0 && (
                  <RouteSurfaceState
                    title={t('mobile.chat.emptyThread')}
                    detail={t('mobile.chat.emptyThreadBody')}
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
                          <Icon iconId={msg.moderated ? 'shield-x' : 'rotate-ccw'} size={12} />
                          <span>
                            {msg.moderated
                              ? t('mobile.chat.moderatedMessage')
                              : msg.mine
                                ? t('mobile.chat.youRecalled')
                                : t('mobile.chat.peerRecalled', { name: conversation.name })}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  const cluster = clusterPositions.get(msg.id) ?? { start: true, end: true };
                  const checking = checkingMessageIds.has(msg.id);
                  const showSender = conversation.isGroup && !msg.mine && cluster.start;
                  const selected = selectedSet.has(msg.id);
                  return (
                    <div key={msg.id}
                      className={`mp-message-row ${msg.mine ? 'mine' : 'peer'} ${cluster.start ? 'cluster-start' : ''} ${cluster.end ? 'cluster-end' : ''} ${showSender ? 'has-sender' : ''} ${selectMode ? 'is-selectable' : ''} ${selected ? 'is-selected' : ''}`}
                      data-scroll-anchor-id={msg.id} data-ui-row={msg.mine ? 'outgoing-message' : 'incoming-message'}
                      data-select-check={msg.id} data-checked={selected ? 'true' : 'false'}
                      onClick={selectMode ? () => toggleSelected(msg.id) : undefined}
                      onContextMenu={(event) => {
                        if (selectMode) return;
                        event.preventDefault();
                        setActionSheetMessage(msg);
                      }}
                      onTouchStart={() => startLongPress(msg)}
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onTouchCancel={cancelLongPress}>
                      {selectMode && (
                        <span className={`mp-row-check ${selected ? 'is-checked' : ''}`} aria-hidden="true">
                          {selected && <Icon iconId="check" size={13} />}
                        </span>
                      )}
                      {showSender && (
                        <span className="mp-message-sender" data-ui-column="sender" data-ui-column-align="start">{conversation.name}</span>
                      )}
                      <span className="mp-message-avatar-slot" data-ui-column="avatar" data-ui-column-align="center">
                        {cluster.start && (
                          <IdentityAvatar
                            name={msg.mine ? demoSelfIdentity.name : conversation.name}
                            initials={msg.mine ? demoSelfIdentity.initials : conversation.avatar}
                            src={msg.mine ? demoSelfIdentity.avatarUrl : conversation.avatarUrl}
                            kind={!msg.mine && conversation.isGroup ? 'group' : 'person'}
                            size={30}
                            renderState={uiEvidence.avatarState}
                          />
                        )}
                      </span>
                      <div className="mp-message-content" data-ui-column="body" data-ui-column-align={msg.mine ? 'end' : 'start'}>
                        {msg.markedForLater && (
                          <span className="mp-message-mark" title={t('mobile.chat.markedForLater')}
                            data-msg-marked>
                            <Icon iconId="bookmark" size={12} />
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
                            <Icon iconId="image" size={28} />
                          </div>
                        )}
                        {msg.file && (
                          <AttachmentCard file={msg.file} />
                        )}
                        {msg.text && (
                          <div
                            className={`mp-bubble ${cluster.start ? 'cluster-start' : ''} ${cluster.end ? 'cluster-end' : ''}`}
                          >
                            {msg.pinned && <Icon iconId="pin" size={11} className="mp-bubble-pin" />}
                            {msg.text}
                          </div>
                        )}
                        {msg.threadCount && msg.threadCount > 0 && (
                          <button type="button" className="mp-thread-badge" onClick={() => setThreadMessage(msg)}>
                            <Icon iconId="message-square" size={12} />
                            <span>{t('mobile.chat.threadReplyCount').replace('{{count}}', String(msg.threadCount))}</span>
                          </button>
                        )}
                        {msg.reactions && msg.reactions.length > 0 && (
                          <div className="mp-reaction-row">
                            {msg.reactions.map((reaction) => (
                              <button
                                key={reaction.kind}
                                type="button"
                                className={`mp-reaction-chip ${reaction.byMe ? 'mine' : ''}`}
                                onClick={() => handleReaction(msg.id, reaction.kind)}
                                aria-pressed={reaction.byMe}
                              >
                                <span>{REACTION_EMOJI[reaction.kind]}</span>
                                <span className="mp-reaction-count">{reaction.count}</span>
                              </button>
                            ))}
                            <button
                              type="button"
                              className="mp-reaction-add"
                              onClick={() => setActionSheetMessage(msg)}
                              aria-label={t('mobile.chat.addReactionShort')}
                            >
                              <Icon iconId="smile-plus" size={15} />
                            </button>
                          </div>
                        )}
                        {(cluster.end || msg.status === 'failed' || msg.status === 'unknown') && (
                          <div className={`mp-message-meta ${msg.mine ? 'mine' : 'peer'}`}>
                            <span className="mp-message-time">{msg.time}</span>
                            {msg.mine && receiptIcon(msg.status)}
                          </div>
                        )}
                        {msg.status === 'failed' && (
                          <button
                            type="button"
                            className="mp-message-retry"
                            onClick={() => handleRetry(msg.id)}
                          >
                            <Icon iconId="rotate-ccw" size={12} />
                            {journeyCopy.retry}
                          </button>
                        )}
                        {msg.status === 'unknown' && (
                          <button
                            type="button"
                            className="mp-message-retry unknown"
                            disabled={checking}
                            onClick={() => handleCheckStatus(msg.id)}
                          >
                            <Icon iconId="refresh-ccw" size={12} />
                            {checking ? 'Checking status...' : 'Check status'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                </PrototypeListWindow>

                {isTyping && messages.length <= 200 && (
                  <div className="mp-message-row peer cluster-start cluster-end">
                    <span className="mp-message-avatar-slot">
                      <IdentityAvatar
                        name={conversation.name}
                        initials={conversation.avatar}
                        src={conversation.avatarUrl}
                        kind={conversation.isGroup ? 'group' : 'person'}
                        size={30}
                        renderState={uiEvidence.avatarState}
                      />
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
              <Icon iconId="corner-up-left" size={16} className="mp-reply-banner-icon" />
              <div className="mp-reply-banner-content">
                <Text strong className="mp-reply-banner-name">Replying to {replyTo.mine ? 'yourself' : conversation.name}</Text>
                <Text tone="secondary" className="mp-reply-banner-text">{replyTo.text || (replyTo.image ? t('mobile.chat.previewImage') : t('mobile.chat.previewFile'))}</Text>
              </div>
              <button type="button" className="mp-reply-banner-close" onClick={() => setReplyTo(null)} aria-label={t('mobile.chat.cancelReply')}>
                <Icon iconId="close" size={16} />
              </button>
            </div>
          )}

          {editingMessage && (
            <div className="mp-reply-banner">
              <Icon iconId="edit-note" size={16} className="mp-reply-banner-icon" />
              <div className="mp-reply-banner-content">
                <Text strong className="mp-reply-banner-name">{t('mobile.chat.editing')}</Text>
                <Text tone="secondary" className="mp-reply-banner-text">{editingMessage.text}</Text>
              </div>
              <button type="button" className="mp-reply-banner-close" onClick={() => { setEditingMessage(null); setInputValue(''); }} aria-label={t('mobile.chat.cancelEdit')}>
                <Icon iconId="close" size={16} />
              </button>
            </div>
          )}

          <div className="mp-composer" data-thread-state={threadState}>
            <button type="button" className="mp-composer-attach" aria-label={t('mobile.chat.attach')}><Icon iconId="plus" size={22} /></button>
            <TextArea
              className="mp-composer-input"
              value={inputValue}
              placeholder={t('mobile.chat.messagePlaceholder')}
              minimumRows={1}
              maximumRows={4}
              framing="embedded"
              onValueChange={setInputValue}
              onEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); handleSend(); } }}
            />
            <button type="button" className={`mp-composer-send ${inputValue.trim() ? 'active' : ''}`} onClick={handleSend} aria-label={t('mobile.chat.send')} disabled={!inputValue.trim()}>
              <Icon iconId="send" size={18} />
            </button>
          </div>
        </>
      )}
        </>
      )}

      {toastMessage && <div key={toastKey} className="mp-toast">{toastMessage}</div>}

      {actionSheetMessage && (
        <div className="mp-action-sheet-backdrop" onClick={() => { setActionSheetMessage(null); setShowEmojiGrid(false); }}>
          <div className="mp-action-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('mobile.chat.messageActions')}>
            <div className="mp-action-sheet-handle" />

            {!actionSheetMessage.recalled && !actionSheetMessage.moderated && (
              <div className="mp-reaction-bar-wrapper">
                <div className="mp-reaction-bar" data-react-bar={showEmojiGrid ? 'all' : 'quick'}>
                  {(showEmojiGrid ? REACTION_KINDS : QUICK_REACTION_KINDS).map((kind) => {
                    const reacted = actionSheetMessage.reactions?.some(r => r.kind === kind && r.byMe);
                    return (
                      <button
                        key={kind}
                        type="button"
                        className={`mp-reaction-bar-btn ${reacted ? 'is-selected' : ''}`}
                        data-react-kind={kind}
                        aria-pressed={reacted}
                        aria-label={reactionLabel(kind, locale)}
                        onClick={() => handleReaction(actionSheetMessage.id, kind)}
                      >
                        {REACTION_EMOJI[kind]}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="mp-reaction-more-btn"
                  onClick={() => setShowEmojiGrid(!showEmojiGrid)}
                  aria-label={t('mobile.chat.allReactions')}
                  aria-expanded={showEmojiGrid}
                  data-react-toggle
                >
                  <Icon iconId={showEmojiGrid ? 'smile-plus' : 'more-horizontal'} size={18} />
                </button>
              </div>
            )}

            <div className="mp-quick-actions-grid">
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('reply')}>
                <Icon iconId="corner-up-left" size={20} />
                <span>{t('mobile.chat.reply')}</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('forward')}>
                <Icon iconId="forward" size={20} />
                <span>{t('mobile.chat.forward')}</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('thread')}>
                <Icon iconId="message-square" size={20} />
                <span>{t('mobile.chat.thread')}</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('copy')}>
                <Icon iconId="copy" size={20} />
                <span>{t('mobile.chat.copy')}</span>
              </button>
            </div>

            {/* Groups derive from the shared action catalog so ownership and
                order cannot fork from the desktop menu. */}
            {actionGroupsFor(actionSheetMessage).map(({ group, actions }) => (
              <div key={group} className="mp-action-group">
                {actions.map((action) => {
                  const label = action.id === 'pin' && actionSheetMessage.pinned
                    ? t('mobile.chat.unpinMessage')
                    : action.id === 'mark-later' && actionSheetMessage.markedForLater
                      ? t('mobile.chat.unmarkLater')
                      : mobileActionLabel(action.id, t);
                  return (
                    <button key={action.id} type="button"
                      className={`mp-action-item ${action.danger ? 'danger' : ''} ${action.enabled ? '' : 'is-disabled'}`}
                      disabled={!action.enabled}
                      data-action-id={action.id}
                      onClick={() => action.enabled && handleAction(action.id)}>
                      <Icon iconId={action.iconId as ComponentProps<typeof Icon>['iconId']} size={19} />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {selectMode && (
        <div className="mp-bulk-bar" data-bulk-bar role="toolbar" aria-label={t('mobile.chat.multiselect')}>
          <span className="mp-bulk-count" data-bulk-count>{t('mobile.chat.selectCount', { n: selectedIds.length })}</span>
          <button type="button" className="mp-bulk-btn" data-bulk-forward disabled={!selectedIds.length}
            onClick={() => setForwardMessages(selectedMessages)}>
            <Icon iconId="forward" size={18} /><span>{t('mobile.chat.bulkForward')}</span>
          </button>
          <button type="button" className="mp-bulk-btn" data-bulk-copy disabled={!selectedIds.length} onClick={bulkCopy}>
            <Icon iconId="copy" size={18} /><span>{t('mobile.chat.bulkCopy')}</span>
          </button>
          <button type="button" className="mp-bulk-btn danger" data-bulk-hide disabled={!selectedIds.length}
            onClick={() => setHideConfirmIds(selectedIds)}>
            <Icon iconId="eye-off" size={18} /><span>{t('mobile.chat.bulkHide')}</span>
          </button>
          <button type="button" className="mp-bulk-btn" data-bulk-cancel onClick={exitSelectMode}>
            <Icon iconId="close" size={18} /><span>{t('mobile.chat.bulkCancel')}</span>
          </button>
        </div>
      )}

      {hideConfirmIds && (
        <div className="mp-confirm-backdrop" onClick={() => setHideConfirmIds(null)}>
          <div className="mp-confirm-dialog" role="dialog" aria-label={t('mobile.chat.deleteForMe')} onClick={e => e.stopPropagation()}>
            <strong>{hideConfirmIds.length > 1 ? t('mobile.chat.bulkHideConfirmTitle', { n: hideConfirmIds.length }) : t('mobile.chat.deleteForMeConfirmTitle')}</strong>
            <span>{t('mobile.chat.deleteForMeConfirmBody')}</span>
            <div className="mp-confirm-actions">
              <button type="button" className="mp-confirm-cancel" onClick={() => setHideConfirmIds(null)}>
                {t('mobile.chat.cancel')}
              </button>
              <button type="button" className="mp-confirm-ok danger" data-hide-confirm={hideConfirmIds.length > 1 ? 'bulk' : 'one'}
                onClick={() => {
                  const ids = new Set(hideConfirmIds);
                  setMessages(prev => prev.filter(m => !ids.has(m.id)));
                  showToast(t('mobile.chat.deleteForMe'));
                  setHideConfirmIds(null);
                  exitSelectMode();
                }}>
                {t('mobile.chat.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {reportMessage && (
        <div className="mp-confirm-backdrop" onClick={() => setReportMessage(null)}>
          <div className="mp-confirm-dialog mp-report-sheet" role="dialog" aria-label={t('mobile.chat.reportTitle')}
            onClick={e => e.stopPropagation()} data-report-dialog>
            <strong>{t('mobile.chat.reportTitle')}</strong>
            <span className="mp-report-body">{t('mobile.chat.reportBody')}</span>
            <div className="mp-report-reasons">
              {REPORT_REASONS.map(code => (
                <button key={code} type="button" className={`mp-report-reason ${reportReason === code ? 'is-selected' : ''}`}
                  aria-pressed={reportReason === code} data-report-reason={code}
                  onClick={() => setReportReason(code)}>
                  {t(reportReasonKey(code))}
                </button>
              ))}
            </div>
            <div className="mp-confirm-actions">
              <button type="button" className="mp-confirm-cancel" onClick={() => setReportMessage(null)}>
                {t('mobile.chat.cancel')}
              </button>
              <button type="button" className="mp-confirm-ok danger" data-report-submit
                disabled={!reportReason}
                onClick={() => {
                  setReportMessage(null);
                  setReportReason(null);
                  showToast(t('mobile.chat.reportDone'));
                }}>
                {t('mobile.chat.reportSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {forwardMessages.length > 0 && (
        <ForwardPicker
          onSelect={(name) => {
            const count = forwardMessages.length;
            showToast(count > 1 ? `${t('mobile.chat.forwardTo')} ${name} · ${count}` : `↦ ${name}`);
            setForwardMessages([]);
            exitSelectMode();
          }}
          onClose={() => setForwardMessages([])}
        />
      )}

      {showPinnedMessages && (
        <div className="mp-pinned-page">
          <header className="mp-chat-details-header">
            <button type="button" className="mp-thread-back"
              onClick={() => setShowPinnedMessages(false)} aria-label={t('mobile.chat.back')}>
              <Icon iconId="arrow-left" size={22} />
            </button>
            <span className="mp-chat-details-title">{t('mobile.chat.pinnedMessages')}</span>
          </header>
          <div className="mp-pinned-list">
            {pinnedMessages.length === 0 ? (
              <RouteSurfaceState
                title={t('mobile.chat.noPinnedMessages')}
                detail={t('mobile.chat.pinnedEmptyBody')}
              />
            ) : (
              pinnedMessages.map((message) => (
                <button key={message.id} type="button" className="mp-pinned-item"
                  onClick={() => {
                    setShowPinnedMessages(false);
                    setTargetMessageId(message.id);
                  }}>
                  <span className="mp-pinned-item-sender">{message.mine ? t('common.me') : conversation.name}</span>
                  <span className="mp-pinned-item-text">{message.text || t('mobile.chat.mediaTag')}</span>
                  <span className="mp-pinned-item-time">{message.time}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {showChatDetails && (
        <div className="mp-chat-details">
          <header className="mp-chat-details-header">
            <button type="button" className="mp-thread-back" onClick={() => {
              if (detailsView !== 'main') { setDetailsView('main'); }
              else { setShowChatDetails(false); }
            }} aria-label={t('mobile.chat.back')}>
              <Icon iconId="arrow-left" size={22} />
            </button>
            <span className="mp-chat-details-title">
              {detailsView === 'main' && t('mobile.chat.detailsTitle')}
              {detailsView === 'media' && t('mobile.chat.sharedMedia')}
              {detailsView === 'marked' && t('mobile.chat.markedListTitle')}
            </span>
          </header>

          {detailsView === 'main' && (
            <div className="mp-chat-details-body">
              <div className="mp-chat-details-profile">
                <IdentityAvatar name={conversation.name} initials={conversation.avatar}
                  src={conversation.avatarUrl} kind={conversation.isGroup ? 'group' : 'person'}
                  size={56} renderState={uiEvidence.avatarState} />
                <Text strong>{conversation.name}</Text>
                {conversation.isGroup && <Text tone="secondary">{t('mobile.chat.membersCount', { n: conversation.memberCount ?? 0 })}</Text>}
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" onClick={onSearch}>
                  <span>{t('mobile.chat.searchHistory')}</span>
                  <Icon iconId="chevron-right" size={16} />
                </button>
              </div>

              <div className="mp-chat-details-section">
                <div className="mp-chat-details-item">
                  <span>{t('mobile.chat.muteNotifications')}</span>
                  <Switch checked={isMuted} onCheckedChange={setIsMuted} aria-label={t('mobile.chat.muteNotifications')} />
                </div>
                <div className="mp-chat-details-item">
                  <span>{t('mobile.chat.stickyOnTop')}</span>
                  <Switch checked={isStickyTop} onCheckedChange={setIsStickyTop} aria-label={t('mobile.chat.stickyOnTop')} />
                </div>
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" data-details-marked
                  onClick={() => setDetailsView('marked')}>
                  <span>{t('mobile.chat.markedListTitle')}</span>
                  <Icon iconId="chevron-right" size={16} />
                </button>
                <button type="button" className="mp-chat-details-item" onClick={() => setDetailsView('media')}>
                  <span>{t('mobile.chat.sharedMedia')}</span>
                  <Icon iconId="chevron-right" size={16} />
                </button>
              </div>

              <div className="mp-chat-details-section">
                <div className="mp-chat-details-item">
                  <span>{t('mobile.chat.encryption')}</span>
                  <span className="mp-chat-details-meta"><Icon iconId="lock-keyhole" size={13} /> {t('mobile.chat.encrypted')}</span>
                </div>
                <div className="mp-chat-details-item">
                  <span>{t('mobile.chat.identitySource')}</span>
                  <span className="mp-chat-details-meta">{t('mobile.chat.identityLocal')}</span>
                </div>
              </div>

              <div className="mp-chat-details-section">
                <div className="mp-chat-details-section-label">{t('mobile.chat.onThisDevice')}</div>
                <button type="button" className="mp-chat-details-item local-danger" onClick={() => setConfirmAction('clear')}>
                  <span>{t('mobile.chat.clearLocalData')}</span>
                  <span className="mp-chat-details-meta">{t('mobile.chat.thisDeviceOnly')}</span>
                </button>
              </div>

              <div className="mp-chat-details-section">
                <div className="mp-chat-details-section-label">{t('mobile.chat.safety')}</div>
                <button type="button" className="mp-chat-details-item danger" onClick={() => setConfirmAction('block')}>
                  <span>{isBlocked ? t('mobile.chat.unblockTitle') : t('mobile.chat.blockTitle')}</span>
                </button>
                <button type="button" className="mp-chat-details-item" style={{ color: 'var(--pt-secondary)' }} onClick={() => setConfirmAction('report')}>
                  <span>{t('mobile.chat.report')}</span>
                  <span className="mp-chat-details-meta">{t('mobile.chat.safetyReview')}</span>
                </button>
              </div>
            </div>
          )}

          {detailsView === 'media' && (
            <div className="mp-chat-details-body">
              <div className="mp-details-media-grid">
                {messages.filter((m) => m.image && !m.recalled && !m.moderated).length > 0 ? (
                  messages.filter((m) => m.image && !m.recalled && !m.moderated).map((m) => (
                    <div key={m.id} className="mp-details-media-thumb" style={{ background: m.image }} />
                  ))
                ) : (
                  <div className="mp-details-empty" style={{ gridColumn: '1/-1' }}>{t('mobile.chat.noSharedPhotos')}</div>
                )}
              </div>
            </div>
          )}

          {detailsView === 'marked' && (
            <div className="mp-chat-details-body">
              <div className="mp-details-marked-list">
                {markedMessages.length === 0 ? (
                  <RouteSurfaceState title={t('mobile.chat.markedEmpty')} detail="" />
                ) : (
                  markedMessages.map((message) => (
                    <button key={message.id} type="button" className="mp-details-marked-row"
                      data-marked-item={message.id}
                      onClick={() => {
                        setDetailsView('main');
                        setShowChatDetails(false);
                        setTargetMessageId(message.id);
                      }}>
                      <Icon iconId="bookmark" size={13} />
                      <span>{message.text || t('mobile.chat.mediaTag')}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {confirmAction && (
            <div className="mp-confirm-backdrop" onClick={() => setConfirmAction(null)}>
              <div className="mp-confirm-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="mp-confirm-title">
                  {confirmAction === 'clear' && t('mobile.chat.clearTitle')}
                  {confirmAction === 'block' && (isBlocked ? t('mobile.chat.unblockTitle') : t('mobile.chat.blockTitle'))}
                  {confirmAction === 'report' && t('mobile.chat.contactReportTitle')}
                </div>
                <div className="mp-confirm-desc">
                  {confirmAction === 'clear' && t('mobile.chat.clearBody')}
                  {confirmAction === 'block' && (isBlocked
                    ? t('mobile.chat.unblockBody', { name: conversation.name })
                    : t('mobile.chat.blockBody', { name: conversation.name }))}
                  {confirmAction === 'report' && t('mobile.chat.contactReportBody')}
                </div>
                <div className="mp-confirm-actions">
                  <button type="button" className="mp-confirm-btn" onClick={() => setConfirmAction(null)}>{t('mobile.chat.cancel')}</button>
                  <button type="button" className="mp-confirm-btn mp-confirm-btn--danger" onClick={() => {
                    if (confirmAction === 'clear') {
                      setMessages([]);
                      showToast(t('mobile.chat.clearDone'));
                    } else if (confirmAction === 'block') {
                      setIsBlocked(!isBlocked);
                      showToast(isBlocked ? t('mobile.chat.unblockedDone') : t('mobile.chat.blockedDone'));
                    } else if (confirmAction === 'report') {
                      showToast(t('mobile.chat.contactReportDone'));
                    }
                    setConfirmAction(null);
                  }}>
                    {confirmAction === 'clear' && t('mobile.chat.clearAction')}
                    {confirmAction === 'block' && (isBlocked ? t('mobile.chat.unblockAction') : t('mobile.chat.blockAction'))}
                    {confirmAction === 'report' && t('mobile.chat.report')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {threadMessage && (
        <ThreadView message={messages.find(message => message.id === threadMessage.id) ?? threadMessage}
          conversation={conversation} targetId={messageId}
          onReply={reply => setMessages(current => current.map(message => message.id === threadMessage.id
            ? { ...message, threadReplies: [...(message.threadReplies ?? []), reply],
              threadCount: (message.threadReplies?.length ?? 0) + 1 } : message))}
          onBack={threadRootMessageId ? onBack : () => setThreadMessage(null)} />
      )}
    </div>
  );
}
