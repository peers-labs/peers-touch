import type { ReactNode, Ref } from 'react';
import { Empty, Typography } from 'antd';
import { CornerUpLeft, Pin } from 'lucide-react';
import { isRecalledChatMessage } from '@peers-touch/client-chat-core';

import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList, type BoundedListHandle } from '../../components/BoundedList';
import {
  chatMessageAttachments,
  formatRelativeTime,
  friendMessageDisplayText,
  groupMessageDisplayText,
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
} from '../../features/chat/messagingProjectionAdapters';
import { projectGroupMessageDisplay } from '../../features/group/groupProjection';
import type {
  GroupMember,
  GroupMessage,
} from '../../gen/proto/domain/chat/group_chat_pb';
import type {
  FriendChatMessage,
  FriendMessageAttachment,
  PeerProfile,
} from '../../features/social/socialTypes';
import { MessageAvatar } from './ChatMessagePresentation';

const { Text } = Typography;

type ChatMessage = FriendChatMessage | GroupMessage;
type ChatAttachment = FriendMessageAttachment;

export interface MessageMetaRenderInput {
  readonly message: ChatMessage;
  readonly deliveryState: MessageDeliveryDisplayState | null;
  readonly commandOutcome: ChatMessageCommandOutcome | undefined;
  readonly canRetry: boolean;
  readonly recalled: boolean;
}

interface ChatMessageSectionBoundaryProps {
  readonly surfaceKey: string;
  readonly background: string;
  readonly messages: ChatMessage[];
  readonly historyById: ReadonlyMap<string, ChatMessage>;
  readonly isGroupThread: boolean;
  readonly currentUserPtid: string | null;
  readonly highlightedMessageUlid: string;
  readonly ownAvatar: string;
  readonly ownName: string;
  readonly peerProfiles: Record<string, PeerProfile | null>;
  readonly peerMessageAvatar: string | undefined;
  readonly groupMemberByPtid: ReadonlyMap<string, GroupMember>;
  readonly peerName: string;
  readonly title: string;
  readonly flaggedMessageIds: ReadonlySet<string>;
  readonly messageCommandOutcomes: Readonly<Record<string, ChatMessageCommandOutcome>>;
  readonly windowSize: number;
  readonly controllerRef: Ref<BoundedListHandle>;
  readonly renderAttachments: (
    attachments: ChatAttachment[],
    isOwn: boolean,
  ) => ReactNode;
  readonly renderMetaRow: (input: MessageMetaRenderInput) => ReactNode;
  readonly onScrollToMessage: (messageUlid: string) => void;
  readonly onToggleReaction: (message: ChatMessage, reaction: string) => void;
}

export function ChatMessageSectionBoundary({
  surfaceKey,
  background,
  messages,
  historyById,
  isGroupThread,
  currentUserPtid,
  highlightedMessageUlid,
  ownAvatar,
  ownName,
  peerProfiles,
  peerMessageAvatar,
  groupMemberByPtid,
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
}: ChatMessageSectionBoundaryProps) {
  const { t } = useMobileI18n();

  return (
    <section className={`message-list chat-background-${background}`} data-message-viewport>
      {messages.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.emptyThread')} />
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
            const recalled = isRecalledChatMessage(message);
            const metadata = messageProjectionMetadata(message);
            const moderated = metadata.moderated;
            const groupDisplay = isGroupThread
              ? projectGroupMessageDisplay(message as GroupMessage)
              : null;
            const content = moderated
              ? t('mobile.chat.moderatedMessage')
              : groupDisplay
                ? groupMessageDisplayText(groupDisplay, t)
                : friendMessageDisplayText(message as FriendChatMessage, t);
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
              <div
                key={message.ulid}
                data-message-ulid={message.ulid}
                data-scroll-anchor-id={message.ulid}
                tabIndex={-1}
                data-message-state={metadata.messagingState ?? ''}
                data-message-moderated={moderated ? 'true' : undefined}
                className={`message-bubble-row ${mine ? 'mine' : 'peer'} ${highlightedMessageUlid === message.ulid ? 'highlighted' : ''}`}
              >
                {!mine ? (
                  <MessageAvatar
                    src={messageAvatarUrl(message, peerProfiles, peerMessageAvatar)}
                    fallback={messageSenderFallback(message, groupMemberByPtid, peerName || title)}
                  />
                ) : null}
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
                        {replyMessage
                          ? messageContentForSearch(replyMessage, isGroupThread, t)
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
                        <button
                          key={reaction.reaction}
                          type="button"
                          className={`message-reaction-chip ${reaction.reactedByCurrentUser ? 'active' : ''}`}
                          aria-label={t('mobile.chat.reactWith', { reaction: reaction.reaction })}
                          aria-pressed={reaction.reactedByCurrentUser}
                          disabled={commandBusy}
                          onClick={() => onToggleReaction(message, reaction.reaction)}
                        >
                          <span>{reaction.reaction}</span>
                          <span>{reaction.count}</span>
                        </button>
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
              </div>
            );
          })}
        </BoundedList>
      )}
    </section>
  );
}

export function messageKey(message: ChatMessage): string {
  return message.ulid;
}

export function chatMessageSenderPtids(
  messages: ChatMessage[],
  currentUserPtid: string | null,
): string[] {
  return Array.from(new Set(messages
    .map((message) => message.senderPtid)
    .filter((ptid) => Boolean(ptid && ptid !== currentUserPtid))));
}

export function messageContentForSearch(
  message: ChatMessage,
  isGroupThread: boolean,
  t: (key: string) => string,
): string {
  if (messageProjectionMetadata(message).moderated) {
    return t('mobile.chat.moderatedMessage');
  }
  return isGroupThread
    ? groupMessageDisplayText(projectGroupMessageDisplay(message as GroupMessage), t)
    : friendMessageDisplayText(message as FriendChatMessage, t);
}

function messageSenderFallback(
  message: ChatMessage,
  groupMemberByPtid: ReadonlyMap<string, GroupMember>,
  peerName: string,
): string {
  const member = groupMemberByPtid.get(message.senderPtid);
  return (member?.nickname || peerName || message.senderPtid || '').slice(0, 1).toUpperCase();
}

function messageAvatarUrl(
  message: ChatMessage,
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
