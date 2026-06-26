import { memo, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tooltip } from '@lobehub/ui';
import { theme, Typography } from 'antd';
import { Flexbox } from 'react-layout-kit';
import {
  Check,
  CheckCheck,
  MessageSquareReply,
  MessagesSquare,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { timestampDate, type Timestamp } from '@bufbuild/protobuf/wkt';
import {
  chatMessageRowMaxWidth,
  chatVisualLayoutForSurface,
  countHiddenEarlierChatThreadReplies,
  type ChatVisualLayoutContract,
} from '@peers-touch/client-chat-core';

import { UserSquareAvatar } from '../../common/UserSquareAvatar';
import type { CurrentUserProfile } from '../../../store/socialChat';
import type { FriendChatMessage, FriendMessageStatus, FriendChatSession } from '../../../gen/proto/domain/chat/friend_chat_pb';
import { FriendMessageStatus as FMS } from '../../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMember } from '../../../gen/proto/domain/chat/group_chat_pb';
import { ChatMessageContent } from './ChatMessageContent';
import {
  isEncryptedPlaceholder,
  isFriendMessage,
  isOwnMessage,
  isRecalledMessage,
  isVisualMessageAttachment,
  messageEditedAt,
  messageReplyToUlid,
  messageThreadRootUlid,
  messageTimestampMs,
  resolveChatSenderProfile,
  type ChatMessage,
  type ChatSurfaceKind,
} from './chatMessageModel';

const { Text } = Typography;

/**
 * Mirrors `application.DefaultMutationWindow` on the Station side.
 * The server is still the source of truth; the UI only hides buttons
 * that are guaranteed to fail.
 */
const FRIEND_RECALL_WINDOW_MS = 4 * 60 * 1000 + 30 * 1000;

interface ChatMessageRowProps {
  actionVisibility?: Partial<Record<'delete' | 'edit' | 'recall' | 'reply' | 'thread', boolean>>;
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserDid: string | null;
  currentUserProfile: CurrentUserProfile | null;
  density?: 'regular' | 'compact';
  groupMembers: Record<string, GroupMember[]>;
  highlighted: boolean;
  message: ChatMessage;
  messages: ChatMessage[];
  onDelete: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onOpenThread: (rootUlid: string) => void;
  onRecall: (message: ChatMessage) => void;
  onReply: (messageUlid: string) => void;
  sessions: FriendChatSession[];
  showHoverActions?: boolean;
  showThreadSummary?: boolean;
  threadPreviewMessages: ChatMessage[];
  threadReplyCount: number;
  threadUnreadCount: number;
  timelineGap: boolean;
}

function formatMsgTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = timestampDate(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ReadReceipt({ status }: { status: FriendMessageStatus }) {
  const { token } = theme.useToken();
  if (status === FMS.READ) {
    return <CheckCheck size={14} style={{ color: token.colorPrimary }} />;
  }
  if (status === FMS.DELIVERED) {
    return <Check size={14} style={{ color: token.colorTextQuaternary }} />;
  }
  if (status === FMS.SENT) {
    return <Check size={14} style={{ color: token.colorTextQuaternary }} />;
  }
  return null;
}

interface HoverActionsProps {
  canEdit: boolean;
  canDelete: boolean;
  canOpenThread: boolean;
  canRecall: boolean;
  canReply: boolean;
  isOwn: boolean;
  layout: ChatVisualLayoutContract;
  onDelete: () => void;
  onEdit: () => void;
  onOpenThread: () => void;
  onRecall: () => void;
  onReply: () => void;
}

function HoverActions({
  canEdit,
  canDelete,
  canOpenThread,
  canRecall,
  canReply,
  isOwn,
  layout,
  onDelete,
  onEdit,
  onOpenThread,
  onRecall,
  onReply,
}: HoverActionsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const actionButtonStyle: CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: 8,
  };

  return (
    <Flexbox
      horizontal
      gap={3}
      style={{
        position: 'absolute',
        top: '100%',
        left: isOwn ? 'auto' : 0,
        right: isOwn ? 0 : 'auto',
        marginTop: 4,
        opacity: 0,
        transition: 'opacity 0.15s ease',
        pointerEvents: 'none',
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        padding: 3,
        boxShadow: token.boxShadowSecondary,
        zIndex: 2,
      }}
      className="msg-hover-actions"
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -layout.hoverActionBridgeHeight,
          left: 0,
          right: 0,
          height: layout.hoverActionBridgeHeight,
        }}
      />
      {canOpenThread && (
        <Tooltip title={t('chat.social.thread.open')}>
          <Button
            type="text"
            size="small"
            icon={<MessagesSquare size={14} />}
            onClick={onOpenThread}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      {canReply && (
        <Tooltip title={t('chat.social.messageArea.actionReply')}>
          <Button
            type="text"
            size="small"
            icon={<MessageSquareReply size={14} />}
            onClick={onReply}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      {canEdit && (
        <Tooltip title={t('chat.social.messageArea.actionEdit')}>
          <Button
            type="text"
            size="small"
            icon={<Pencil size={14} />}
            onClick={onEdit}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      {canRecall && (
        <Tooltip title={t('chat.social.messageArea.actionRecall')}>
          <Button
            type="text"
            size="small"
            icon={<RotateCcw size={14} />}
            onClick={onRecall}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      {canDelete && (
        <Tooltip title={t('chat.social.messageArea.actionDelete')}>
          <Button
            type="text"
            size="small"
            icon={<Trash2 size={14} />}
            onClick={onDelete}
            style={{ ...actionButtonStyle, color: token.colorError }}
          />
        </Tooltip>
      )}
    </Flexbox>
  );
}

function ReplyBlock({
  isOwn,
  messages,
  replyToUlid,
}: {
  isOwn: boolean;
  messages: ChatMessage[];
  replyToUlid: string;
}) {
  const { token } = theme.useToken();
  const replyMsg = messages.find((m) => m.ulid === replyToUlid);
  if (!replyMsg) return null;

  return (
    <Flexbox
      style={{
        padding: '6px 9px',
        marginBottom: 8,
        borderLeft: `3px solid ${isOwn ? 'rgba(255,255,255,0.55)' : token.colorPrimary}`,
        borderRadius: 8,
        background: isOwn ? 'rgba(255,255,255,0.14)' : token.colorFillTertiary,
        fontSize: 11,
        color: isOwn ? 'rgba(255,255,255,0.8)' : token.colorTextSecondary,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <Text
        ellipsis
        style={{
          fontSize: 11,
          color: isOwn ? 'rgba(255,255,255,0.8)' : token.colorTextSecondary,
        }}
      >
        {replyMsg.content}
      </Text>
    </Flexbox>
  );
}

function ThreadReplyPreviewList({
  activeConversationId,
  activeKind,
  currentUserDid,
  currentUserProfile,
  groupMembers,
  isOwnRoot,
  messages,
  onOpenThread,
  sessions,
  totalCount,
  unreadCount,
}: {
  activeConversationId: string;
  activeKind: ChatSurfaceKind;
  currentUserDid: string | null;
  currentUserProfile: CurrentUserProfile | null;
  groupMembers: Record<string, GroupMember[]>;
  isOwnRoot: boolean;
  messages: ChatMessage[];
  onOpenThread: () => void;
  sessions: FriendChatSession[];
  totalCount: number;
  unreadCount: number;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const previewMessages = messages;
  const hiddenEarlierCount = countHiddenEarlierChatThreadReplies(totalCount, previewMessages.length);
  const hasHiddenEarlierReplies = previewMessages.length > 0 && hiddenEarlierCount > 0;
  const openLabel = unreadCount > 0
    ? t('chat.social.thread.summaryUnread', { count: totalCount, unread: unreadCount })
    : t('chat.social.thread.summary', { count: totalCount });
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpenThread();
  };

  return (
    <Flexbox
      align="flex-start"
      style={{
        alignSelf: isOwnRoot ? 'flex-end' : 'flex-start',
        marginTop: 5,
        maxWidth: '100%',
        paddingLeft: isOwnRoot ? 0 : 4,
        paddingRight: isOwnRoot ? 4 : 0,
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenThread}
        onKeyDown={handleKeyDown}
        aria-label={openLabel}
        title={openLabel}
        style={{
          display: 'grid',
          gridTemplateColumns: '9px minmax(0, 1fr)',
          columnGap: 7,
          maxWidth: 'min(320px, 100%)',
          padding: '1px 0 0',
          border: 0,
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 1,
            minHeight: previewMessages.length > 0 ? '100%' : 18,
            marginLeft: 4,
            background: unreadCount > 0 ? token.colorErrorBorder : token.colorBorderSecondary,
            opacity: unreadCount > 0 ? 0.9 : 0.72,
          }}
        />
        <Flexbox
          gap={3}
          style={{
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          {previewMessages.length === 0 ? (
            <Flexbox
              horizontal
              align="center"
              gap={5}
              style={{
                height: 18,
                color: token.colorTextQuaternary,
                fontSize: 11,
                lineHeight: '18px',
              }}
            >
              <MessagesSquare size={11} />
              <Text
                ellipsis
                style={{
                  color: unreadCount > 0 ? token.colorError : token.colorTextTertiary,
                  fontSize: 11,
                  lineHeight: '18px',
                  maxWidth: 220,
                }}
              >
                {openLabel}
              </Text>
            </Flexbox>
          ) : (
            <>
              {hasHiddenEarlierReplies && (
                <Text
                  ellipsis
                  style={{
                    maxWidth: '100%',
                    color: unreadCount > 0 ? token.colorError : token.colorTextTertiary,
                    fontSize: 11,
                    lineHeight: '18px',
                  }}
                >
                  {t('chat.social.thread.loadEarlierPreview', { count: hiddenEarlierCount })}
                </Text>
              )}
              {previewMessages.map((reply) => {
                const profile = resolveChatSenderProfile({
                  activeKind,
                  activeConversationId,
                  currentUserDid,
                  currentUserProfile,
                  groupMembers,
                  sessions,
                  message: reply,
                });
                const ownReply = isOwnMessage(reply, currentUserDid);
                return (
                  <div
                    key={reply.ulid}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'max-content minmax(0, 1fr)',
                      alignItems: 'baseline',
                      columnGap: 5,
                      width: '100%',
                      minHeight: 18,
                      color: token.colorTextSecondary,
                      textAlign: 'left',
                    }}
                  >
                    <Text
                      ellipsis
                      style={{
                        maxWidth: 92,
                        fontSize: 11,
                        color: token.colorTextTertiary,
                        fontWeight: 500,
                        lineHeight: 1.35,
                      }}
                    >
                      {ownReply ? t('chat.social.thread.you') : profile.name}
                    </Text>
                    <Text
                      ellipsis
                      style={{
                        minWidth: 0,
                        fontSize: 11,
                        color: token.colorTextSecondary,
                        lineHeight: 1.35,
                      }}
                    >
                      {reply.content || reply.attachments?.[0]?.filename || t('chat.social.thread.attachment')}
                    </Text>
                  </div>
                );
              })}
            </>
          )}
        </Flexbox>
      </div>
    </Flexbox>
  );
}

export function ChatMessageRowInteractionStyle() {
  const { token } = theme.useToken();
  const rowInteractionStyle = `
    .msg-row:hover .msg-hover-actions,
    .msg-row:focus-within .msg-hover-actions {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .msg-row.highlighted .msg-bubble {
      box-shadow: 0 0 0 2px ${token.colorPrimaryBorder}, ${token.boxShadowSecondary} !important;
    }
  `;

  return <style>{rowInteractionStyle}</style>;
}

export const ChatMessageRow = memo(function ChatMessageRow({
  actionVisibility,
  activeConversationId,
  activeKind,
  currentUserDid,
  currentUserProfile,
  density = 'regular',
  groupMembers,
  highlighted,
  message,
  messages,
  onDelete,
  onEdit,
  onOpenThread,
  onRecall,
  onReply,
  sessions,
  showHoverActions = true,
  showThreadSummary = true,
  threadPreviewMessages,
  threadReplyCount,
  threadUnreadCount,
  timelineGap,
}: ChatMessageRowProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isOwn = isOwnMessage(message, currentUserDid);
  const isGroup = !isFriendMessage(message);
  const senderProfile = resolveChatSenderProfile({
    activeKind,
    activeConversationId,
    currentUserDid,
    currentUserProfile,
    groupMembers,
    sessions,
    message,
  });
  const senderName = senderProfile.name;
  const senderAvatar = senderProfile.avatar;
  const replyToUlid = messageReplyToUlid(message);
  const encryptedPlaceholder = isEncryptedPlaceholder(message);
  const isRecalled = isRecalledMessage(message);
  const editedAt = messageEditedAt(message);
  const attachments = message.attachments || [];
  const mediaOnlyMessage = !isRecalled
    && !encryptedPlaceholder
    && message.content.trim().length === 0
    && attachments.length > 0
    && attachments.every(isVisualMessageAttachment);
  const sentMs = messageTimestampMs(message);
  const withinWindow = sentMs > 0 && (Date.now() - sentMs) < FRIEND_RECALL_WINDOW_MS;
  const canOpenThread = actionVisibility?.thread !== false;
  const canReply = actionVisibility?.reply !== false;
  const canDelete = actionVisibility?.delete !== false;
  const canRecall = actionVisibility?.recall !== false && isOwn && !isRecalled && withinWindow;
  const canEdit = actionVisibility?.edit !== false && isOwn && !isRecalled && withinWindow && !encryptedPlaceholder;
  const threadRootUlid = messageThreadRootUlid(message) || message.ulid;
  const compact = density === 'compact';
  const layout = chatVisualLayoutForSurface(compact ? 'desktop-thread' : 'desktop-main');
  const avatarSize = layout.avatarSize;
  const avatarGap = layout.avatarGap;

  const bubbleBg = mediaOnlyMessage
    ? 'transparent'
    : isOwn
      ? token.colorPrimary
      : token.colorBgContainer;
  const bubbleColor = isOwn && !mediaOnlyMessage ? '#fff' : token.colorText;
  const bubbleRadius: CSSProperties['borderRadius'] = isOwn
    ? layout.ownBubbleRadius
    : layout.peerBubbleRadius;
  const bubbleBorder = mediaOnlyMessage
    ? '1px solid transparent'
    : isOwn
      ? '1px solid transparent'
      : `1px solid ${token.colorBorderSecondary}`;

  return (
    <Flexbox
      data-message-ulid={message.ulid}
      className={`msg-row ${highlighted ? 'highlighted' : ''}`}
      horizontal
      align="flex-start"
      justify={isOwn ? 'flex-end' : 'flex-start'}
      style={{
        alignSelf: isOwn ? 'flex-end' : 'flex-start',
        maxWidth: chatMessageRowMaxWidth(layout, { own: isOwn, groupPeer: isGroup }),
        width: 'fit-content',
        position: 'relative',
        marginTop: timelineGap ? (compact ? 6 : 8) : 0,
      }}
      gap={avatarGap}
    >
      {!isOwn && (
        <UserSquareAvatar
          remoteUrl={senderAvatar}
          name={senderName}
          size={avatarSize}
          style={{ flexShrink: 0 }}
        />
      )}

      <Flexbox
        align={isOwn ? 'flex-end' : 'flex-start'}
        style={{
          position: 'relative',
          minWidth: 0,
          width: 'fit-content',
          maxWidth: `calc(100% - ${avatarSize + avatarGap}px)`,
        }}
      >
        {showHoverActions && (canOpenThread || canReply || canEdit || canRecall || canDelete) && (
          <HoverActions
            isOwn={isOwn}
            canDelete={canDelete}
            canOpenThread={canOpenThread}
            canRecall={canRecall}
            canReply={canReply}
            canEdit={canEdit}
            layout={layout}
            onOpenThread={() => onOpenThread(threadRootUlid)}
            onReply={() => onReply(message.ulid)}
            onDelete={() => onDelete(message)}
            onRecall={() => onRecall(message)}
            onEdit={() => onEdit(message)}
          />
        )}

        {!isOwn && isGroup && (
          <Text
            type="secondary"
            style={{
              fontSize: compact ? 10 : 11,
              marginBottom: compact ? 3 : 4,
              paddingLeft: 4,
              color: token.colorTextTertiary,
              fontWeight: 500,
            }}
          >
            {senderName}
          </Text>
        )}

        <Flexbox
          className="msg-bubble"
          style={{
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            width: mediaOnlyMessage ? 'fit-content' : undefined,
            maxWidth: '100%',
            minWidth: mediaOnlyMessage ? undefined : layout.bubbleMinWidth,
            padding: mediaOnlyMessage ? layout.mediaBubblePadding : layout.bubblePadding,
            borderRadius: bubbleRadius,
            background: isRecalled ? token.colorFillQuaternary : bubbleBg,
            border: isRecalled ? `1px solid ${token.colorBorderSecondary}` : bubbleBorder,
            boxShadow: mediaOnlyMessage ? 'none' : isOwn ? token.boxShadowTertiary : token.boxShadowSecondary,
            color: isRecalled ? token.colorTextSecondary : bubbleColor,
            fontSize: compact ? 12 : 13,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            fontStyle: isRecalled ? 'italic' : 'normal',
          }}
        >
          <ChatMessageContent
            message={message}
            isOwn={isOwn}
            replyBlock={replyToUlid && !isRecalled ? (
              <ReplyBlock
                replyToUlid={replyToUlid}
                messages={messages}
                isOwn={isOwn}
              />
            ) : undefined}
          />
        </Flexbox>

        {showThreadSummary && threadReplyCount > 0 && !isRecalled && (
          <ThreadReplyPreviewList
            activeConversationId={activeConversationId}
            activeKind={activeKind}
            currentUserDid={currentUserDid}
            currentUserProfile={currentUserProfile}
            groupMembers={groupMembers}
            isOwnRoot={isOwn}
            messages={threadPreviewMessages}
            onOpenThread={() => onOpenThread(threadRootUlid)}
            sessions={sessions}
            totalCount={threadReplyCount}
            unreadCount={threadUnreadCount}
          />
        )}

        <Flexbox
          horizontal
          align="center"
          justify={isOwn ? 'flex-end' : 'flex-start'}
          gap={5}
          style={{
            alignSelf: isOwn ? 'flex-end' : 'flex-start',
            marginTop: compact ? 3 : 4,
            paddingLeft: isOwn ? 0 : 4,
            paddingRight: isOwn ? 4 : 0,
            maxWidth: '100%',
          }}
        >
          <Text
            style={{
              fontSize: compact ? 10 : 11,
              color: token.colorTextTertiary,
              lineHeight: 1.2,
            }}
          >
            {formatMsgTime(message.createdAt ?? message.sentAt)}
          </Text>
          {editedAt && !isRecalled && (
            <Tooltip title={
              t('chat.social.messageArea.editedAtTooltip', {
                time: timestampDate(editedAt).toLocaleString(),
              })
            }>
              <Text
                style={{
                  fontSize: 11,
                  color: token.colorTextTertiary,
                  fontStyle: 'italic',
                  lineHeight: 1.2,
                }}
              >
                {t('chat.social.messageArea.editedTag')}
              </Text>
            </Tooltip>
          )}
          {isOwn && isFriendMessage(message) && !isRecalled && (
            <ReadReceipt status={(message as FriendChatMessage).status} />
          )}
        </Flexbox>
      </Flexbox>

      {isOwn && (
        <UserSquareAvatar
          remoteUrl={senderAvatar}
          name={senderName}
          size={avatarSize}
          style={{ flexShrink: 0 }}
        />
      )}
    </Flexbox>
  );
});
