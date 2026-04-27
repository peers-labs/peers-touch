import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, TextArea, Tooltip, EmojiPicker } from '@lobehub/ui';
import { Spin, theme, Typography, Empty } from 'antd';
import {
  Send, Inbox, Phone, Video, Search, Info,
  Paperclip, Check, CheckCheck,
  Reply, Trash2, Lock,
} from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { SearchMessagesModal } from './SearchMessagesModal';
import { AttachmentItem } from './AttachmentItem';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { toast } from '@lobehub/ui';
import type { FriendChatMessage, FriendMessageStatus } from '../../gen/proto/domain/chat/friend_chat_pb';
import { FriendMessageStatus as FMS } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { timestampDate } from '@bufbuild/protobuf/wkt';

const { Text } = Typography;

function isFriendMsg(msg: FriendChatMessage | GroupMessage): msg is FriendChatMessage {
  return 'sessionUlid' in msg;
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
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid, messages, loading,
    sessions, groups, loadMessages, loadOlderMessages, sendFriendMessage, sendGroupMessage, toggleDetail,
    deleteMessage,
  } = useSocialChatStore();
  const messageHasMore = useSocialChatStore((s) => s.messageHasMore);
  const messageLoadingMore = useSocialChatStore((s) => s.messageLoadingMore);
  const currentUserDid = useSocialChatStore((s) => s.currentUserDid);
  const scrollToMessageUlid = useSocialChatStore((s) => s.scrollToMessageUlid);
  const setScrollToMessageUlid = useSocialChatStore((s) => s.setScrollToMessageUlid);
  const encryptionEnabled = useSocialChatStore((s) => s.encryptionEnabled);
  const friendP2pStatus = useSocialChatStore((s) => s.friendP2pStatus);
  const peerOnline = useSocialChatStore((s) => s.peerOnline);
  const [inputValue, setInputValue] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyToUlid, setReplyToUlid] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prependRestoreRef = useRef<{ previousHeight: number } | null>(null);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const currentMessages = activeUlid ? (messages[activeUlid] || []) : [];

  const currentName = (() => {
    if (activeTab === 'friend') {
      const s = sessions.find((sess) => sess.ulid === activeUlid);
      if (!s) return '';
      if (currentUserDid) {
        if (s.participantADid === currentUserDid)
          return (s as any).participantBDisplayName || s.participantBDid || '';
        if (s.participantBDid === currentUserDid)
          return (s as any).participantADisplayName || s.participantADid || '';
      }
      return (s as any).participantBDisplayName || s.participantBDid || '';
    }
    const g = groups.find((grp) => grp.ulid === activeUlid);
    return g?.name || '';
  })();

  const currentAvatar = (() => {
    if (activeTab === 'friend') {
      const s = sessions.find((sess) => sess.ulid === activeUlid);
      if (!s) return '';
      if (currentUserDid) {
        if (s.participantADid === currentUserDid)
          return (s as any).participantBAvatar || '';
        if (s.participantBDid === currentUserDid)
          return (s as any).participantAAvatar || '';
      }
      return (s as any).participantBAvatar || '';
    }
    return '';
  })();

  const subtitle = (() => {
    if (activeTab === 'friend') return '';
    const g = groups.find((g) => g.ulid === activeUlid);
    return g ? t('chat.social.detail.membersCount', { count: g.memberCount }) : '';
  })();

  // Resolve the active peer DID for friend conversations. Used by the
  // header presence dot to decide whether the friend is reachable on
  // station, separate from whether our P2P channel happens to be up.
  const activePeerDid = (() => {
    if (activeTab !== 'friend' || !activeUlid) return null;
    const s = sessions.find((sess) => sess.ulid === activeUlid);
    if (!s) return null;
    if (currentUserDid) {
      if (s.participantADid === currentUserDid) return s.participantBDid;
      if (s.participantBDid === currentUserDid) return s.participantADid;
    }
    return s.participantBDid || s.participantADid || null;
  })();

  // Render the WebRTC transport badge.
  //
  // Real-time delivery is *only* via WebRTC DataChannel — there is no
  // SSE / business-layer relay for chat messages. This badge reflects
  // the *transport* used for live message delivery, NOT whether the
  // peer is online. The two are independent: a peer can be online on
  // station yet still be mid-ICE (DataChannel not open), and a peer
  // can be offline yet leave a stale "connected" badge for a few
  // seconds until WebRTC notices the disconnect.
  //
  // Labels:
  //   - "Direct"     : ICE settled on host/srflx/prflx (P2P)
  //   - "Relay"      : ICE settled on a TURN allocation (still real-time,
  //                    just routed through station's TURN server)
  //   - "Connecting" : DataChannel not open yet, transport unknown
  //   - "P2P down"   : connection failed/closed; messages still flow via
  //                    station's pending queue + 60 s safety-net poll
  //
  // The previous "Offline" label was the source of confusion that
  // prompted this refactor — users read "Offline" as "the peer is
  // offline", which is a different (and now separately rendered)
  // concept. "P2P down" makes the scope explicit.
  const p2pBadge = (() => {
    if (activeTab !== 'friend' || !activeUlid) return null;
    const s = friendP2pStatus[activeUlid];
    if (!s) return null;
    let label = '';
    let color = token.colorTextQuaternary;
    if (s.state === 'connected') {
      if (s.transport === 'relay') {
        label = 'Relay';
        color = token.colorWarning;
      } else if (s.transport === 'direct') {
        label = 'Direct';
        color = token.colorSuccess;
      } else {
        label = 'Connecting';
        color = token.colorWarning;
      }
    } else if (s.state === 'connecting') {
      label = 'Connecting';
      color = token.colorWarning;
    } else if (s.state === 'failed' || s.state === 'closed') {
      label = 'P2P down';
      color = token.colorTextQuaternary;
    } else {
      return null;
    }
    const tip = s.detail ? `${label}: ${s.detail}` : label;
    return (
      <Tooltip title={tip}>
        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, background: token.colorFillTertiary, color }}>
          {label}
        </span>
      </Tooltip>
    );
  })();

  // Peer-presence indicator. Truth source: Station's
  // `/friend-chat/presence/stream` SSE, mirrored into `peerOnline` by
  // `services/peerPresence.ts`. The seed comes from the
  // `participant_*_online` snapshot embedded in the sessions list.
  //
  // Unknown (peer DID never seen by the SSE or the snapshot) renders
  // *no* indicator rather than a grey dot — a grey dot would be hard
  // to distinguish from "offline" at a glance, and "we don't know yet"
  // is a real third state.
  const peerOnlineIndicator = (() => {
    if (activeTab !== 'friend' || !activePeerDid) return null;
    const known = activePeerDid in peerOnline;
    if (!known) return null;
    const online = peerOnline[activePeerDid];
    const tip = online
      ? t('chat.social.presence.online', 'Online')
      : t('chat.social.presence.offline', 'Offline');
    return (
      <Tooltip title={tip}>
        <span
          aria-label={tip}
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: online ? token.colorSuccess : token.colorTextQuaternary,
            flexShrink: 0,
          }}
        />
      </Tooltip>
    );
  })();

  useEffect(() => {
    if (activeUlid) {
      loadMessages(activeUlid);
    }
  }, [activeUlid, loadMessages]);

  useEffect(() => {
    if (prependRestoreRef.current && scrollContainerRef.current) {
      const { previousHeight } = prependRestoreRef.current;
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight - previousHeight;
      prependRestoreRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages.length]);

  useEffect(() => {
    setReplyToUlid(null);
  }, [activeUlid]);

  useEffect(() => {
    if (!scrollToMessageUlid || !activeUlid) return;
    const hasMsg = currentMessages.some((m) => m.ulid === scrollToMessageUlid);
    if (!hasMsg) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-message-ulid="${scrollToMessageUlid}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScrollToMessageUlid(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToMessageUlid, activeUlid, currentMessages, setScrollToMessageUlid]);

  const handleScroll = async () => {
    if (!activeUlid || !scrollContainerRef.current) return;
    if (!messageHasMore[activeUlid] || messageLoadingMore[activeUlid]) return;
    const container = scrollContainerRef.current;
    if (container.scrollTop > 40) return;
    prependRestoreRef.current = { previousHeight: container.scrollHeight };
    try {
      await loadOlderMessages(activeUlid, activeTab === 'friend' ? 'friend' : 'group');
    } catch {
      prependRestoreRef.current = null;
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || !activeUlid) return;
    const content = inputValue.trim();
    const replyRef = replyToUlid || undefined;
    setInputValue('');
    setReplyToUlid(null);
    setSending(true);
    try {
      if (activeTab === 'friend') {
        const session = sessions.find((s) => s.ulid === activeUlid);
        const receiverDid = session
          ? session.participantADid === currentUserDid
            ? session.participantBDid
            : session.participantADid
          : '';
        await sendFriendMessage(activeUlid, receiverDid, content, undefined, replyRef);
      } else {
        await sendGroupMessage(activeUlid, content, undefined, replyRef);
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

  // Pick a file via the native dialog → upload through Tauri (which
  // handles JWT auth and returns a federated `oss://{host}/{key}`
  // cid) → send as a message attachment. Friend and group flows
  // share the same upload path; the cid resolution happens lazily on
  // render via `useAttachmentUrl`.
  const handleAttachClick = async () => {
    if (!activeUlid) return;
    let filePath: string;
    try {
      filePath = await api.pickChatAttachment();
    } catch {
      return;
    }
    if (!filePath) return;

    setSending(true);
    try {
      const uploaded = await api.chatUploadAttachment({
        file_path: filePath,
        bucket: 'chat',
        visibility: 'chat',
        chat_session_id: activeUlid,
      });
      if (!uploaded) {
        toast.error(t('chat.social.messageArea.uploadFailed'));
        return;
      }
      const isImage = uploaded.mime_type?.startsWith('image/');
      const msgType = isImage ? 2 : 3;
      const attachment = {
        cid: uploaded.cid,
        filename: uploaded.filename,
        mime_type: uploaded.mime_type,
        size: uploaded.size,
        thumbnail_cid: '',
      };
      if (activeTab === 'friend') {
        const session = sessions.find((s) => s.ulid === activeUlid);
        const receiverDid = session
          ? session.participantADid === currentUserDid
            ? session.participantBDid
            : session.participantADid
          : '';
        await sendFriendMessage(activeUlid, receiverDid, uploaded.filename, msgType, undefined, [attachment]);
      } else {
        await sendGroupMessage(activeUlid, uploaded.filename, msgType, undefined, [attachment]);
      }
    } catch (err) {
      log.error('chat', 'file upload failed', err);
      toast.error(t('chat.social.messageArea.uploadFailed'));
    } finally {
      setSending(false);
    }
  };

  const replyingMsg = replyToUlid ? currentMessages.find((m) => m.ulid === replyToUlid) : null;

  if (!activeUlid) {
    return (
      <Flexbox flex={1} align="center" justify="center" gap={12} style={{ background: token.colorBgContainer }}>
        <Inbox size={48} style={{ color: token.colorTextQuaternary }} />
        <Text type="secondary">{t('chat.social.messageArea.selectConversation')}</Text>
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
      <SearchMessagesModal
        open={showSearch}
        onClose={() => setShowSearch(false)}
        initialScope={activeTab === 'friend' ? 'friend' : 'group'}
        conversationId={activeUlid ?? undefined}
      />

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
          <UserSquareAvatar remoteUrl={currentAvatar} name={currentName} size={36} />
          <Flexbox horizontal align="center" gap={6}>
            <Flexbox>
              <Flexbox horizontal align="center" gap={6}>
                <Text strong style={{ fontSize: 14 }}>{currentName}</Text>
                {peerOnlineIndicator}
              </Flexbox>
              <Text type="secondary" style={{ fontSize: 12 }}>{subtitle}</Text>
            </Flexbox>
            {p2pBadge}
            {encryptionEnabled && (
              <Tooltip title={t('chat.social.encryption.enabled')}>
                <Lock size={14} style={{ color: token.colorSuccess, marginLeft: 4 }} />
              </Tooltip>
            )}
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4}>
          <Tooltip title={t('chat.social.messageArea.comingSoon')}>
            <Button type="text" icon={<Phone size={16} />} disabled style={{ width: 32, height: 32 }} />
          </Tooltip>
          <Tooltip title={t('chat.social.messageArea.comingSoon')}>
            <Button type="text" icon={<Video size={16} />} disabled style={{ width: 32, height: 32 }} />
          </Tooltip>
          <Tooltip title={t('chat.social.search.title')}>
            <Button
              type="text"
              icon={<Search size={16} />}
              style={{ width: 32, height: 32 }}
              onClick={() => setShowSearch(true)}
            />
          </Tooltip>
          <Button type="text" icon={<Info size={16} />} style={{ width: 32, height: 32 }} onClick={toggleDetail} />
        </Flexbox>
      </Flexbox>

      <Flexbox
        flex={1}
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{ overflow: 'auto', padding: '16px 20px' }}
        gap={12}
      >
        {activeUlid && messageLoadingMore[activeUlid] && (
          <Flexbox align="center" justify="center" style={{ paddingBottom: 8 }}>
            <Spin size="small" />
          </Flexbox>
        )}
        {loading && currentMessages.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1}>
            <Spin />
          </Flexbox>
        ) : currentMessages.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.messageArea.noMessages')} />
          </Flexbox>
        ) : (
          currentMessages.map((msg) => {
            const isOwn = currentUserDid ? msg.senderDid === currentUserDid : false;
            const isGroup = !isFriendMsg(msg);
            const hasReply = (isFriendMsg(msg) ? msg.replyToUlid : (msg as GroupMessage).replyToUlid) || '';
            const isEncryptedPlaceholder = msg.content === '[Encrypted Message]';

            const bubbleBg = isOwn ? token.colorPrimary : token.colorFillSecondary;
            const bubbleColor = isOwn ? '#fff' : token.colorText;
            const bubbleRadius: CSSProperties['borderRadius'] = isOwn
              ? '12px 12px 4px 12px'
              : '12px 12px 12px 4px';

            return (
              <Flexbox
                key={msg.ulid}
                data-message-ulid={msg.ulid}
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
                  <UserSquareAvatar name={msg.senderDid} size={28} style={{ alignSelf: 'flex-end' }} />
                )}

                <Flexbox style={{ position: 'relative', minWidth: 0 }}>
                  <HoverActions
                    isOwn={isOwn}
                    onReply={() => setReplyToUlid(msg.ulid)}
                    onDelete={async () => {
                      if (!activeUlid) return;
                      const kind = activeTab === 'friend' ? 'friend' : 'group';
                      try {
                        await deleteMessage(activeUlid, msg.ulid, kind);
                      } catch (e) {
                        log.error('chat', 'deleteMessage failed', e);
                        toast.error(t('chat.social.messageArea.deleteFailed'));
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
                    {isEncryptedPlaceholder ? (
                      <Flexbox horizontal align="center" gap={4}>
                        <Lock size={12} style={{ color: token.colorTextQuaternary }} />
                        <Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
                          {t('chat.social.encryption.encryptedMessage')}
                        </Text>
                      </Flexbox>
                    ) : (
                      msg.content
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <Flexbox gap={4} style={{ marginTop: msg.content ? 4 : 0 }}>
                        {msg.attachments.map((att, idx) => (
                          <AttachmentItem
                            key={idx}
                            attachment={att}
                            isOwn={isOwn}
                            visibilityHint={isOwn ? 'chat' : undefined}
                          />
                        ))}
                      </Flexbox>
                    )}
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
                {t('chat.social.messageArea.replyingTo')}
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
              {t('chat.social.messageArea.cancel')}
            </Button>
          </Flexbox>
        )}

        <Flexbox horizontal align="flex-end" gap={8}>
          {/* Native file picker via Tauri — bypasses the WKWebView
             input quirks and lets us upload through station_client
             which already handles JWT auth. */}
          <Button
            type="text"
            icon={<Paperclip size={18} />}
            style={{ width: 36, height: 36, flexShrink: 0 }}
            onClick={handleAttachClick}
            disabled={sending}
          />
          <EmojiPicker
            size={36}
            onChange={(emoji) => setInputValue((prev) => prev + emoji)}
          />
          <TextArea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.social.messageArea.placeholder')}
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
