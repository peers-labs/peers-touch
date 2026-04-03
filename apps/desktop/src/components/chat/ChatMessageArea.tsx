import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, Empty, Input, Spin, Tooltip, Typography, theme } from 'antd';
import {
  Send, Inbox, Phone, Video, Search, Info,
  Paperclip, Smile, Check, CheckCheck,
  Reply, Trash2,
} from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import type { FriendChatMessage, FriendMessageStatus } from '../../gen/proto/domain/chat/friend_chat_pb';
import { FriendMessageStatus as FMS } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { timestampDate } from '@bufbuild/protobuf/wkt';

const { Text } = Typography;
const { TextArea } = Input;

function isFriendMsg(msg: FriendChatMessage | GroupMessage): msg is FriendChatMessage {
  return 'sessionUlid' in msg;
}

function formatMsgTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = timestampDate(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
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
  isOwn: boolean;
  onReply: () => void;
  onDelete: () => void;
}

function HoverActions({ isOwn, onReply, onDelete }: HoverActionsProps) {
  const { token } = theme.useToken();
  return (
    <Flexbox
      horizontal
      gap={2}
      style={{
        position: 'absolute',
        top: -4,
        [isOwn ? 'left' : 'right']: -4,
        transform: isOwn ? 'translateX(-100%)' : 'translateX(100%)',
        opacity: 0,
        transition: 'opacity 0.15s ease',
        pointerEvents: 'none',
        background: token.colorBgElevated,
        borderRadius: 6,
        padding: 2,
        boxShadow: token.boxShadowTertiary,
      }}
      className="msg-hover-actions"
    >
      <Button
        type="text"
        size="small"
        icon={<Reply size={14} />}
        onClick={onReply}
        style={{ width: 26, height: 26 }}
      />
      <Button
        type="text"
        size="small"
        icon={<Trash2 size={14} />}
        onClick={onDelete}
        style={{ width: 26, height: 26, color: token.colorError }}
      />
    </Flexbox>
  );
}

function ReplyBlock({ replyToUlid, messages, isOwn }: { replyToUlid: string; messages: (FriendChatMessage | GroupMessage)[]; isOwn: boolean }) {
  const { token } = theme.useToken();
  const replyMsg = messages.find((m) => m.ulid === replyToUlid);
  if (!replyMsg) return null;
  return (
    <Flexbox
      style={{
        padding: '4px 8px',
        marginBottom: 4,
        borderLeft: `2px solid ${isOwn ? 'rgba(255,255,255,0.4)' : token.colorPrimary}`,
        borderRadius: 4,
        background: isOwn ? 'rgba(255,255,255,0.1)' : token.colorFillTertiary,
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

export function ChatMessageArea() {
  const { token } = theme.useToken();
  const {
    activeTab, activeSessionUlid, activeGroupUlid, messages, loading,
    sessions, groups, loadMessages, sendFriendMessage, sendGroupMessage, toggleDetail,
    currentUserProfile, deleteMessage,
  } = useSocialChatStore();
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [replyToUlid, setReplyToUlid] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const currentMessages = activeUlid ? (messages[activeUlid] || []) : [];

  const currentName = (() => {
    if (activeTab === 'friend') {
      const s = sessions.find((s) => s.ulid === activeUlid);
      return s ? s.participantBDid || '' : '';
    }
    const g = groups.find((g) => g.ulid === activeUlid);
    return g?.name || '';
  })();

  const subtitle = (() => {
    if (activeTab === 'friend') return '';
    const g = groups.find((g) => g.ulid === activeUlid);
    return g ? `${g.memberCount} members` : '';
  })();

  useEffect(() => {
    if (activeUlid) {
      loadMessages(activeUlid);
    }
  }, [activeUlid, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length]);

  useEffect(() => {
    setReplyToUlid(null);
  }, [activeUlid]);

  const handleSend = async () => {
    if (!inputValue.trim() || !activeUlid) return;
    const content = inputValue.trim();
    setInputValue('');
    setReplyToUlid(null);
    setSending(true);
    try {
      if (activeTab === 'friend') {
        const session = sessions.find((s) => s.ulid === activeUlid);
        const receiverDid = session?.participantBDid || '';
        await sendFriendMessage(activeUlid, receiverDid, content);
      } else {
        await sendGroupMessage(activeUlid, content);
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const replyingMsg = replyToUlid ? currentMessages.find((m) => m.ulid === replyToUlid) : null;

  if (!activeUlid) {
    return (
      <Flexbox flex={1} align="center" justify="center" gap={12} style={{ background: token.colorBgContainer }}>
        <Inbox size={48} style={{ color: token.colorTextQuaternary }} />
        <Text type="secondary">Select a conversation to start chatting</Text>
      </Flexbox>
    );
  }

  const hoverStyle = `
    .msg-row:hover .msg-hover-actions {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
  `;

  return (
    <Flexbox flex={1} gap={0} style={{ height: '100%', background: token.colorBgContainer }}>
      <style>{hoverStyle}</style>

      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Flexbox horizontal align="center" gap={10}>
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              background: token.colorPrimary,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {getInitial(currentName)}
          </Flexbox>
          <Flexbox>
            <Text strong style={{ fontSize: 14 }}>{currentName}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{subtitle}</Text>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4}>
          <Tooltip title="Coming soon">
            <Button type="text" icon={<Phone size={16} />} disabled style={{ width: 32, height: 32 }} />
          </Tooltip>
          <Tooltip title="Coming soon">
            <Button type="text" icon={<Video size={16} />} disabled style={{ width: 32, height: 32 }} />
          </Tooltip>
          <Button type="text" icon={<Search size={16} />} style={{ width: 32, height: 32 }} />
          <Button type="text" icon={<Info size={16} />} style={{ width: 32, height: 32 }} onClick={toggleDetail} />
        </Flexbox>
      </Flexbox>

      <Flexbox flex={1} style={{ overflow: 'auto', padding: '16px 20px' }} gap={12}>
        {loading && currentMessages.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1}>
            <Spin />
          </Flexbox>
        ) : currentMessages.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No messages yet" />
          </Flexbox>
        ) : (
          currentMessages.map((msg) => {
            const myUsername = currentUserProfile?.username;
            const isOwn = myUsername ? msg.senderDid === myUsername : false;
            const isGroup = !isFriendMsg(msg);
            const hasReply = (isFriendMsg(msg) ? msg.replyToUlid : (msg as GroupMessage).replyToUlid) || '';

            const bubbleBg = isOwn ? token.colorPrimary : token.colorFillSecondary;
            const bubbleColor = isOwn ? '#fff' : token.colorText;
            const bubbleRadius: CSSProperties['borderRadius'] = isOwn
              ? '12px 12px 4px 12px'
              : '12px 12px 12px 4px';

            return (
              <Flexbox
                key={msg.ulid}
                className="msg-row"
                horizontal={isOwn}
                style={{
                  alignSelf: isOwn ? 'flex-end' : 'flex-start',
                  maxWidth: '70%',
                  position: 'relative',
                }}
                gap={6}
              >
                {!isOwn && isGroup && (
                  <Flexbox
                    align="center"
                    justify="center"
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      background: token.colorFillSecondary,
                      color: token.colorTextSecondary,
                      fontSize: 12,
                      fontWeight: 600,
                      flexShrink: 0,
                      alignSelf: 'flex-end',
                    }}
                  >
                    {getInitial(msg.senderDid)}
                  </Flexbox>
                )}

                <Flexbox style={{ position: 'relative', minWidth: 0 }}>
                  <HoverActions
                    isOwn={isOwn}
                    onReply={() => setReplyToUlid(msg.ulid)}
                    onDelete={() => {
                      if (activeUlid) {
                        deleteMessage(activeUlid, msg.ulid);
                      }
                    }}
                  />

                  {!isOwn && isGroup && (
                    <Text
                      type="secondary"
                      style={{ fontSize: 11, marginBottom: 2, paddingLeft: 2 }}
                    >
                      {msg.senderDid}
                    </Text>
                  )}

                  <Flexbox
                    style={{
                      padding: '8px 12px',
                      borderRadius: bubbleRadius,
                      background: bubbleBg,
                      color: bubbleColor,
                      fontSize: 13,
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                    }}
                  >
                    {hasReply && (
                      <ReplyBlock
                        replyToUlid={hasReply}
                        messages={currentMessages}
                        isOwn={isOwn}
                      />
                    )}
                    {msg.content}
                  </Flexbox>

                  <Flexbox
                    horizontal
                    align="center"
                    justify={isOwn ? 'flex-end' : 'flex-start'}
                    gap={4}
                    style={{ marginTop: 2, paddingLeft: 2, paddingRight: 2 }}
                  >
                    <Text
                      style={{
                        fontSize: 10,
                        color: token.colorTextQuaternary,
                      }}
                    >
                      {formatMsgTime(msg.createdAt)}
                    </Text>
                    {isOwn && isFriendMsg(msg) && (
                      <ReadReceipt status={msg.status} />
                    )}
                  </Flexbox>
                </Flexbox>
              </Flexbox>
            );
          })
        )}
        <div ref={bottomRef} />
      </Flexbox>

      <Flexbox
        style={{
          padding: '10px 16px 12px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
        gap={8}
      >
        {replyingMsg && (
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              background: token.colorFillTertiary,
              borderLeft: `3px solid ${token.colorPrimary}`,
            }}
          >
            <Flexbox style={{ minWidth: 0, flex: 1 }}>
              <Text style={{ fontSize: 11, color: token.colorPrimary, fontWeight: 500 }}>
                Replying to
              </Text>
              <Text ellipsis type="secondary" style={{ fontSize: 12 }}>
                {replyingMsg.content}
              </Text>
            </Flexbox>
            <Button
              type="text"
              size="small"
              onClick={() => setReplyToUlid(null)}
              style={{ fontSize: 12, color: token.colorTextSecondary }}
            >
              Cancel
            </Button>
          </Flexbox>
        )}

        <Flexbox horizontal align="flex-end" gap={8}>
          <Button
            type="text"
            icon={<Paperclip size={18} />}
            style={{ width: 36, height: 36, flexShrink: 0 }}
          />
          <Button
            type="text"
            icon={<Smile size={18} />}
            style={{ width: 36, height: 36, flexShrink: 0 }}
          />
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{ flex: 1 }}
            disabled={sending}
          />
          <Button
            type="primary"
            icon={<Send size={16} />}
            onClick={handleSend}
            loading={sending}
            disabled={!inputValue.trim()}
            style={{ width: 36, height: 36, flexShrink: 0 }}
          />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
