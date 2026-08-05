import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tooltip, toast } from '@lobehub/ui';
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
  socialThreadKey,
} from '../../store/socialChat';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';
import { SearchMessagesModal } from './SearchMessagesModal';
import { friendChatP2p } from '../../modules/p2p/friendChatP2p';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { presentError } from '../../services/errorPresenter';
import { ChatComposer, type ChatComposerDraft } from './ChatComposer';
import {
  type ChatMessage,
  messageThreadRootUlid,
  messageTimestampMs,
  replyPreviewForMessage,
} from './message/chatMessageModel';
import {
  ChatMessageTimeline,
  loadedThreadReplyCount,
} from './message/ChatMessageTimeline';
import { ChatDeleteConfirmOverlay } from './ChatDeleteConfirmOverlay';
import { ForwardPickerModal } from './ForwardPickerModal';
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';
import { resolveChatPresenceTag } from '../../services/chatPresence';

const { Text } = Typography;

function chatBackgroundCss(
  background: string | undefined,
  layoutColor: string,
  containerColor: string,
  imageUrl?: string,
): string {
  if (imageUrl) {
    return `linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.72)), url("${imageUrl}") center / cover fixed`;
  }
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

export function ChatMessageArea() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    loadMessages, loadOlderMessages, sendFriendMessage, retryFriendMessage, sendGroupMessage, toggleDetail,
    deleteMessage, recallFriendMessage, editFriendMessage,
    recallGroupMessage, editGroupMessage, openThread,
    conversationLocalState,
    getIMConversations,
    getIMMessages,
    getIMThreadMessages,
    getIMSenderProfile,
    messageHasMore,
    messageLoadingMore,
    currentUserDid,
    loadGroupMembers,
    scrollToMessageUlid,
    setScrollToMessageUlid,
    encryptionEnabled,
    sessionSecurityState,
    groupSecurityState,
    friendP2pStatus,
    peerOnline,
    typingPeers,
    threadCounts,
    reactToMessage,
    conversationMembers,
  } = useActiveSocialChatSlice((s) => ({
    activeTab: s.activeTab,
    activeSessionUlid: s.activeSessionUlid,
    activeGroupUlid: s.activeGroupUlid,
    loadMessages: s.loadMessages,
    loadOlderMessages: s.loadOlderMessages,
    sendFriendMessage: s.sendFriendMessage,
    retryFriendMessage: s.retryFriendMessage,
    sendGroupMessage: s.sendGroupMessage,
    toggleDetail: s.toggleDetail,
    deleteMessage: s.deleteMessage,
    recallFriendMessage: s.recallFriendMessage,
    editFriendMessage: s.editFriendMessage,
    recallGroupMessage: s.recallGroupMessage,
    editGroupMessage: s.editGroupMessage,
    openThread: s.openThread,
    conversationLocalState: s.conversationLocalState,
    getIMConversations: s.getIMConversations,
    getIMMessages: s.getIMMessages,
    getIMThreadMessages: s.getIMThreadMessages,
    getIMSenderProfile: s.getIMSenderProfile,
    messageHasMore: s.messageHasMore,
    messageLoadingMore: s.messageLoadingMore,
    currentUserDid: s.currentUserDid,
    loadGroupMembers: s.loadGroupMembers,
    scrollToMessageUlid: s.scrollToMessageUlid,
    setScrollToMessageUlid: s.setScrollToMessageUlid,
    encryptionEnabled: s.encryptionEnabled,
    sessionSecurityState: s.sessionSecurityState,
    groupSecurityState: s.groupSecurityState,
    friendP2pStatus: s.friendP2pStatus,
    peerOnline: s.peerOnline,
    typingPeers: s.typingPeers,
    threadCounts: s.threadCounts,
    reactToMessage: s.reactToMessage,
    conversationMembers: s.conversationMembers,
  }));
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
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prependRestoreRef = useRef<{ previousHeight: number } | null>(null);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const activeKind = activeTab === 'friend' ? 'friend' : 'group';
  const activeConversation = activeUlid
    ? getIMConversations().find((conversation) => conversation.kind === activeKind && conversation.id === activeUlid)
    : undefined;
  const currentMessages = activeUlid ? getIMMessages(activeKind, activeUlid) : [];
  const mainTimelineMessages = currentMessages.filter((message) => !messageThreadRootUlid(message));
  const activeLocalState = activeUlid ? conversationLocalState[`${activeTab}:${activeUlid}`] : undefined;
  const activeBackground = activeLocalState?.background;
  const activeBackgroundImageUrl = useOssAttachmentUrl(activeLocalState?.backgroundImage || undefined);

  const currentName = activeConversation?.title || '';

  const subtitle = (() => {
    if (activeTab === 'friend') return '';
    return activeConversation ? t('chat.social.detail.membersCount', { count: activeConversation.memberCount ?? 0 }) : '';
  })();

  // Resolve the active peer DID for friend conversations. Used by the
  // header presence dot to decide whether the friend is reachable on
  // station, separate from whether our P2P channel happens to be up.
  const activePeerDid = activeTab === 'friend' ? activeConversation?.peerDid || null : null;

  // Peer-presence indicator. Truth source: Station's PresenceFlip
  // events carried by the unified `/events/stream` runtime.
  //
  // Unknown (peer DID never seen by the realtime stream) renders
  // *no* indicator rather than a grey dot — a grey dot would be hard
  // to distinguish from "offline" at a glance, and "we don't know yet"
  // is a real third state.
  const peerOnlineIndicator = (() => {
    if (activeTab !== 'friend' || !activePeerDid) return null;
    const members = activeUlid ? conversationMembers[activeUlid] ?? [] : [];
    const selfStation = members.find((member) => member.ptid === currentUserDid)?.actorHomeStationPeerId;
    const peerStation = members.find((member) => member.ptid === activePeerDid)?.actorHomeStationPeerId;
    const p2pStatus = activeUlid ? friendP2pStatus[activeUlid] : undefined;
    const tag = resolveChatPresenceTag({
      presenceKnown: activePeerDid in peerOnline,
      online: peerOnline[activePeerDid] ?? false,
      sameStation: Boolean(selfStation && peerStation && selfStation === peerStation),
      p2pState: p2pStatus?.state,
      transport: p2pStatus?.transport,
    });
    if (!tag) return null;
    const label = t(`chat.social.presence.${tag}`);
    const active = tag !== 'offline';
    const bg = active ? token.colorSuccessBg : token.colorFillSecondary;
    const color = active ? token.colorSuccess : token.colorTextQuaternary;
    return (
      <span
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 10,
          fontWeight: 500,
          color,
          background: bg,
          padding: '1px 6px',
          borderRadius: 4,
          lineHeight: '16px',
          flexShrink: 0,
        }}
      >
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
        {label}
      </span>
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
        const receiverDid = activeConversation?.peerDid || '';
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
    } catch (err) {
      log.error('chat', 'composer send failed', err);
      if (activeTab === 'group') {
        setInputValue(content);
        setReplyToUlid(replyRef ?? null);
      }
      presentError(err, {
        mode: 'toast',
        mapper: mapChatError,
        context: { operation: 'send' },
      });
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
    const peerDid = activePeerDid;
    if (!peerDid) return;
    try {
      await friendChatP2p.startCall(currentUserDid, peerDid, kind);
    } catch (err) {
      log.error('chat', 'startCall failed', err);
      toast.error(t('chat.social.call.mediaDenied'));
    }
  };

  const handleRecall = async (msg: ChatMessage) => {
    if (!activeUlid) return;
    try {
      if (activeKind === 'friend') {
        await recallFriendMessage(activeUlid, msg.ulid);
      } else {
        await recallGroupMessage(activeUlid, msg.ulid);
      }
    } catch (err) {
      log.error('chat', 'recall message failed', err);
      toast.error(t('chat.social.messageArea.recallFailed'));
    }
  };

  const confirmDeleteMessage = (target: ChatMessage) => {
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

  const handleStartEdit = (msg: ChatMessage) => {
    setEditingUlid(msg.ulid);
    setInputValue(msg.content);
    setReplyToUlid(null);
  };

  const handleForwardSelect = async (conv: { id: string; kind: string }) => {
    if (!forwardTarget) return;
    const content = forwardTarget.content;
    setForwardTarget(null);
    try {
      if (conv.kind === 'friend') {
        await sendFriendMessage(conv.id, '', content, undefined, undefined, undefined);
      } else {
        await sendGroupMessage(conv.id, content, undefined, undefined, undefined);
      }
      toast.success(t('chat.social.messageArea.forwardSent'));
    } catch (err) {
      log.error('chat', 'forward message failed', err);
      toast.error(t('chat.social.messageArea.forwardFailed'));
    }
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
    return collectChatThreadPreviewMessages({
      rootUlid,
      currentMessages,
      loadedThreadMessages: getIMThreadMessages(activeKind, activeUlid, rootUlid),
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
    activeBackgroundImageUrl || undefined,
  );
  const headerSubtitle = activeTab === 'friend'
    ? sessionSecurityState[activeUlid] === 'establishing'
      ? t('chat.social.encryption.establishing')
      : sessionSecurityState[activeUlid] === 'error'
        ? t('chat.social.encryption.unavailable')
      : peerIsTyping
      ? t('chat.social.messageArea.typing')
      : ''
    : groupSecurityState[activeUlid] === 'establishing'
      ? t('chat.social.encryption.establishing')
      : groupSecurityState[activeUlid] === 'crypto-desynced'
        ? t('chat.social.encryption.cryptoDesynced')
        : subtitle;
  const conversationEncrypted = activeTab === 'friend'
    ? sessionSecurityState[activeUlid] === 'ready'
    : groupSecurityState[activeUlid] === 'ready';

  return (
    <Flexbox
      flex={1}
      gap={0}
      style={{
        height: '100%',
        minWidth: 380,
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
                {encryptionEnabled && conversationEncrypted && (
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
        {mainTimelineMessages.length === 0 ? (
          <Flexbox align="center" justify="center" flex={1}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.messageArea.noMessages')} />
          </Flexbox>
        ) : (
          <ChatMessageTimeline
            activeConversationId={activeUlid}
            activeKind={activeKind}
            currentUserDid={currentUserDid}
            scrollContainerRef={scrollContainerRef}
            getSenderProfile={getIMSenderProfile}
            highlightedMessageUlid={highlightedMessageUlid}
            messages={mainTimelineMessages}
            onDelete={confirmDeleteMessage}
            onEdit={handleStartEdit}
            onForward={setForwardTarget}
            onOpenThread={openThread}
            onReact={(msg) => {
              if (!activeUlid) return;
              reactToMessage(activeUlid, msg.ulid, '👍');
            }}
            onRecall={handleRecall}
            onReply={(messageUlid) => {
              setEditingUlid(null);
              setReplyToUlid(messageUlid);
            }}
            onRetry={(message) => {
              if (activeTab !== 'friend' || !activeConversation?.peerDid) return;
              void retryFriendMessage(
                activeUlid,
                message.ulid,
                activeConversation.peerDid,
              ).catch((error) => {
                presentError(error, {
                  mode: 'toast',
                  mapper: mapChatError,
                  context: { operation: 'send' },
                });
              });
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

      <ForwardPickerModal
        open={!!forwardTarget}
        conversations={getIMConversations()}
        onCancel={() => setForwardTarget(null)}
        onSelect={handleForwardSelect}
      />
    </Flexbox>
  );
}
