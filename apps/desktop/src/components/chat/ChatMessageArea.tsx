import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tooltip } from '@lobehub/ui';
import { Empty, Spin, theme, Typography } from 'antd';
import {
  Inbox, Phone, Video, MoreHorizontal,
  Lock,
} from 'lucide-react';
import {
  CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
  collectChatThreadPreviewMessages,
} from '@peers-touch/client-chat-core';
import {
  peerOfSession,
  socialThreadKey,
  useSocialChatStore,
} from '../../store/socialChat';
import { SearchMessagesModal } from './SearchMessagesModal';
import { friendChatP2p } from '../../modules/p2p/friendChatP2p';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { toast } from '@lobehub/ui';
import { ChatComposer, type ChatComposerDraft } from './ChatComposer';
import type { FriendChatMessage } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import {
  isFriendMessage,
  messageThreadRootUlid,
  messageTimestampMs,
  replyPreviewForMessage,
} from './message/chatMessageModel';
import {
  ChatMessageTimeline,
  loadedThreadReplyCount,
} from './message/ChatMessageTimeline';

const { Text } = Typography;

function chatBackgroundCss(background: string | undefined, layoutColor: string, containerColor: string): string {
  switch (background) {
    case 'paper':
      return 'linear-gradient(180deg, rgba(255,251,235,0.9), rgba(254,243,199,0.52))';
    case 'mint':
      return 'linear-gradient(180deg, rgba(236,253,245,0.9), rgba(209,250,229,0.52))';
    case 'dusk':
      return 'linear-gradient(180deg, rgba(238,242,255,0.9), rgba(224,231,255,0.52))';
    case 'calm':
      return 'linear-gradient(180deg, rgba(239,246,255,0.9), rgba(219,234,254,0.52))';
    case 'graphite':
      return 'linear-gradient(180deg, rgba(51,65,85,0.12), rgba(15,23,42,0.08))';
    default:
      return `linear-gradient(180deg, ${layoutColor} 0%, ${containerColor} 100%)`;
  }
}

function ChatDeleteConfirmOverlay({
  deleting,
  onCancel,
  onConfirm,
}: {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  return (
    <Flexbox
      align="center"
      justify="center"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: 'rgba(15, 23, 42, 0.18)',
        padding: 24,
      }}
      onClick={() => {
        if (!deleting) onCancel();
      }}
    >
      <Flexbox
        gap={14}
        style={{
          width: 320,
          maxWidth: '100%',
          padding: 18,
          borderRadius: 8,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <Flexbox gap={6}>
          <Text strong style={{ fontSize: 15 }}>
            {t('chat.social.messageArea.deleteConfirmTitle')}
          </Text>
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.45 }}>
            {t('chat.social.messageArea.deleteConfirmBody')}
          </Text>
        </Flexbox>
        <Flexbox horizontal justify="flex-end" gap={8}>
          <Button disabled={deleting} onClick={onCancel}>
            {t('chat.social.messageArea.cancel')}
          </Button>
          <Button type="primary" danger loading={deleting} onClick={onConfirm}>
            {t('chat.social.messageArea.deleteConfirmOk')}
          </Button>
        </Flexbox>
      </Flexbox>
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
    recallGroupMessage, editGroupMessage, openThread,
    conversationLocalState,
  } = useSocialChatStore();
  const messageHasMore = useSocialChatStore((s) => s.messageHasMore);
  const messageLoadingMore = useSocialChatStore((s) => s.messageLoadingMore);
  const currentUserDid = useSocialChatStore((s) => s.currentUserDid);
  const currentUserProfile = useSocialChatStore((s) => s.currentUserProfile);
  const groupMembers = useSocialChatStore((s) => s.groupMembers);
  const loadGroupMembers = useSocialChatStore((s) => s.loadGroupMembers);
  const scrollToMessageUlid = useSocialChatStore((s) => s.scrollToMessageUlid);
  const setScrollToMessageUlid = useSocialChatStore((s) => s.setScrollToMessageUlid);
  const encryptionEnabled = useSocialChatStore((s) => s.encryptionEnabled);
  const friendP2pStatus = useSocialChatStore((s) => s.friendP2pStatus);
  const peerOnline = useSocialChatStore((s) => s.peerOnline);
  const typingPeers = useSocialChatStore((s) => s.typingPeers);
  const threadCounts = useSocialChatStore((s) => s.threadCounts);
  const threadMessages = useSocialChatStore((s) => s.threadMessages);
  const [inputValue, setInputValue] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyToUlid, setReplyToUlid] = useState<string | null>(null);
  const [highlightedMessageUlid, setHighlightedMessageUlid] = useState<string | null>(null);
  // When set, the input field operates in "edit" mode: pressing
  // Send dispatches `editFriendMessage(activeUlid, editingUlid, …)`
  // instead of creating a new message. The banner above the input
  // shows the original content + a cancel handle.
  const [editingUlid, setEditingUlid] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FriendChatMessage | GroupMessage | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prependRestoreRef = useRef<{ previousHeight: number } | null>(null);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const activeKind = activeTab === 'friend' ? 'friend' : 'group';
  const currentMessages = activeUlid ? (messages[activeUlid] || []) : [];
  const mainTimelineMessages = currentMessages.filter((message) => !messageThreadRootUlid(message));
  const activeBackground = activeUlid ? conversationLocalState[`${activeTab}:${activeUlid}`]?.background : undefined;

  const activeFriendPeer = (() => {
    if (activeTab !== 'friend' || !activeUlid) return null;
    const s = sessions.find((sess) => sess.ulid === activeUlid);
    if (!s) return null;
    return peerOfSession(s, currentUserDid);
  })();

  const currentName = (() => {
    if (activeTab === 'friend') {
      return activeFriendPeer?.name || '';
    }
    const g = groups.find((grp) => grp.ulid === activeUlid);
    return g?.name || '';
  })();

  const subtitle = (() => {
    if (activeTab === 'friend') return '';
    const g = groups.find((g) => g.ulid === activeUlid);
    return g ? t('chat.social.detail.membersCount', { count: g.memberCount }) : '';
  })();

  // Resolve the active peer DID for friend conversations. Used by the
  // header presence dot to decide whether the friend is reachable on
  // station, separate from whether our P2P channel happens to be up.
  const activePeerDid = activeTab === 'friend' ? activeFriendPeer?.did || null : null;

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
      ? t('chat.social.presence.online')
      : t('chat.social.presence.offline');
    return (
      <Tooltip title={tip}>
        <span
          aria-label={tip}
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
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
    if (activeTab !== 'group' || !activeUlid) return;
    loadGroupMembers(activeUlid).catch((error) => {
      log.warn('socialChat', 'message area loadGroupMembers failed', error);
    });
  }, [activeTab, activeUlid, loadGroupMembers]);

  useEffect(() => {
    if (prependRestoreRef.current && scrollContainerRef.current) {
      const { previousHeight } = prependRestoreRef.current;
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight - previousHeight;
      prependRestoreRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mainTimelineMessages.length]);

  useEffect(() => {
    setReplyToUlid(null);
    setDeleteTarget(null);
    setDeletingMessage(false);
  }, [activeUlid]);

  useEffect(() => {
    const openSearch = () => setShowSearch(true);
    window.addEventListener('peers-chat:open-search', openSearch);
    return () => window.removeEventListener('peers-chat:open-search', openSearch);
  }, []);

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
      setHighlightedMessageUlid(scrollToMessageUlid);
      window.setTimeout(() => setHighlightedMessageUlid(null), 1800);
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

  const stopTypingPulse = () => {
    const ref = typingThrottleRef.current;
    if (ref.idleTimer != null) {
      window.clearTimeout(ref.idleTimer);
      ref.idleTimer = null;
    }
    if (ref.lastTrueAt > 0) {
      fireTyping(false);
      ref.lastTrueAt = 0;
    }
  };

  const handleSend = async (draft: ChatComposerDraft) => {
    if ((!draft.text && draft.attachments.length === 0) || !activeUlid) return;
    const content = draft.text;
    const replyRef = replyToUlid || undefined;
    const editTarget = editingUlid;
    setInputValue('');
    setReplyToUlid(null);
    setEditingUlid(null);
    setSending(true);
    // Sending implies "stopped composing" — flip the bubble for the
    // peer immediately rather than waiting on the 4s idle timer.
    stopTypingPulse();
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
          toast.error(t('chat.social.messageArea.editFailed'));
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
        await sendFriendMessage(
          activeUlid,
          receiverDid,
          content,
          draft.messageType,
          replyRef,
          draft.attachments.length > 0 ? draft.attachments : undefined,
        );
      } else {
        await sendGroupMessage(
          activeUlid,
          content,
          draft.messageType,
          replyRef,
          draft.attachments.length > 0 ? draft.attachments : undefined,
        );
      }
    } finally {
      setSending(false);
    }
  };

  /** Voice / video calls are only meaningful for friend chats with
   *  an active RTCPeerConnection. Text chat uses the realtime SSE
   *  stream; WebRTC readiness gates calls only. */
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
      if (isFriendMessage(msg)) {
        await recallFriendMessage(activeUlid, msg.ulid);
      } else {
        await recallGroupMessage(activeUlid, msg.ulid);
      }
    } catch (err) {
      log.error('chat', 'recall message failed', err);
      toast.error(t('chat.social.messageArea.recallFailed'));
    }
  };

  const confirmDeleteMessage = (target: FriendChatMessage | GroupMessage) => {
    if (!activeUlid) return;
    setDeleteTarget(target);
  };

  const handleConfirmDelete = async () => {
    if (!activeUlid || !deleteTarget) return;
    setDeletingMessage(true);
    try {
      await deleteMessage(activeUlid, deleteTarget.ulid, activeKind);
      setDeleteTarget(null);
    } catch (e) {
      log.error('chat', 'deleteMessage failed', e);
      toast.error(t('chat.social.messageArea.deleteFailed'));
    } finally {
      setDeletingMessage(false);
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

  const replyingMsg = replyToUlid ? currentMessages.find((m) => m.ulid === replyToUlid) : null;
  const replyingPreview = replyPreviewForMessage(replyingMsg, {
    image: t('chat.social.messageArea.attachmentTypeImage'),
    video: t('chat.social.messageArea.attachmentTypeVideo'),
    audio: t('chat.social.messageArea.attachmentTypeAudio'),
    file: t('chat.social.messageArea.attachmentTypeFile'),
  });

  const threadPreviewMessagesForRoot = (rootUlid: string) => {
    if (!activeUlid || !rootUlid) return [];
    const key = socialThreadKey(activeKind, activeUlid, rootUlid);
    return collectChatThreadPreviewMessages({
      rootUlid,
      currentMessages,
      loadedThreadMessages: threadMessages[key] || [],
      resolveTimestampMs: messageTimestampMs,
    });
  };

  if (!activeUlid) {
    return (
      <Flexbox flex={1} align="center" justify="center" gap={12} style={{ background: token.colorBgContainer }}>
        <Inbox size={48} style={{ color: token.colorTextQuaternary }} />
        <Text type="secondary">{t('chat.social.messageArea.selectConversation')}</Text>
      </Flexbox>
    );
  }

  const conversationSurfaceBackground = chatBackgroundCss(
    activeBackground,
    token.colorBgLayout,
    token.colorBgContainer,
  );
  const headerSubtitle = activeTab === 'friend'
    ? peerIsTyping
      ? t('chat.social.messageArea.typing')
      : ''
    : subtitle;

  return (
    <Flexbox
      flex={1}
      gap={0}
      style={{
        height: '100%',
        background: token.colorBgLayout,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <style>
        {`
          .chat-message-scroll {
            scrollbar-width: thin;
            scrollbar-color: ${token.colorFillSecondary} transparent;
          }
          .chat-message-scroll::-webkit-scrollbar {
            width: 6px;
            height: 0;
          }
          .chat-message-scroll::-webkit-scrollbar-thumb {
            background: ${token.colorFillSecondary};
            border-radius: 999px;
          }
          .chat-message-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
        `}
      </style>
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
          height: 64,
          padding: '0 18px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          flexShrink: 0,
        }}
      >
        <Flexbox horizontal align="center" gap={10}>
          <Flexbox horizontal align="center" gap={6}>
            <Flexbox>
              <Flexbox horizontal align="center" gap={6}>
                <Text strong style={{ fontSize: 14 }}>{currentName}</Text>
                {peerOnlineIndicator}
                {encryptionEnabled && (
                  <Tooltip title={t('chat.social.encryption.enabled')}>
                    <Lock size={13} style={{ color: token.colorTextTertiary, marginLeft: 2 }} />
                  </Tooltip>
                )}
              </Flexbox>
              {headerSubtitle && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {headerSubtitle}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal align="center" gap={4}>
          {/* Voice / video calls. Only meaningful for friend chats
              that already have an established WebRTC connection.
              Group calls and "cold" calls (where no PC is open yet)
              are deferred until SFU support lands. */}
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
          <Button type="text" icon={<MoreHorizontal size={16} />} style={{ width: 32, height: 32, borderRadius: 10 }} onClick={toggleDetail} />
        </Flexbox>
      </Flexbox>

      <Flexbox
        className="chat-message-scroll"
        flex={1}
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '18px 20px 18px',
          background: conversationSurfaceBackground,
        }}
        gap={10}
      >
        {activeUlid && messageLoadingMore[activeUlid] && (
          <Flexbox align="center" justify="center" style={{ paddingBottom: 8 }}>
            <Spin size="small" />
          </Flexbox>
        )}
        {loading && mainTimelineMessages.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1}>
            <Spin />
          </Flexbox>
        ) : mainTimelineMessages.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.messageArea.noMessages')} />
          </Flexbox>
        ) : (
          <ChatMessageTimeline
            activeConversationId={activeUlid}
            activeKind={activeKind}
            currentUserDid={currentUserDid}
            currentUserProfile={currentUserProfile}
            groupMembers={groupMembers}
            highlightedMessageUlid={highlightedMessageUlid}
            messages={mainTimelineMessages}
            onDelete={confirmDeleteMessage}
            onEdit={handleStartEdit}
            onOpenThread={openThread}
            onRecall={handleRecall}
            onReply={(messageUlid) => {
              setEditingUlid(null);
              setReplyToUlid(messageUlid);
            }}
            resolveThreadStats={(message) => {
              const threadKey = socialThreadKey(activeKind, activeUlid, message.ulid);
              const threadSummary = threadCounts[threadKey];
              return {
                replyCount: threadSummary?.replyCount ?? loadedThreadReplyCount(currentMessages, message.ulid),
                previewMessages: threadPreviewMessagesForRoot(message.ulid),
                unreadCount: threadSummary?.unreadCount ?? 0,
              };
            }}
            sessions={sessions}
          />
        )}
        <div ref={bottomRef} />
      </Flexbox>

      <ChatComposer
        activeConversationId={activeUlid}
        disabled={!activeUlid}
        editing={Boolean(editingUlid)}
        surfaceBackground={conversationSurfaceBackground}
        value={inputValue}
        onChange={handleInputChange}
        onBlurInput={stopTypingPulse}
        onCancelEdit={cancelEdit}
        onCancelReply={() => setReplyToUlid(null)}
        onSend={handleSend}
        replyPreview={replyingPreview}
        replyPreviewKey={replyToUlid}
        editPreview={editingUlid ? currentMessages.find((m) => m.ulid === editingUlid)?.content || '' : undefined}
        sending={sending}
        capabilities={CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN}
      />

      {deleteTarget && (
        <ChatDeleteConfirmOverlay
          deleting={deletingMessage}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleConfirmDelete}
        />
      )}
    </Flexbox>
  );
}
