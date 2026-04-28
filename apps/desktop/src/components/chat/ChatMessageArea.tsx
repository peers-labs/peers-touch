import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, TextArea, Tooltip, EmojiPicker } from '@lobehub/ui';
import { Spin, theme, Typography, Empty } from 'antd';
import {
  Send, Inbox, Phone, Video, Search, Info,
  Paperclip, Check, CheckCheck,
  Reply, Trash2, Lock, RotateCcw, Pencil, X as XIcon,
} from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { SearchMessagesModal } from './SearchMessagesModal';
import { AttachmentItem } from './AttachmentItem';
import { friendChatP2p } from '../../modules/p2p/friendChatP2p';
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
  /** Whether the [Recall] button should be shown. Recall is gated
   *  client-side by ownership + friend chat + within the recall
   *  window — the server still enforces both. We hide the button
   *  proactively so the user doesn't get a "too late" error after
   *  clicking. */
  canRecall: boolean;
  /** Whether the [Edit] button should be shown. Same gating as
   *  recall (ownership + friend chat + window) plus "not recalled". */
  canEdit: boolean;
  onReply: () => void;
  onDelete: () => void;
  onRecall: () => void;
  onEdit: () => void;
}

function HoverActions({ isOwn, canRecall, canEdit, onReply, onDelete, onRecall, onEdit }: HoverActionsProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
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
      <Tooltip title={t('chat.social.messageArea.actionReply', 'Reply')}>
        <Button
          type="text"
          size="small"
          icon={<Reply size={14} />}
          onClick={onReply}
          style={{ width: 26, height: 26 }}
        />
      </Tooltip>
      {canEdit && (
        <Tooltip title={t('chat.social.messageArea.actionEdit', 'Edit')}>
          <Button
            type="text"
            size="small"
            icon={<Pencil size={14} />}
            onClick={onEdit}
            style={{ width: 26, height: 26 }}
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
            style={{ width: 26, height: 26 }}
          />
        </Tooltip>
      )}
      <Tooltip title={t('chat.social.messageArea.actionDelete', 'Delete')}>
        <Button
          type="text"
          size="small"
          icon={<Trash2 size={14} />}
          onClick={onDelete}
          style={{ width: 26, height: 26, color: token.colorError }}
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
    deleteMessage, recallFriendMessage, editFriendMessage,
    recallGroupMessage, editGroupMessage,
  } = useSocialChatStore();
  const messageHasMore = useSocialChatStore((s) => s.messageHasMore);
  const messageLoadingMore = useSocialChatStore((s) => s.messageLoadingMore);
  const currentUserDid = useSocialChatStore((s) => s.currentUserDid);
  const scrollToMessageUlid = useSocialChatStore((s) => s.scrollToMessageUlid);
  const setScrollToMessageUlid = useSocialChatStore((s) => s.setScrollToMessageUlid);
  const encryptionEnabled = useSocialChatStore((s) => s.encryptionEnabled);
  const friendP2pStatus = useSocialChatStore((s) => s.friendP2pStatus);
  const peerOnline = useSocialChatStore((s) => s.peerOnline);
  const typingPeers = useSocialChatStore((s) => s.typingPeers);
  const [inputValue, setInputValue] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyToUlid, setReplyToUlid] = useState<string | null>(null);
  // When set, the input field operates in "edit" mode: pressing
  // Send dispatches `editFriendMessage(activeUlid, editingUlid, …)`
  // instead of creating a new message. The banner above the input
  // shows the original content + a cancel handle.
  const [editingUlid, setEditingUlid] = useState<string | null>(null);
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
    if (activeUlid && peerActorIdForTyping) {
      lastTypingTargetRef.current = {
        sessionUlid: activeUlid,
        peerActorId: peerActorIdForTyping,
      };
    } else {
      lastTypingTargetRef.current = null;
    }
    return () => {
      const ref = typingThrottleRef.current;
      if (ref.idleTimer != null) {
        window.clearTimeout(ref.idleTimer);
        ref.idleTimer = null;
      }
      if (ref.lastTrueAt > 0 && lastTypingTargetRef.current) {
        const target = lastTypingTargetRef.current;
        api
          .realtimeTypingSend(target.peerActorId, target.sessionUlid, false)
          .catch(() => {});
        ref.lastTrueAt = 0;
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
      if (!peerActorIdForTyping) return false;
      const e = map[peerActorIdForTyping];
      return Boolean(e?.typing);
    }
    // For groups, "any peer typing" until the per-member panel lands.
    return Object.values(map).some((e) => e.typing);
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
    setReplyToUlid(null);
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
    setReplyToUlid(null);
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
            const withinWindow = sentMs > 0 && (Date.now() - sentMs) < FRIEND_RECALL_WINDOW_MS;
            const canRecall = isOwn && !isRecalled && withinWindow;
            const canEdit = isOwn && !isRecalled && withinWindow && !isEncryptedPlaceholder;

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
                    canRecall={canRecall}
                    canEdit={canEdit}
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
                      style={{ fontSize: 11, marginBottom: 2, paddingLeft: 2 }}
                    >
                      {msg.senderDid}
                    </Text>
                  )}

                  <Flexbox
                    style={{
                      padding: '8px 12px',
                      borderRadius: bubbleRadius,
                      // Recalled bubbles use the muted "fill quaternary" surface
                      // regardless of ownership so the tombstone reads as a
                      // neutral system-style note rather than an actor message.
                      background: isRecalled ? token.colorFillQuaternary : bubbleBg,
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
                      msg.content
                    )}
                    {!isRecalled && msg.attachments && msg.attachments.length > 0 && (
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
                    {editedAt && !isRecalled && (
                      <Tooltip title={
                        t('chat.social.messageArea.editedAtTooltip', {
                          defaultValue: 'Edited at {{time}}',
                          time: timestampDate(editedAt).toLocaleString(),
                        })
                      }>
                        <Text
                          style={{
                            fontSize: 10,
                            color: token.colorTextQuaternary,
                            fontStyle: 'italic',
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
            );
          })
        )}
        {peerIsTyping && (
          // Receiver-side typing indicator. The bubble is laid out
          // exactly like an incoming peer message so it doesn't shift
          // the message list when it appears/disappears (avoiding a
          // layout thrash). The dots are pure CSS animation; we
          // intentionally don't use a spinner so it's distinguishable
          // from "still loading messages".
          <Flexbox
            horizontal={false}
            style={{
              alignSelf: 'flex-start',
              maxWidth: '70%',
            }}
          >
            <Flexbox
              horizontal
              align="center"
              gap={4}
              style={{
                padding: '8px 12px',
                borderRadius: '12px 12px 12px 4px',
                background: token.colorFillSecondary,
                color: token.colorTextSecondary,
                fontSize: 13,
                lineHeight: 1.5,
              }}
              aria-label={t('chat.social.messageArea.typing', 'is typing…')}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.messageArea.typing', 'is typing…')}
              </Text>
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </Flexbox>
          </Flexbox>
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
        {editingUlid && (
          // Edit-mode banner. Mutually exclusive with the reply
          // banner — `handleStartEdit` clears any pending reply,
          // and `handleSend` clears `editingUlid` on submit.
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              background: token.colorWarningBg,
              borderLeft: `3px solid ${token.colorWarning}`,
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
            onChange={(e) => handleInputChange(e.target.value)}
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
