import { Fragment, useEffect, useMemo, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Button, Checkbox, Empty, Icon } from '@peers-touch/ui';
import { chatMediaKindForAttachment, isRecalledChatMessage } from '@peers-touch/client-chat-core';

import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList, type BoundedListHandle } from '../../components/BoundedList';
import {
  chatMessageAttachments,
  formatRelativeTime,
  messageDisplayText,
  isOwnChatMessage,
  messageTimestampMillis,
} from '../../features/chat/chatSelectors';
import {
  isChatMessageCommandBusy,
  type ChatMessageCommandOutcome,
} from '../../features/chat/messageCommandState';
import {
  messageDeliveryDisplayState,
  messageProjectionMetadata,
  type MessageDeliveryDisplayState,
} from '../../features/chat/messageProjection';
import type {
  SocialMessage,
  SocialMessageAttachment,
  PeerProfile,
} from '../../features/social/socialTypes';
import { actorDisplayName } from '../../features/social/socialProjection';
import { buildThreadTimelineUnits } from '../../features/chat/threadTimeline';
import { MessageAvatar } from './ChatMessagePresentation';

export interface MessageMetaRenderInput {
  readonly message: SocialMessage;
  readonly deliveryState: MessageDeliveryDisplayState | null;
  readonly commandOutcome: ChatMessageCommandOutcome | undefined;
  readonly canRetry: boolean;
  readonly recalled: boolean;
}

interface ChatMessageSectionBoundaryProps {
  readonly surfaceKey: string;
  readonly background: string;
  readonly messages: SocialMessage[];
  readonly historyById: ReadonlyMap<string, SocialMessage>;
  readonly currentUserPtid: string | null;
  readonly highlightedMessageUlid: string;
  readonly ownAvatar: string;
  readonly ownName: string;
  readonly peerProfiles: Record<string, PeerProfile | null>;
  readonly peerMessageAvatar: string | undefined;
  readonly peerName: string;
  readonly title: string;
  readonly flaggedMessageIds: ReadonlySet<string>;
  readonly messageCommandOutcomes: Readonly<Record<string, ChatMessageCommandOutcome>>;
  readonly windowSize: number;
  readonly controllerRef: Ref<BoundedListHandle>;
  readonly renderAttachments: (
    attachments: SocialMessageAttachment[],
    isOwn: boolean,
  ) => ReactNode;
  readonly renderMetaRow: (input: MessageMetaRenderInput) => ReactNode;
  readonly onScrollToMessage: (messageUlid: string) => void;
  readonly onToggleReaction: (message: SocialMessage, reaction: string) => void;
  readonly onOpenActions?: (message: SocialMessage) => void;
  readonly selectionActive?: boolean;
  readonly selectedIds?: ReadonlySet<string>;
  readonly onToggleSelection?: (messageId: string) => void;
  /** Opens the dedicated thread surface for a root message card. */
  readonly onOpenThread?: (message: SocialMessage) => void;
  /** When set, the list renders a thread tree: a separated root block and a
      "N replies" division instead of one flat bubble stream. */
  readonly threadRootUlid?: string;
}

export function ChatMessageSectionBoundary({
  surfaceKey,
  background,
  messages,
  historyById,
  currentUserPtid,
  highlightedMessageUlid,
  ownAvatar,
  ownName,
  peerProfiles,
  peerMessageAvatar,
  peerName,
  title,
  flaggedMessageIds,
  messageCommandOutcomes,
  windowSize,
  controllerRef,
  renderAttachments,
  renderMetaRow,
  onScrollToMessage,
  onToggleReaction,
  onOpenActions,
  selectionActive = false,
  selectedIds,
  onToggleSelection,
  onOpenThread,
  threadRootUlid,
}: ChatMessageSectionBoundaryProps) {
  const { t } = useMobileI18n();
  const isThreadView = Boolean(threadRootUlid);
  const threadReplyCount = isThreadView
    ? messages.filter((message) => message.ulid !== threadRootUlid).length
    : 0;
  // Main timeline: thread replies nest under their root as one card instead
  // of rendering as flat quote-style rows. The thread view keeps the flat
  // root + replies stream with its named divider.
  const timelineUnits = useMemo(
    () => (isThreadView ? [] : buildThreadTimelineUnits(messages)),
    [isThreadView, messages],
  );

  return (
    <section
      className={`message-list chat-background-${background}${isThreadView ? ' thread-view' : ''}`}
      data-message-viewport
      data-product-surface={messages.length === 0 ? 'chat.thread-empty' : undefined}
      data-thread-root={isThreadView ? threadRootUlid : undefined}
    >
      {messages.length === 0 ? (
        <Empty description={t('mobile.chat.emptyThread')} />
      ) : isThreadView ? (
        <BoundedList
          surfaceKey={surfaceKey}
          items={messages}
          itemKey={messageKey}
          size={windowSize}
          initial="end"
          controllerRef={controllerRef}
        >
          {(windowedMessages) => windowedMessages.map((message) => renderMessageRow(message))}
        </BoundedList>
      ) : (
        <BoundedList
          surfaceKey={surfaceKey}
          items={timelineUnits}
          itemKey={(unit) => unit.key}
          size={windowSize}
          initial="end"
          controllerRef={controllerRef}
        >
          {(windowedUnits) => windowedUnits.map((unit) => renderMessageRow(unit.root, unit.replies))}
        </BoundedList>
      )}
    </section>
  );

  function renderMessageRow(
    message: SocialMessage,
    nestedReplies: ReadonlyArray<SocialMessage> | null = null,
  ) {
    const mine = isOwnChatMessage(message, currentUserPtid);
    const senderProfile = peerProfiles[message.senderPtid];
    const senderName = actorDisplayName(
      senderProfile?.displayName || senderProfile?.username, message.senderPtid,
    ) || actorDisplayName(peerName, '') || t('mobile.contacts.unknownUser');
    const recalled = isRecalledChatMessage(message);
    const metadata = messageProjectionMetadata(message);
    const moderated = metadata.moderated;
    const content = moderated
      ? t('mobile.chat.moderatedMessage')
      : messageDisplayText(message, t);
    const attachments = chatMessageAttachments(message);
    // Render a text line only when the message carries real text. An
    // attachment-only message has no body text, so its filename must
    // never leak into the bubble as a pseudo message (the filename is
    // still available on the attachment thumbnail / its alt text).
    const hasRealText = !moderated && message.content.trim().length > 0;
    // Desktop parity (ChatMessageRow mediaOnlyMessage): an image-only
    // message is a bare full-bleed picture — transparent bubble, zero
    // padding, no ink fill — instead of a dark box with empty space.
    const bareImageBubble = !moderated
      && !hasRealText
      && attachments.length > 0
      && attachments.every((attachment) => chatMediaKindForAttachment(attachment) === 'image');
    const deliveryState = mine && !recalled && !moderated
      ? messageDeliveryDisplayState(message)
      : null;
    const replyMessage = message.replyToUlid
      ? historyById.get(message.replyToUlid)
      : undefined;
    const reactions = aggregateMessageReactions(
      metadata.reactions,
      currentUserPtid,
    );
    const commandOutcome = messageCommandOutcomes[message.ulid];
    const commandBusy = isChatMessageCommandBusy(commandOutcome);
    const canRetry = deliveryState === 'failed'
      && attachments.length === 0
      && Boolean(message.content.trim());
    const isThreadRoot = isThreadView && message.ulid === threadRootUlid;

    // Recalled messages are a quiet centered service pill, not a bubble:
    // both desktop (borderless secondary) and the mobile prototype
    // (.ma-msg-service) drop avatar + bubble chrome for retractions.
    if (recalled) {
      return (
        <MessageGestureBoundary
          key={message.ulid}
          enabled={false}
          onHold={() => onOpenActions?.(message)}
          data-message-ulid={message.ulid}
          data-scroll-anchor-id={message.ulid}
          tabIndex={-1}
          data-message-retracted="true"
          className="message-service-row"
        >
          <span className="message-service-pill">{content}</span>
        </MessageGestureBoundary>
      );
    }
    const row = (
      <MessageGestureBoundary
        key={message.ulid}
        enabled={!moderated}
        onHold={() => onOpenActions?.(message)}
        onSelect={selectionActive ? () => onToggleSelection?.(message.ulid) : undefined}
        data-message-selected={selectedIds?.has(message.ulid) ? 'true' : undefined}
        data-message-ulid={message.ulid}
        data-scroll-anchor-id={message.ulid}
        tabIndex={-1}
        data-message-state={metadata.messagingState ?? ''}
        data-message-moderated={moderated ? 'true' : undefined}
        className={`message-bubble-row ${mine ? 'mine' : 'peer'} ${highlightedMessageUlid === message.ulid ? 'highlighted' : ''}${isThreadView ? (isThreadRoot ? ' is-thread-root' : ' thread-reply-row') : ''}`}
      >
        {selectionActive && !moderated ? (
          <Checkbox aria-label={t('mobile.chat.selectMessage')} checked={selectedIds?.has(message.ulid) ?? false}
            onCheckedChange={() => onToggleSelection?.(message.ulid)} />
        ) : null}
        {!mine ? (
          <MessageAvatar
            src={messageAvatarUrl(message, peerProfiles, peerMessageAvatar)}
            fallback={senderName}
          />
        ) : null}
        {/* Column mirrors the prototype .ma-msg-col: the bubble is one
            child; pin flags, reactions and the quiet meta row are
            siblings beneath it, never inset inside the ink bubble. */}
        <div className="message-bubble-col">
          {!mine && !peerName ? (
            <span className="message-sender-name">{senderName}</span>
          ) : null}
          {metadata.pinnedByPtid ? (
            <span className="message-pin-indicator">
              <Icon iconId="pin" size={11} />
              <span>{t('mobile.chat.messagePinned')}</span>
            </span>
          ) : null}
          <div className={`message-bubble${bareImageBubble ? ' message-bubble--bare-image' : ''}`}>
            {/* A thread reply defaults its quote to the root, which already
                pins the context at the top of the thread view — repeating it
                on every reply is redundant. An explicit quote to another
                reply is a real cross-reference and stays visible. */}
            {!moderated
              && message.replyToUlid
              && !(isThreadView && message.replyToUlid === threadRootUlid) ? (
              <Button
                actionId={`chat.quote.${message.ulid}`}
                emphasis="quiet"
                className="message-reply-quote"
                onActivate={() => {
                  if (replyMessage) onScrollToMessage(replyMessage.ulid);
                }}
              >
                <Icon iconId="corner-up-left" size={12} />
                <span>
                  {replyMessage
                    ? messageContentForSearch(replyMessage, t)
                    : t('mobile.chat.noPreview')}
                </span>
              </Button>
            ) : null}
            {hasRealText ? (
              <span className="message-text">{message.content}</span>
            ) : null}
            {!moderated && attachments.length > 0
              ? renderAttachments(attachments, mine)
              : null}
            {!moderated && nestedReplies && nestedReplies.length > 0 ? (
              <MessageThreadPreview
                root={message}
                replies={nestedReplies}
                currentUserPtid={currentUserPtid}
                ownAvatar={ownAvatar}
                ownName={ownName}
                peerProfiles={peerProfiles}
                peerMessageAvatar={peerMessageAvatar}
                peerName={peerName}
                highlightedMessageUlid={highlightedMessageUlid}
                onOpenThread={onOpenThread}
              />
            ) : null}
          </div>
          {!moderated && reactions.length > 0 ? (
            <div className="message-reaction-row">
              {reactions.map((reaction) => (
                <Button
                  key={reaction.reaction}
                  actionId={`chat.reaction.${message.ulid}.${reaction.reaction}`}
                  emphasis="quiet" density="comfortable"
                  className={`message-reaction-chip ${reaction.reactedByCurrentUser ? 'active' : ''}`}
                  aria-label={t('mobile.chat.reactWith', { reaction: reaction.reaction })}
                  aria-pressed={reaction.reactedByCurrentUser}
                  availability={commandBusy ? { kind: 'disabled', reason: t('mobile.chat.commandPending') } : undefined}
                  onActivate={() => onToggleReaction(message, reaction.reaction)}
                >
                  <span aria-hidden="true">{reaction.reaction}</span>
                  {reaction.count > 1 ? <span>{reaction.count}</span> : null}
                </Button>
              ))}
            </div>
          ) : null}
          {renderMetaRow({
            message,
            deliveryState,
            commandOutcome,
            canRetry,
            recalled: moderated,
          })}
        </div>
        {mine ? (
          <MessageAvatar
            src={ownAvatar}
            fallback={ownName.slice(0, 1).toUpperCase()}
          />
        ) : null}
      </MessageGestureBoundary>
    );
    // Thread tree: the root row gets a divider beneath it that names the
    // reply section, so root and replies read as parent/children rather
    // than one flat bubble stream (mobile prototype .ma-thread-root).
    if (!isThreadRoot) return row;
    return (
      <Fragment key={message.ulid}>
        {row}
        <div
          className={`thread-replies-divider${mine ? ' is-own' : ''}`}
          role="separator"
        >
          <span className="thread-replies-divider__label">
            {t('mobile.chat.threadReplyCount', { count: threadReplyCount })}
          </span>
        </div>
      </Fragment>
    );
  }
}

/** Long-press opens message actions; a scrolling gesture cancels the pending hold. */
function MessageGestureBoundary({
  enabled, onHold, onSelect, children, ...props
}: HTMLAttributes<HTMLDivElement> & {
  enabled: boolean; onHold: () => void; onSelect?: () => void;
}) {
  const pending = useRef<{ timer: number; x: number; y: number } | null>(null);
  const held = useRef(false);
  const cancel = () => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
  };
  useEffect(() => cancel, []);
  return <div {...props}
    onPointerDown={event => {
      cancel(); held.current = false;
      if (!enabled || event.button !== 0 || (event.target as Element).closest('button,input,a,audio,video')) return;
      const x = event.clientX, y = event.clientY;
      pending.current = { x, y, timer: window.setTimeout(() => {
        pending.current = null; held.current = true;
        if (onSelect) onSelect(); else onHold();
      }, 500) };
    }}
    onPointerMove={event => {
      if (pending.current && Math.hypot(event.clientX - pending.current.x, event.clientY - pending.current.y) > 12) cancel();
    }}
    onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
    onClickCapture={event => {
      if (held.current) { held.current = false; event.preventDefault(); event.stopPropagation(); }
      else if (onSelect && enabled && !(event.target as Element).closest('button,input,a,audio,video')) { event.preventDefault(); onSelect(); }
    }}
    onContextMenu={event => {
      if (!enabled) return;
      event.preventDefault(); cancel();
      if (held.current) return;
      if (onSelect) onSelect(); else onHold();
    }}
  >{children}</div>;
}

export function messageKey(message: SocialMessage): string {
  return message.ulid;
}

/**
 * Thread replies rendered inside the root message bubble itself. The replies
 * read as part of the original message (one light panel, no dark fill, no
 * side rail) and the whole block opens the dedicated thread surface.
 */
function MessageThreadPreview({
  root,
  replies,
  currentUserPtid,
  ownAvatar,
  ownName,
  peerProfiles,
  peerMessageAvatar,
  peerName,
  highlightedMessageUlid,
  onOpenThread,
}: {
  readonly root: SocialMessage;
  readonly replies: ReadonlyArray<SocialMessage>;
  readonly currentUserPtid: string | null;
  readonly ownAvatar: string;
  readonly ownName: string;
  readonly peerProfiles: Record<string, PeerProfile | null>;
  readonly peerMessageAvatar: string | undefined;
  readonly peerName: string;
  readonly highlightedMessageUlid: string;
  readonly onOpenThread?: (message: SocialMessage) => void;
}) {
  const { t } = useMobileI18n();
  const openLabel = t('mobile.chat.threadReplyCount', { count: replies.length });
  return (
    <button
      type="button"
      className="message-thread-preview"
      data-message-thread-root={root.ulid}
      data-message-thread-replies={replies.length}
      aria-label={openLabel}
      onClick={() => onOpenThread?.(root)}
    >
      {replies.map((reply) => {
        const ownReply = isOwnChatMessage(reply, currentUserPtid);
        const profile = peerProfiles[reply.senderPtid];
        const senderName = actorDisplayName(
          profile?.displayName || profile?.username, reply.senderPtid,
        ) || actorDisplayName(peerName, '') || t('mobile.contacts.unknownUser');
        return (
          <span
            key={reply.ulid}
            data-message-ulid={reply.ulid}
            className={`message-thread-preview__reply${highlightedMessageUlid === reply.ulid ? ' highlighted' : ''}`}
          >
            <MessageAvatar
              src={ownReply
                ? ownAvatar
                : (profile?.avatar || peerMessageAvatar || '')}
              fallback={ownReply ? ownName : senderName}
            />
            <span className="message-thread-preview__reply-col">
              <span className="message-thread-preview__reply-head">
                <span className="message-thread-preview__sender">{senderName}</span>
                <span className="message-thread-preview__time">
                  {formatRelativeTime(messageTimestampMillis(reply), t)}
                </span>
              </span>
              <span className="message-thread-preview__text">
                {threadReplyPreviewText(reply, t)}
              </span>
            </span>
          </span>
        );
      })}
      <span className="message-thread-preview__open">
        <Icon iconId="message-square" size={13} />
        <span>{openLabel}</span>
      </span>
    </button>
  );
}

function threadReplyPreviewText(
  message: SocialMessage,
  t: ReturnType<typeof useMobileI18n>['t'],
): string {
  const text = messageDisplayText(message, t).trim();
  if (text) return text;
  const attachments = chatMessageAttachments(message);
  return attachments[0]?.filename?.trim() || t('mobile.chat.attachmentUnnamed');
}

export function chatMessageSenderPtids(
  messages: SocialMessage[],
  currentUserPtid: string | null,
): string[] {
  return Array.from(new Set(messages
    .map((message) => message.senderPtid)
    .filter((ptid) => Boolean(ptid && ptid !== currentUserPtid))));
}

export function messageContentForSearch(
  message: SocialMessage,
  t: (key: string) => string,
): string {
  if (messageProjectionMetadata(message).moderated) {
    return t('mobile.chat.moderatedMessage');
  }
  return messageDisplayText(message, t);
}

function messageAvatarUrl(
  message: SocialMessage,
  peerProfiles: Record<string, PeerProfile | null>,
  fallbackAvatar: string | undefined,
): string {
  return peerProfiles[message.senderPtid]?.avatar || fallbackAvatar || '';
}

function aggregateMessageReactions(
  reactions: ReadonlyArray<{
    readonly actorPtid: string;
    readonly reaction: string;
  }>,
  currentUserPtid: string | null,
): Array<{
  reaction: string;
  count: number;
  reactedByCurrentUser: boolean;
}> {
  const grouped = new Map<string, { count: number; reactedByCurrentUser: boolean }>();
  reactions.forEach((item) => {
    const current = grouped.get(item.reaction) ?? {
      count: 0,
      reactedByCurrentUser: false,
    };
    grouped.set(item.reaction, {
      count: current.count + 1,
      reactedByCurrentUser:
        current.reactedByCurrentUser || item.actorPtid === currentUserPtid,
    });
  });
  return Array.from(grouped, ([reaction, state]) => ({ reaction, ...state }));
}
