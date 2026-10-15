import { useMemo, type ReactNode, type Ref } from 'react';
import { Empty, Typography } from 'antd';
import { CornerUpLeft, Pin } from 'lucide-react';
import { isRecalledChatMessage } from '@peers-touch/client-chat-core';

import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList, type BoundedListHandle } from '../../components/BoundedList';
import { ReactionChip } from '../../components/reactions/ReactionChip';
import { MessageAuthor } from '../../components/chat/MessageAuthor';
import { InlineMessageReplies } from '../../components/chat/InlineMessageReplies';
import { MobileAvatar } from '../../components/MobileAvatar';
import {
  chatMessageAttachments,
  chatMessageAuthorName,
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
import {
  projectChatMessageClusters,
} from './chatMessageClusters';
import { MessageAvatar } from './ChatMessagePresentation';

const { Text } = Typography;

export interface MessageMetaRenderInput {
  readonly message: SocialMessage;
  readonly deliveryState: MessageDeliveryDisplayState | null;
  readonly commandOutcome: ChatMessageCommandOutcome | undefined;
  readonly canRetry: boolean;
  readonly recalled: boolean;
  readonly showMetadata: boolean;
}

interface ChatMessageSectionBoundaryProps {
  readonly surfaceKey: string;
  readonly background: string;
  readonly messages: SocialMessage[];
  readonly historyById: ReadonlyMap<string, SocialMessage>;
  readonly repliesByRoot?: ReadonlyMap<string, SocialMessage[]>;
  readonly isThread?: boolean;
  readonly isGroup?: boolean;
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
  readonly onOpenThread?: (message: SocialMessage) => void;
}

export function ChatMessageSectionBoundary({
  surfaceKey,
  background,
  messages,
  historyById,
  repliesByRoot,
  isThread = false,
  isGroup = false,
  currentUserPtid,
  highlightedMessageUlid,
  ownAvatar,
  ownName,
  peerProfiles,
  peerMessageAvatar,
  peerName,
  flaggedMessageIds,
  messageCommandOutcomes,
  windowSize,
  controllerRef,
  renderAttachments,
  renderMetaRow,
  onScrollToMessage,
  onToggleReaction,
  onOpenThread,
}: ChatMessageSectionBoundaryProps) {
  const { t } = useMobileI18n();
  const authorName = (message: SocialMessage) => chatMessageAuthorName(
    message, currentUserPtid, ownName, peerProfiles, !isGroup ? peerName : '',
  );
  const clusteredMessages = useMemo(
    () => projectChatMessageClusters(
      messages,
      currentUserPtid,
      messageCommandOutcomes,
    ),
    [currentUserPtid, messageCommandOutcomes, messages],
  );

  return (
    <section
      className={`message-list chat-background-${background}`}
      data-message-viewport
      data-product-surface={messages.length === 0 ? 'chat.thread-empty' : undefined}
    >
      {messages.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.emptyThread')} />
      ) : (
        <BoundedList
          surfaceKey={surfaceKey}
          items={clusteredMessages}
          itemKey={(entry) => messageKey(entry.message)}
          size={windowSize}
          initial="end"
          controllerRef={controllerRef}
        >
          {(windowedMessages) => windowedMessages.map((entry) => {
            const { message } = entry;
            const mine = isOwnChatMessage(message, currentUserPtid);
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
            const metaRow = renderMetaRow({
              message,
              deliveryState,
              commandOutcome,
              canRetry,
              recalled: recalled || moderated,
              showMetadata: entry.showMetadata,
            });

            return (
              <div
                key={message.ulid}
                data-message-ulid={message.ulid}
                data-message-cluster-id={entry.clusterId}
                data-message-cluster-position={entry.position}
                data-scroll-anchor-id={message.ulid}
                tabIndex={-1}
                data-message-state={metadata.messagingState ?? ''}
                data-message-moderated={moderated ? 'true' : undefined}
                className={`message-bubble-row ${mine ? 'mine' : 'peer'} ${highlightedMessageUlid === message.ulid ? 'highlighted' : ''}`}
              >
                {!mine
                  ? entry.showAvatar
                    ? (
                        <MessageAuthor name={authorName(message)}>
                          <MessageAvatar
                            name={authorName(message)}
                            identityKey={message.senderPtid}
                            src={messageAvatarUrl(message, peerProfiles, isGroup ? undefined : peerMessageAvatar)}
                            fallback={authorName(message).slice(0, 1).toUpperCase()}
                          />
                        </MessageAuthor>
                      )
                    : <span className="message-avatar-spacer" aria-hidden="true" />
                  : null}
                {!mine && !entry.showMetadata ? metaRow : null}
                <div className="message-bubble">
                  {metadata.pinnedByPtid ? (
                    <span className="message-pin-indicator">
                      <Pin size={11} />
                      <span>{t('mobile.chat.messagePinned')}</span>
                    </span>
                  ) : null}
                  {!moderated && message.replyToUlid ? (
                    <button
                      type="button"
                      className="message-reply-quote"
                      onClick={() => {
                        if (replyMessage) onScrollToMessage(replyMessage.ulid);
                      }}
                    >
                      <CornerUpLeft size={12} />
                      <span>
                        {replyMessage ? `${authorName(replyMessage)}: ` : ''}
                        {replyMessage
                          ? messageContentForSearch(replyMessage, t)
                          : t('mobile.chat.noPreview')}
                      </span>
                    </button>
                  ) : null}
                  {!hasAttachmentOnlyPreview ? (
                    <Text className="message-text">{content}</Text>
                  ) : null}
                  {!recalled && !moderated && attachments.length > 0
                    ? renderAttachments(attachments, mine)
                    : null}
                  {!recalled && !moderated && reactions.length > 0 ? (
                    <div className="message-reaction-row">
                      {reactions.map((reaction) => (
                        <ReactionChip
                          key={reaction.reaction}
                          emoji={reaction.reaction}
                          count={reaction.count}
                          selected={reaction.reactedByCurrentUser}
                          label={t('mobile.chat.reactWith', { reaction: reaction.reaction })}
                          disabled={commandBusy}
                          onClick={() => onToggleReaction(message, reaction.reaction)}
                        />
                      ))}
                    </div>
                  ) : null}
                  {!isThread && !recalled && !moderated && onOpenThread ? (
                    <InlineMessageReplies
                      replies={(repliesByRoot?.get(message.ulid) ?? []).map((reply) => ({
                        id: reply.ulid,
                        avatar: (
                          <MessageAuthor name={authorName(reply)}>
                            <MobileAvatar size={24} name={authorName(reply)} identityKey={reply.senderPtid}
                              src={isOwnChatMessage(reply, currentUserPtid) ? ownAvatar
                                : messageAvatarUrl(reply, peerProfiles, isGroup ? undefined : peerMessageAvatar)} />
                          </MessageAuthor>
                        ),
                        body: (
                          <>
                            {messageContentForSearch(reply, t)}
                            {!isRecalledChatMessage(reply) && !messageProjectionMetadata(reply).moderated
                              && chatMessageAttachments(reply).length
                              ? renderAttachments(chatMessageAttachments(reply), isOwnChatMessage(reply, currentUserPtid))
                              : null}
                          </>
                        ),
                        time: formatRelativeTime(messageTimestampMillis(reply), t),
                      }))}
                      onOpenThread={() => onOpenThread(message)}
                    />
                  ) : null}
                  {entry.showMetadata ? metaRow : null}
                </div>
                {mine && !entry.showMetadata ? metaRow : null}
                {mine
                  ? entry.showAvatar
                    ? (
                        <MessageAuthor name={ownName}>
                          <MessageAvatar src={ownAvatar} name={ownName} identityKey={currentUserPtid ?? ''}
                            fallback={ownName.slice(0, 1).toUpperCase()} />
                        </MessageAuthor>
                      )
                    : <span className="message-avatar-spacer" aria-hidden="true" />
                  : null}
              </div>
            );
          })}
        </BoundedList>
      )}
    </section>
  );
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
