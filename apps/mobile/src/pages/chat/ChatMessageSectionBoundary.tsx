import { useEffect, useRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Button, Checkbox, Empty, Icon } from '@peers-touch/ui';
import { isRecalledChatMessage } from '@peers-touch/client-chat-core';

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
}: ChatMessageSectionBoundaryProps) {
  const { t } = useMobileI18n();

  return (
    <section
      className={`message-list chat-background-${background}`}
      data-message-viewport
      data-product-surface={messages.length === 0 ? 'chat.thread-empty' : undefined}
    >
      {messages.length === 0 ? (
        <Empty description={t('mobile.chat.emptyThread')} />
      ) : (
        <BoundedList
          surfaceKey={surfaceKey}
          items={messages}
          itemKey={messageKey}
          size={windowSize}
          initial="end"
          controllerRef={controllerRef}
        >
          {(windowedMessages) => windowedMessages.map((message) => {
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
            const hasAttachmentOnlyPreview = attachments.length > 0
              && content === t('mobile.chat.noPreview');
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

            return (
              <MessageGestureBoundary
                key={message.ulid}
                enabled={!recalled && !moderated}
                onHold={() => onOpenActions?.(message)}
                onSelect={selectionActive ? () => onToggleSelection?.(message.ulid) : undefined}
                data-message-selected={selectedIds?.has(message.ulid) ? 'true' : undefined}
                data-message-ulid={message.ulid}
                data-scroll-anchor-id={message.ulid}
                tabIndex={-1}
                data-message-state={metadata.messagingState ?? ''}
                data-message-moderated={moderated ? 'true' : undefined}
                className={`message-bubble-row ${mine ? 'mine' : 'peer'} ${highlightedMessageUlid === message.ulid ? 'highlighted' : ''}`}
              >
                {selectionActive && !recalled && !moderated ? (
                  <Checkbox aria-label={t('mobile.chat.selectMessage')} checked={selectedIds?.has(message.ulid) ?? false}
                    onCheckedChange={() => onToggleSelection?.(message.ulid)} />
                ) : null}
                {!mine ? (
                  <MessageAvatar
                    src={messageAvatarUrl(message, peerProfiles, peerMessageAvatar)}
                    fallback={senderName}
                  />
                ) : null}
                <div className="message-bubble">
                  {!mine && !peerName ? (
                    <span className="message-sender-name">{senderName}</span>
                  ) : null}
                  {metadata.pinnedByPtid ? (
                    <span className="message-pin-indicator">
                      <Icon iconId="pin" size={11} />
                      <span>{t('mobile.chat.messagePinned')}</span>
                    </span>
                  ) : null}
                  {!moderated && message.replyToUlid ? (
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
                  {!hasAttachmentOnlyPreview ? (
                    <span className="message-text">{content}</span>
                  ) : null}
                  {!recalled && !moderated && attachments.length > 0
                    ? renderAttachments(attachments, mine)
                    : null}
                  {!recalled && !moderated && reactions.length > 0 ? (
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
                          <span>{reaction.reaction}</span>
                          <span>{reaction.count}</span>
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {renderMetaRow({
                    message,
                    deliveryState,
                    commandOutcome,
                    canRetry,
                    recalled: recalled || moderated,
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
          })}
        </BoundedList>
      )}
    </section>
  );
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
