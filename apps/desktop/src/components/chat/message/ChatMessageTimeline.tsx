import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { theme, Typography } from 'antd';
import {
  buildChatMessageSurfaceItems,
  countChatThreadReplies,
} from '@peers-touch/client-chat-core';

import type { CurrentUserProfile } from '../../../store/socialChat';
import type { FriendChatSession } from '../../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMember } from '../../../gen/proto/domain/chat/group_chat_pb';
import {
  messageTimestampMs,
  type ChatMessage,
  type ChatSurfaceKind,
} from './chatMessageModel';
import { ChatMessageRow, ChatMessageRowInteractionStyle } from './ChatMessageRow';

const { Text } = Typography;

interface ChatThreadStats {
  replyCount: number;
  unreadCount: number;
  previewMessages: ChatMessage[];
}

interface ChatMessageTimelineProps {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserDid: string | null;
  currentUserProfile: CurrentUserProfile | null;
  groupMembers: Record<string, GroupMember[]>;
  highlightedMessageUlid: string | null;
  messages: ChatMessage[];
  onDelete: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onOpenThread: (rootUlid: string) => void;
  onRecall: (message: ChatMessage) => void;
  onReply: (messageUlid: string) => void;
  resolveThreadStats: (message: ChatMessage) => ChatThreadStats;
  sessions: FriendChatSession[];
}

function formatDateSeparator(date: Date, locale: string): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = date.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return date.toLocaleDateString(locale, options);
}

function DateSeparator({ date }: { date: Date }) {
  const { token } = theme.useToken();
  const { i18n } = useTranslation();

  return (
    <Flexbox
      horizontal
      align="center"
      gap={10}
      style={{
        alignSelf: 'stretch',
        margin: '8px 0 6px',
        padding: '0 4px',
      }}
    >
      <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
      <Text
        type="secondary"
        style={{
          padding: '3px 10px',
          borderRadius: 999,
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          color: token.colorTextTertiary,
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        {formatDateSeparator(date, i18n.language)}
      </Text>
      <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
    </Flexbox>
  );
}

export function loadedThreadReplyCount(messages: ChatMessage[], rootUlid: string): number {
  return countChatThreadReplies(messages, rootUlid);
}

export function ChatMessageTimeline({
  activeConversationId,
  activeKind,
  currentUserDid,
  currentUserProfile,
  groupMembers,
  highlightedMessageUlid,
  messages,
  onDelete,
  onEdit,
  onOpenThread,
  onRecall,
  onReply,
  resolveThreadStats,
  sessions,
}: ChatMessageTimelineProps) {
  const surfaceItems = buildChatMessageSurfaceItems({
    messages,
    resolveTimestampMs: messageTimestampMs,
  });

  return (
    <>
      <ChatMessageRowInteractionStyle />
      {surfaceItems.map((item) => {
        const message = item.message;
        const messageDate = item.timestampMs > 0 ? new Date(item.timestampMs) : null;
        const threadStats = resolveThreadStats(message);

        return (
          <Fragment key={message.ulid}>
            {item.showDateSeparator && messageDate && (
              <DateSeparator date={messageDate} />
            )}
            <ChatMessageRow
              activeConversationId={activeConversationId}
              activeKind={activeKind}
              currentUserDid={currentUserDid}
              currentUserProfile={currentUserProfile}
              groupMembers={groupMembers}
              highlighted={highlightedMessageUlid === message.ulid}
              message={message}
              messages={messages}
              onDelete={onDelete}
              onEdit={onEdit}
              onOpenThread={onOpenThread}
              onRecall={onRecall}
              onReply={onReply}
              sessions={sessions}
              threadReplyCount={threadStats.replyCount}
              threadUnreadCount={threadStats.unreadCount}
              threadPreviewMessages={threadStats.previewMessages}
              timelineGap={item.timelineGap}
            />
          </Fragment>
        );
      })}
    </>
  );
}
