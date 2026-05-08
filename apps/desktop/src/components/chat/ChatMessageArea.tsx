import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tooltip } from '@lobehub/ui';
import { Spin, theme, Typography, Empty } from 'antd';
import {
  Inbox, Phone, Video, Search, Info,
  Check, CheckCheck,
  Reply, Trash2, Lock, RotateCcw, Pencil, X as XIcon, MessageCircle,
} from 'lucide-react';
import { socialThreadKey, useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { SearchMessagesModal } from './SearchMessagesModal';
import { AttachmentItem, type ChatAttachmentVisibilityHint } from './AttachmentItem';
import { ChatComposer } from './ChatComposer';
import { friendChatP2p } from '../../modules/p2p/friendChatP2p';
import { api } from '../../services/desktop_api';
import { seedLocalMediaProjection } from '../../services/mediaRuntime';
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

function getReplyToUlid(msg: FriendChatMessage | GroupMessage): string {
  return isFriendMsg(msg) ? msg.replyToUlid : msg.replyToUlid;
}

function getThreadRootUlid(msg: FriendChatMessage | GroupMessage): string {
  const threadRoot = (msg as (FriendChatMessage | GroupMessage) & { threadRootUlid?: string }).threadRootUlid || '';
  return threadRoot || getReplyToUlid(msg);
}

/**
 * Coerce the wire-format `visibility` string into the badge hint
 * the receiver UI understands. Returns `undefined` for empty /
 * unknown values so the AttachmentItem renders no chip — this is
 * the legacy / "sender did not declare" path.
 */
function normalizeVisibilityHint(v: string | undefined): ChatAttachmentVisibilityHint | undefined {
  switch (v) {
    case 'public':
    case 'chat':
    case 'private':
      return v;
    default:
      return undefined;
  }
}

const IMAGE_ATTACHMENT_FILENAME_PATTERN = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;

function isImageMessageAttachment(att: FriendChatMessage['attachments'][number] | GroupMessage['attachments'][number]): boolean {
  const mimeType = att.mimeType?.toLowerCase() ?? '';
  const filename = att.filename ?? '';
  return mimeType.startsWith('image/') || IMAGE_ATTACHMENT_FILENAME_PATTERN.test(filename);
}

function isUploadedImage(filename: string | undefined, mimeType: string | undefined): boolean {
  const normalizedMime = mimeType?.toLowerCase() ?? '';
  return normalizedMime.startsWith('image/') || IMAGE_ATTACHMENT_FILENAME_PATTERN.test(filename ?? '');
}

function formatMsgTime(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = timestampDate(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getMessageTimestampDate(msg: FriendChatMessage | GroupMessage): Date | null {
  const ts = msg.createdAt ?? msg.sentAt;
  return ts ? timestampDate(ts) : null;
}

function getCalendarDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return getCalendarDayKey(a) === getCalendarDayKey(b);
}

function shouldShowDateSeparator(
  msg: FriendChatMessage | GroupMessage,
  previousMsg: FriendChatMessage | GroupMessage | undefined,
): boolean {
  const currentDate = getMessageTimestampDate(msg);
  if (!currentDate) return false;
  const previousDate = previousMsg ? getMessageTimestampDate(previousMsg) : null;
  return !previousDate || !isSameCalendarDay(currentDate, previousDate);
}

const MESSAGE_TIME_GROUP_GAP_MS = 10 * 60 * 1000;

function hasTimelineGap(
  msg: FriendChatMessage | GroupMessage,
  previousMsg: FriendChatMessage | GroupMessage | undefined,
): boolean {
  const currentDate = getMessageTimestampDate(msg);
  const previousDate = previousMsg ? getMessageTimestampDate(previousMsg) : null;
  if (!currentDate || !previousDate || !isSameCalendarDay(currentDate, previousDate)) return false;
  return currentDate.getTime() - previousDate.getTime() > MESSAGE_TIME_GROUP_GAP_MS;
}

function formatDateSeparator(d: Date): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = d.getFullYear() === now.getFullYear()
    ? { month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return d.toLocaleDateString([], options);
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

function DateSeparator({ date }: { date: Date }) {
  const { token } = theme.useToken();
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
          letterSpacing: 0.2,
        }}
      >
        {formatDateSeparator(date)}
      </Text>
      <span style={{ flex: 1, height: 1, background: token.colorBorderSecondary }} />
    </Flexbox>
  );
}

interface HoverActionsProps {
  isOwn: boolean;
  /** Whether the [Recall] button should be shown. Recall is gated
   *  client-side by ownership + friend chat + within the recall
   *  window — the server still enforces both. We hide the button
   *  proactively so the user doesn't get a "too late" error after
   *  clicking. */
  canRecall: boolean;
  /** Whether the [Edit] button should be shown. Same gating as
   *  recall (ownership + friend chat + window) plus "not recalled". */
  canEdit: boolean;
  onOpenThread: () => void;
  onReply: () => void;
  onDelete: () => void;
  onRecall: () => void;
  onEdit: () => void;
}

function HoverActions({ isOwn, canRecall, canEdit, onOpenThread, onReply, onDelete, onRecall, onEdit }: HoverActionsProps) {
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
        top: 0,
        [isOwn ? 'left' : 'right']: -8,
        transform: isOwn ? 'translateX(-100%)' : 'translateX(100%)',
        opacity: 0,
        transition: 'opacity 0.15s ease, transform 0.15s ease',
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
      <Tooltip title={t('chat.social.thread.open', 'Open thread')}>
        <Button
          type="text"
          size="small"
          icon={<MessageCircle size={14} />}
          onClick={onOpenThread}
          style={actionButtonStyle}
        />
      </Tooltip>
      <Tooltip title={t('chat.social.messageArea.actionReply', 'Reply')}>
        <Button
          type="text"
          size="small"
          icon={<Reply size={14} />}
          onClick={onReply}
          style={actionButtonStyle}
        />
      </Tooltip>
      {canEdit && (
        <Tooltip title={t('chat.social.messageArea.actionEdit', 'Edit')}>
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
        <Tooltip title={t('chat.social.messageArea.actionRecall', 'Recall')}>
          <Button
            type="text"
            size="small"
            icon={<RotateCcw size={14} />}
            onClick={onRecall}
            style={actionButtonStyle}
          />
        </Tooltip>
      )}
      <Tooltip title={t('chat.social.messageArea.actionDelete', 'Delete')}>
        <Button
          type="text"
          size="small"
          icon={<Trash2 size={14} />}
          onClick={onDelete}
          style={{ ...actionButtonStyle, color: token.colorError }}
        />
      </Tooltip>
    </Flexbox>
  );
}

/**
 * Mirrors `application.DefaultMutationWindow` on the Station side.
 * The server is the source of truth — clients only use this to
 * decide whether to *show* the Recall / Edit buttons. The UI's
 * "looks editable" state must always be a strict subset of the
 * server's "actually editable" state, which is why we err on the
 * tighter side here (4 minutes 30s vs server's 5 minutes) so a
 * borderline click cannot 422 the user.
 */
const FRIEND_RECALL_WINDOW_MS = 4 * 60 * 1000 + 30 * 1000;
const EMPTY_MESSAGES: (FriendChatMessage | GroupMessage)[] = [];

function isWithinMutationWindow(sentMs: number): boolean {
  return sentMs > 0 && (Date.now() - sentMs) < FRIEND_RECALL_WINDOW_MS;
}

function ReplyBlock({ replyToUlid, messages, isOwn }: { replyToUlid: string; messages: (FriendChatMessage | GroupMessage)[]; isOwn: boolean }) {
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

export function ChatMessageArea() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const activeTab = useSocialChatStore((s) => s.activeTab);
  const activeSessionUlid = useSocialChatStore((s) => s.activeSessionUlid);
  const activeGroupUlid = useSocialChatStore((s) => s.activeGroupUlid);
  const messages = useSocialChatStore((s) => s.messages);
  const loading = useSocialChatStore((s) => s.loading);
  const sessions = useSocialChatStore((s) => s.sessions);
  const groups = useSocialChatStore((s) => s.groups);
  const loadMessages = useSocialChatStore((s) => s.loadMessages);
  const loadOlderMessages = useSocialChatStore((s) => s.loadOlderMessages);
  const sendFriendMessage = useSocialChatStore((s) => s.sendFriendMessage);
  const sendGroupMessage = useSocialChatStore((s) => s.sendGroupMessage);
  const toggleDetail = useSocialChatStore((s) => s.toggleDetail);
  const deleteMessage = useSocialChatStore((s) => s.deleteMessage);
  const recallFriendMessage = useSocialChatStore((s) => s.recallFriendMessage);
  const editFriendMessage = useSocialChatStore((s) => s.editFriendMessage);
  const recallGroupMessage = useSocialChatStore((s) => s.recallGroupMessage);
  const editGroupMessage = useSocialChatStore((s) => s.editGroupMessage);
  const openThread = useSocialChatStore((s) => s.openThread);
  const messageHasMore = useSocialChatStore((s) => s.messageHasMore);
  const messageLoadingMore = useSocialChatStore((s) => s.messageLoadingMore);
  const currentUserDid = useSocialChatStore((s) => s.currentUserDid);
  const scrollToMessageUlid = useSocialChatStore((s) => s.scrollToMessageUlid);
  const setScrollToMessageUlid = useSocialChatStore((s) => s.setScrollToMessageUlid);
  const encryptionEnabled = useSocialChatStore((s) => s.encryptionEnabled);
  const friendP2pStatus = useSocialChatStore((s) => s.friendP2pStatus);
  const peerOnline = useSocialChatStore((s) => s.peerOnline);
  const typingPeers = useSocialChatStore((s) => s.typingPeers);
  const threadCounts = useSocialChatStore((s) => s.threadCounts);
  const [inputValue, setInputValue] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyDraft, setReplyDraft] = useState<{ conversationUlid: string | null; ulid: string | null }>({
    conversationUlid: null,
    ulid: null,
  });
  // When set, the input field operates in "edit" mode: pressing
  // Send dispatches `editFriendMessage(activeUlid, editingUlid, …)`
  // instead of creating a new message. The banner above the input
  // shows the original content + a cancel handle.
  const [editingUlid, setEditingUlid] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prependRestoreRef = useRef<{ previousHeight: number } | null>(null);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const replyToUlid = replyDraft.conversationUlid === activeUlid ? replyDraft.ulid : null;
  const setReplyToUlidForActive = (ulid: string | null) => {
    setReplyDraft({ conversationUlid: activeUlid, ulid });
  };
  const currentMessages = activeUlid ? (messages[activeUlid] || EMPTY_MESSAGES) : EMPTY_MESSAGES;
  const threadReplyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const msg of currentMessages) {
      const rootUlid = getThreadRootUlid(msg);
      if (!rootUlid) continue;
      counts.set(rootUlid, (counts.get(rootUlid) ?? 0) + 1);
    }
    return counts;
  }, [currentMessages]);

  const currentName = (() => {
    if (activeTab === 'friend') {
      const s = sessions.find((sess) => sess.ulid === activeUlid);
      if (!s) return '';
      if (currentUserDid) {
        if (s.participantADid === currentUserDid)
          return s.participantBDisplayName || s.participantBDid || '';
        if (s.participantBDid === currentUserDid)
          return s.participantADisplayName || s.participantADid || '';
      }
      return s.participantBDisplayName || s.participantBDid || '';
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
          return s.participantBAvatar || '';
        if (s.participantBDid === currentUserDid)
          return s.participantAAvatar || '';
      }
      return s.participantBAvatar || '';
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
    if (!activeUlid) return;
    const kind = activeTab === 'friend' ? 'friend' : 'group';
    const frame = requestAnimationFrame(() => {
      void loadMessages(activeUlid, kind);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeUlid, activeTab, loadMessages]);

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

  // ---- Typing-state outbound pulses --------------------------------
  //
  // Wire contract: see docs/architecture/realtime/event-stream.md
  // §2.7 (TypingState). The sender emits *at most* one `typing=true`
  // every 3s while the user is actively typing and a single
  // `typing=false` once they pause for 4s, send, blur, or change
  // session. The receiver's GC sweep (SocialChatPage) clears
  // phantom typing after 6s of silence.
  //
  // Refs (rather than state) for the timer handles + last-true epoch
  // because the typing path is hot — a state update on every
  // keystroke would re-render every message and tank typing
  // throughput on long conversations.
  //
  // Group chats have no recipient_actor_id we can route to today:
  // the realtime stream is per-actor, and group fan-out would need
  // server-side per-member republish. We therefore only emit typing
  // for friend chats; group typing is intentionally deferred to the
  // group_chat fan-out work.
  const typingThrottleRef = useRef<{ lastTrueAt: number; idleTimer: number | null }>({
    lastTrueAt: 0,
    idleTimer: null,
  });

  const peerActorIdForTyping = activeTab === 'friend' ? activePeerDid : null;

  const fireTyping = (typing: boolean) => {
    if (!activeUlid || !peerActorIdForTyping) return;
    api.realtimeTypingSend(peerActorIdForTyping, activeUlid, typing).catch((err) => {
      // Typing is best-effort; debug-level only so a temporarily
      // unreachable station does not spam the user-visible log.
      log.debug('chat', 'typing pulse failed', { typing, error: err });
    });
  };

  const scheduleIdleStop = () => {
    const ref = typingThrottleRef.current;
    if (ref.idleTimer != null) {
      window.clearTimeout(ref.idleTimer);
    }
    ref.idleTimer = window.setTimeout(() => {
      fireTyping(false);
      ref.lastTrueAt = 0;
      ref.idleTimer = null;
    }, 4000);
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);
    if (!activeUlid || !peerActorIdForTyping) return;
    if (!value.trim()) {
      // Empty input — treat as "stopped". Cancel the idle timer
      // and emit `typing=false` only if we previously emitted true.
      const ref = typingThrottleRef.current;
      if (ref.idleTimer != null) {
        window.clearTimeout(ref.idleTimer);
        ref.idleTimer = null;
      }
      if (ref.lastTrueAt > 0) {
        fireTyping(false);
        ref.lastTrueAt = 0;
      }
      return;
    }
    const now = Date.now();
    const ref = typingThrottleRef.current;
    if (now - ref.lastTrueAt > 3000) {
      fireTyping(true);
      ref.lastTrueAt = now;
    }
    scheduleIdleStop();
  };

  // Cleanup on unmount / session switch: emit `typing=false` so the
  // peer's bubble clears immediately rather than waiting for the
  // GC sweep TTL. We deliberately use a ref-captured "last
  // session/peer" rather than the closure-captured ones below
  // because by the time this teardown runs the activeUlid has
  // already changed.
  const lastTypingTargetRef = useRef<{ sessionUlid: string; peerActorId: string } | null>(null);
  useEffect(() => {
    const typingState = typingThrottleRef.current;
    if (activeUlid && peerActorIdForTyping) {
      lastTypingTargetRef.current = {
        sessionUlid: activeUlid,
        peerActorId: peerActorIdForTyping,
      };
    } else {
      lastTypingTargetRef.current = null;
    }
    return () => {
      if (typingState.idleTimer != null) {
        window.clearTimeout(typingState.idleTimer);
        typingState.idleTimer = null;
      }
      if (typingState.lastTrueAt > 0 && lastTypingTargetRef.current) {
        const target = lastTypingTargetRef.current;
        api
          .realtimeTypingSend(target.peerActorId, target.sessionUlid, false)
          .catch(() => {});
        typingState.lastTrueAt = 0;
      }
    };
  }, [activeUlid, peerActorIdForTyping]);

  // Receiver-side: derive whether the peer is composing in the
  // currently-active conversation. We also expose a list of typing
  // names for group chats once the group fan-out lands; for friend
  // chats the entry is keyed on the peer's actor_id.
  const peerIsTyping = (() => {
    if (!activeUlid) return false;
    const map = typingPeers[activeUlid];
    if (!map) return false;
    if (activeTab === 'friend') {
      return Object.entries(map).some(([actorId, entry]) => (
        actorId !== currentUserDid && entry.typing
      ));
    }
    // For groups, "any peer typing" until the per-member panel lands.
    return Object.entries(map).some(([actorId, entry]) => (
      actorId !== currentUserDid && entry.typing
    ));
  })();

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
    const editTarget = editingUlid;
    setInputValue('');
    setReplyToUlidForActive(null);
    setEditingUlid(null);
    setSending(true);
    // Sending implies "stopped composing" — flip the bubble for the
    // peer immediately rather than waiting on the 4s idle timer.
    {
      const ref = typingThrottleRef.current;
      if (ref.idleTimer != null) {
        window.clearTimeout(ref.idleTimer);
        ref.idleTimer = null;
      }
      if (ref.lastTrueAt > 0) {
        fireTyping(false);
        ref.lastTrueAt = 0;
      }
    }
    try {
      if (editTarget) {
        // Edit path — works for both friend & group chats now that
        // both use the unified MessageMutation contract. The store
        // action does the optimistic apply; the realtime echo
        // confirms it. Encrypted-payload edits are gated off in
        // `canEdit` (see comment there) so we always pass plaintext.
        try {
          if (activeTab === 'friend') {
            await editFriendMessage(activeUlid, editTarget, content);
          } else {
            await editGroupMessage(activeUlid, editTarget, content);
          }
        } catch (err) {
          log.error('chat', 'edit message failed', err);
          toast.error(t('chat.social.messageArea.editFailed', 'Edit failed'));
        }
        return;
      }
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
    } catch (err) {
      log.error('chat', 'send message failed', err);
      setInputValue(content);
      setReplyToUlidForActive(replyRef ?? null);
      toast.error(t('chat.social.messageArea.sendFailed', 'Message failed to send'));
    } finally {
      setSending(false);
    }
  };

  /**
   * Resolve the friend message corresponding to a ulid in the
   * currently-active session. Returns null when the active tab is
   * Returns the row regardless of chat kind — both FriendChatMessage
   * and GroupMessage carry the recall / edit-relevant fields after
   * the unified MessageMutation contract landed.
   */
  const findActiveMsg = (ulid: string): FriendChatMessage | GroupMessage | null => {
    return currentMessages.find((x) => x.ulid === ulid) ?? null;
  };

  /** Voice / video calls are only meaningful for friend chats with
   *  an active RTCPeerConnection — the call piggy-backs onto the
   *  same PC used for chat hints. Group calls and "cold" calls
   *  (where no PC is open yet) are explicitly out of scope until
   *  SFU support lands. */
  const callsAvailable = (() => {
    if (activeTab !== 'friend' || !activeUlid || !currentUserDid) return false;
    const s = friendP2pStatus[activeUlid];
    return !!s && s.state === 'connected';
  })();

  const handleStartCall = async (kind: 'audio' | 'video') => {
    if (!callsAvailable || !currentUserDid) return;
    const session = sessions.find((s) => s.ulid === activeUlid);
    if (!session) return;
    const peerDid = session.participantADid === currentUserDid
      ? session.participantBDid
      : session.participantADid;
    if (!peerDid) return;
    try {
      await friendChatP2p.startCall(currentUserDid, peerDid, kind);
    } catch (err) {
      log.error('chat', 'startCall failed', err);
      toast.error(t('chat.social.call.mediaDenied'));
    }
  };

  const handleRecall = async (msg: FriendChatMessage | GroupMessage) => {
    if (!activeUlid) return;
    try {
      if (isFriendMsg(msg)) {
        await recallFriendMessage(activeUlid, msg.ulid);
      } else {
        await recallGroupMessage(activeUlid, msg.ulid);
      }
    } catch (err) {
      log.error('chat', 'recall message failed', err);
      toast.error(t('chat.social.messageArea.recallFailed', 'Recall failed'));
    }
  };

  const handleStartEdit = (msg: FriendChatMessage | GroupMessage) => {
    // Only plaintext messages are editable today. An E2EE chat
    // would need a separate flow that re-encrypts under the active
    // ratchet key before issuing the RPC; we deliberately disable
    // the Edit button in `canEdit` rather than half-supporting it.
    setEditingUlid(msg.ulid);
    setInputValue(msg.content);
    setReplyToUlidForActive(null);
  };

  const cancelEdit = () => {
    setEditingUlid(null);
    setInputValue('');
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
      filePath = await api.ossPickAttachmentChat();
    } catch {
      return;
    }
    if (!filePath) return;

    setSending(true);
    try {
      const uploaded = await api.ossUploadAttachmentChat({
        file_path: filePath,
        bucket: 'chat',
        visibility: 'chat',
        chat_session_id: activeUlid,
      });
      if (!uploaded) {
        toast.error(t('chat.social.messageArea.uploadFailed'));
        return;
      }
      const isImage = isUploadedImage(uploaded.filename, uploaded.mime_type);
      const msgType = isImage ? 2 : 3;
      const messageContent = isImage ? '' : uploaded.filename;
      if (isImage) {
        seedLocalMediaProjection({
          cid: uploaded.cid,
          filePath,
          mimeType: uploaded.mime_type,
        });
      }
      const attachment = {
        cid: uploaded.cid,
        filename: uploaded.filename,
        mime_type: uploaded.mime_type,
        size: uploaded.size,
        thumbnail_cid: '',
        // The OSS subserver echoes `visibility` in the upload
        // response; default to the value we just asked for so the
        // recipient renders the correct scope chip even when the
        // server build does not yet populate the field.
        visibility: uploaded.visibility ?? 'chat',
      };
      if (activeTab === 'friend') {
        const session = sessions.find((s) => s.ulid === activeUlid);
        const receiverDid = session
          ? session.participantADid === currentUserDid
            ? session.participantBDid
            : session.participantADid
          : '';
        await sendFriendMessage(activeUlid, receiverDid, messageContent, msgType, undefined, [attachment]);
      } else {
        await sendGroupMessage(activeUlid, messageContent, msgType, undefined, [attachment]);
      }
    } catch (err) {
      log.error('chat', 'file upload failed', err);
      toast.error(t('chat.social.messageArea.uploadFailed'));
    } finally {
      setSending(false);
    }
  };

  const replyingMsg = replyToUlid ? currentMessages.find((m) => m.ulid === replyToUlid) : null;
  const canSend = inputValue.trim().length > 0 && !sending;

  if (!activeUlid) {
    return (
      <Flexbox flex={1} align="center" justify="center" gap={12} style={{ background: token.colorBgContainer }}>
        <Inbox size={48} style={{ color: token.colorTextQuaternary }} />
        <Text type="secondary">{t('chat.social.messageArea.selectConversation')}</Text>
      </Flexbox>
    );
  }

  const hoverStyle = `
    .msg-row:hover .msg-hover-actions,
    .msg-row:focus-within .msg-hover-actions {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .chat-composer-input,
    .chat-composer-input textarea {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }
    .typing-dots {
      display: inline-flex;
      gap: 3px;
      align-items: center;
    }
    .typing-dots > span {
      display: inline-block;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.35;
      animation: typing-dot-bounce 1.2s infinite ease-in-out;
    }
    .typing-dots > span:nth-child(2) { animation-delay: 0.15s; }
    .typing-dots > span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes typing-dot-bounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
      30% { transform: translateY(-3px); opacity: 0.85; }
    }
  `;

  return (
    <Flexbox flex={1} gap={0} style={{ height: '100%', minHeight: 0, background: token.colorBgLayout }}>
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
          padding: '12px 18px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
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
          {/* Voice / video calls. Only meaningful for friend chats
              that already have an established P2P connection — the
              call rides on the same RTCPeerConnection used for chat
              hints. Group calls and "cold" calls (where no PC is
              open yet) are deferred until SFU support lands. */}
          <Tooltip
            title={
              callsAvailable
                ? t('chat.social.call.startAudio')
                : t('chat.social.call.unsupported')
            }
          >
            <Button
              type="text"
              icon={<Phone size={16} />}
              disabled={!callsAvailable}
              style={{ width: 32, height: 32 }}
              onClick={() => handleStartCall('audio')}
            />
          </Tooltip>
          <Tooltip
            title={
              callsAvailable
                ? t('chat.social.call.startVideo')
                : t('chat.social.call.unsupported')
            }
          >
            <Button
              type="text"
              icon={<Video size={16} />}
              disabled={!callsAvailable}
              style={{ width: 32, height: 32 }}
              onClick={() => handleStartCall('video')}
            />
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
        style={{
          minHeight: 0,
          overflow: 'auto',
          padding: '18px 28px 20px',
          background: `linear-gradient(180deg, ${token.colorBgLayout} 0%, ${token.colorBgContainer} 100%)`,
        }}
        gap={10}
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
          currentMessages.map((msg, index) => {
            const previousMsg = currentMessages[index - 1];
            const messageDate = getMessageTimestampDate(msg);
            const showDateSeparator = shouldShowDateSeparator(msg, previousMsg);
            const timelineGap = hasTimelineGap(msg, previousMsg);
            const isOwn = currentUserDid ? msg.senderDid === currentUserDid : false;
            const isGroup = !isFriendMsg(msg);
            const hasReply = getReplyToUlid(msg) || '';
            const threadKey = activeUlid ? socialThreadKey(activeTab, activeUlid, msg.ulid) : '';
            const loadedReplyCount = threadReplyCounts.get(msg.ulid) ?? 0;
            const threadSummary = threadKey ? threadCounts[threadKey] : undefined;
            const threadReplyCount = threadSummary?.replyCount ?? loadedReplyCount;
            const threadUnreadCount = threadSummary?.unreadCount ?? 0;
            const isEncryptedPlaceholder = msg.content === '[Encrypted Message]';
            const attachments = msg.attachments || [];
            const imageOnlyAttachments = attachments.length > 0 && attachments.every(isImageMessageAttachment);
            const contentText = msg.content?.trim() ?? '';
            const contentIsImageFilename = imageOnlyAttachments
              && attachments.some((att) => att.filename?.trim() === contentText);
            const visibleContent = contentIsImageFilename ? '' : msg.content;
            const mediaOnlyBubble = imageOnlyAttachments && !visibleContent && !isEncryptedPlaceholder;
            // Both FriendChatMessage and GroupMessage carry
            // `recalled` + `editedAt` as of the unified
            // MessageMutation contract. The UI no longer needs to
            // branch by chat kind for these flags.
            const isRecalled = (msg as { recalled?: boolean }).recalled === true;
            const editedAt = (msg as { editedAt?: FriendChatMessage['editedAt'] }).editedAt;
            // Mutation gating. Server enforces the same window /
            // ownership rules; the UI hides buttons that are
            // guaranteed to fail so we don't 422 the user.
            const sentMs = msg.sentAt ? timestampDate(msg.sentAt).getTime() : (msg.createdAt ? timestampDate(msg.createdAt).getTime() : 0);
            const withinWindow = isWithinMutationWindow(sentMs);
            const canRecall = isOwn && !isRecalled && withinWindow;
            const canEdit = isOwn && !isRecalled && withinWindow && !isEncryptedPlaceholder;

            const bubbleBg = isOwn ? token.colorPrimary : token.colorBgContainer;
            const bubbleColor = isOwn ? '#fff' : token.colorText;
            const bubbleRadius: CSSProperties['borderRadius'] = isOwn
              ? '16px 16px 6px 16px'
              : '16px 16px 16px 6px';
            const bubbleBorder = isOwn
              ? '1px solid transparent'
              : `1px solid ${token.colorBorderSecondary}`;

            return (
              <Fragment key={msg.ulid}>
                {showDateSeparator && messageDate && <DateSeparator date={messageDate} />}
                <Flexbox
                  data-message-ulid={msg.ulid}
                  className="msg-row"
                  horizontal
                  align="flex-end"
                  style={{
                    alignSelf: isOwn ? 'flex-end' : 'flex-start',
                    maxWidth: !isOwn && isGroup ? 'min(82%, 800px)' : 'min(74%, 740px)',
                    position: 'relative',
                    marginTop: timelineGap ? 8 : 0,
                  }}
                  gap={8}
                >
                  {!isOwn && isGroup && (
                    <UserSquareAvatar name={msg.senderDid} size={30} style={{ flexShrink: 0 }} />
                  )}

                  <Flexbox style={{ position: 'relative', minWidth: 0, maxWidth: '100%' }}>
                    <HoverActions
                      isOwn={isOwn}
                      canRecall={canRecall}
                      canEdit={canEdit}
                      onOpenThread={() => openThread(msg.ulid)}
                      onReply={() => setReplyToUlidForActive(msg.ulid)}
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
                      onRecall={() => {
                        const target = findActiveMsg(msg.ulid);
                        if (target) handleRecall(target);
                      }}
                      onEdit={() => {
                        const target = findActiveMsg(msg.ulid);
                        if (target) handleStartEdit(target);
                      }}
                    />

                    {!isOwn && isGroup && (
                      <Text
                        type="secondary"
                        style={{
                          fontSize: 11,
                          marginBottom: 4,
                          paddingLeft: 4,
                          color: token.colorTextTertiary,
                          fontWeight: 500,
                        }}
                      >
                        {msg.senderDid}
                      </Text>
                    )}

                  <Flexbox
                    style={{
                      padding: mediaOnlyBubble ? 0 : '9px 13px',
                      borderRadius: bubbleRadius,
                      // Recalled bubbles use the muted "fill quaternary" surface
                      // regardless of ownership so the tombstone reads as a
                      // neutral system-style note rather than an actor message.
                      background: mediaOnlyBubble ? 'transparent' : isRecalled ? token.colorFillQuaternary : bubbleBg,
                      border: mediaOnlyBubble ? '1px solid transparent' : isRecalled ? `1px solid ${token.colorBorderSecondary}` : bubbleBorder,
                      boxShadow: mediaOnlyBubble ? 'none' : isOwn ? token.boxShadowTertiary : token.boxShadowSecondary,
                      color: isRecalled ? token.colorTextSecondary : bubbleColor,
                      fontSize: 13,
                      lineHeight: 1.5,
                      wordBreak: 'break-word',
                      fontStyle: isRecalled ? 'italic' : 'normal',
                    }}
                  >
                    {hasReply && !isRecalled && (
                      <ReplyBlock
                        replyToUlid={hasReply}
                        messages={currentMessages}
                        isOwn={isOwn}
                      />
                    )}
                    {isRecalled ? (
                      <Flexbox horizontal align="center" gap={4}>
                        <RotateCcw size={12} style={{ color: token.colorTextQuaternary }} />
                        <Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
                          {isOwn
                            ? t('chat.social.messageArea.recalledByYou', 'You recalled a message')
                            : t('chat.social.messageArea.recalledByPeer', 'A message was recalled')}
                        </Text>
                      </Flexbox>
                    ) : isEncryptedPlaceholder ? (
                      <Flexbox horizontal align="center" gap={4}>
                        <Lock size={12} style={{ color: token.colorTextQuaternary }} />
                        <Text type="secondary" style={{ fontStyle: 'italic', fontSize: 13 }}>
                          {t('chat.social.encryption.encryptedMessage')}
                        </Text>
                      </Flexbox>
                    ) : (
                      visibleContent
                    )}
                    {!isRecalled && attachments.length > 0 && (
                      <Flexbox gap={6} style={{ marginTop: visibleContent ? 8 : 0 }}>
                        {attachments.map((att, idx) => (
                          <AttachmentItem
                            key={idx}
                            attachment={att}
                            isOwn={isOwn}
                            // Receiver-side scope badge: the sender is
                            // authoritative for visibility (the field
                            // is populated at upload time and travels
                            // with the message). When the field is
                            // empty (legacy senders), receivers see
                            // their own message scope as the fallback
                            // and our own messages still default to
                            // "chat" since that's the only scope the
                            // current upload UI emits.
                            visibilityHint={
                              normalizeVisibilityHint(att.visibility)
                              ?? (isOwn ? 'chat' : undefined)
                            }
                          />
                        ))}
                      </Flexbox>
                    )}
                  </Flexbox>

                  {threadReplyCount > 0 && !isRecalled && (
                    <Flexbox horizontal justify={isOwn ? 'flex-end' : 'flex-start'} style={{ marginTop: 6 }}>
                      <Button
                        type="text"
                        size="small"
                        icon={<MessageCircle size={12} />}
                        onClick={() => openThread(msg.ulid)}
                        style={{
                          height: 26,
                          padding: '0 8px',
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 500,
                          color: threadUnreadCount > 0 ? token.colorError : token.colorPrimary,
                          background: threadUnreadCount > 0 ? token.colorErrorBg : token.colorPrimaryBg,
                        }}
                      >
                        {threadUnreadCount > 0
                          ? t('chat.social.thread.summaryUnread', { count: threadReplyCount, unread: threadUnreadCount })
                          : t('chat.social.thread.summary', { count: threadReplyCount })}
                      </Button>
                    </Flexbox>
                  )}

                  <Flexbox
                    horizontal
                    align="center"
                    justify={isOwn ? 'flex-end' : 'flex-start'}
                    gap={5}
                    style={{ marginTop: 5, paddingLeft: 4, paddingRight: 4 }}
                  >
                    <Text
                      style={{
                        fontSize: 11,
                        color: token.colorTextTertiary,
                        lineHeight: 1.2,
                      }}
                    >
                      {formatMsgTime(msg.createdAt ?? msg.sentAt)}
                    </Text>
                    {editedAt && !isRecalled && (
                      <Tooltip title={
                        t('chat.social.messageArea.editedAtTooltip', {
                          defaultValue: 'Edited at {{time}}',
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
                          {t('chat.social.messageArea.editedTag', '(edited)')}
                        </Text>
                      </Tooltip>
                    )}
                    {isOwn && isFriendMsg(msg) && !isRecalled && (
                      <ReadReceipt status={msg.status} />
                    )}
                  </Flexbox>
                </Flexbox>
                </Flexbox>
              </Fragment>
            );
          })
        )}
        <div ref={bottomRef} />
      </Flexbox>

      <Flexbox
        style={{
          padding: '12px 18px 14px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          boxShadow: '0 -8px 24px rgba(0,0,0,0.03)',
          flexShrink: 0,
        }}
        gap={10}
      >
        {editingUlid && (
          // Edit-mode banner. Mutually exclusive with the reply
          // banner — `handleStartEdit` clears any pending reply,
          // and `handleSend` clears `editingUlid` on submit.
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              background: token.colorWarningBg,
              borderLeft: `3px solid ${token.colorWarning}`,
              boxShadow: token.boxShadowTertiary,
            }}
          >
            <Flexbox style={{ minWidth: 0, flex: 1 }}>
              <Text style={{ fontSize: 11, color: token.colorWarning, fontWeight: 500 }}>
                {t('chat.social.messageArea.editingMessage', 'Editing message')}
              </Text>
              <Text ellipsis type="secondary" style={{ fontSize: 12 }}>
                {currentMessages.find((m) => m.ulid === editingUlid)?.content || ''}
              </Text>
            </Flexbox>
            <Button
              type="text"
              size="small"
              icon={<XIcon size={14} />}
              onClick={cancelEdit}
              style={{ fontSize: 12, color: token.colorTextSecondary }}
            >
              {t('chat.social.messageArea.cancel')}
            </Button>
          </Flexbox>
        )}

        {replyingMsg && !editingUlid && (
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              background: token.colorFillTertiary,
              borderLeft: `3px solid ${token.colorPrimary}`,
              boxShadow: token.boxShadowTertiary,
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
              onClick={() => setReplyToUlidForActive(null)}
              style={{ fontSize: 12, color: token.colorTextSecondary }}
            >
              {t('chat.social.messageArea.cancel')}
            </Button>
          </Flexbox>
        )}

        {peerIsTyping && (
          <Flexbox
            horizontal
            align="center"
            gap={6}
            style={{
              width: 'fit-content',
              padding: '4px 10px',
              borderRadius: 999,
              color: token.colorPrimary,
              background: token.colorPrimaryBg,
              fontSize: 12,
              fontWeight: 500,
              lineHeight: 1,
            }}
            aria-label={t('chat.social.messageArea.typing', 'is typing…')}
          >
            <Text style={{ color: 'inherit', fontSize: 12 }}>
              {t('chat.social.messageArea.typing', 'is typing…')}
            </Text>
            <span className="typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </Flexbox>
        )}

        <ChatComposer
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Blurring the textarea is the user's "I'm stepping
            // away" signal. Cancel the idle timer and emit one
            // final `typing=false` so the peer's bubble clears
            // without waiting on the GC TTL.
            const ref = typingThrottleRef.current;
            if (ref.idleTimer != null) {
              window.clearTimeout(ref.idleTimer);
              ref.idleTimer = null;
            }
            if (ref.lastTrueAt > 0) {
              fireTyping(false);
              ref.lastTrueAt = 0;
            }
          }}
          onSend={handleSend}
          onAttach={handleAttachClick}
          canSend={canSend}
          disabled={sending}
          sending={sending}
          attachDisabled={sending}
          layout="inline"
          placeholder={t('chat.social.messageArea.placeholder')}
          attachTitle={t('chat.social.messageArea.attach', 'Attach file')}
          emojiTitle={t('chat.social.messageArea.emoji', 'Emoji')}
          sendTitle={t('chat.social.messageArea.send', 'Send')}
          enterMessageTitle={t('chat.social.messageArea.enterMessage', 'Enter a message')}
        />
      </Flexbox>
    </Flexbox>
  );
}
