import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tooltip, toast } from '@lobehub/ui';
import { Empty, Spin, theme, Typography } from 'antd';
import {
  Inbox, Phone, RadioTower, RefreshCw, Video, MoreHorizontal,
  Lock,
} from 'lucide-react';
import {
  CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN,
  collectChatThreadPreviewMessages,
} from '@peers-touch/client-chat-core';
import {
  socialThreadKey,
} from '../../store/socialChat';
import { useCryptoStore } from '../../store/cryptoStore';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';
import { SearchMessagesModal } from './SearchMessagesModal';
import { callP2p } from '../../modules/p2p/callP2p';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { presentError, type PresentedError } from '../../services/errorPresenter';
import { ChatComposer, type ChatComposerDraft } from './ChatComposer';
import {
  type ChatMessage,
  messageThreadRootUlid,
  messageTimestampMs,
  replyPreviewForMessage,
} from './message/chatMessageModel';
import { ChatMessageTimeline } from './message/ChatMessageTimeline';
import { chatMessageTailScrollOptions } from './message/chatMessageTimelinePolicy';
import {
  loadedThreadReplyCount,
  loadedThreadReplyIds,
} from './message/chatMessageThreadStats';
import {
  beginMessageReactionMutation,
  messageReactionProjectionMatches,
  reactionMutationForProjection,
  visibleMessageReactions,
  type MessageReactionMutation,
} from './message/messageReactionState';
import { ChatDeleteConfirmOverlay } from './ChatDeleteConfirmOverlay';
import { ForwardPickerModal } from './ForwardPickerModal';
import { PresentedErrorAlert } from '../common/PresentedErrorAlert';
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';
import type { DirectConversationOpenIntent } from './contactSelection';

const { Text } = Typography;
const REACTION_PROJECTION_TIMEOUT_MS = 8_000;

interface ChatMessageAreaProps {
  directOpenIntent: DirectConversationOpenIntent | null;
  onRetryDirectOpen: () => void;
}

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

export function ChatMessageArea({
  directOpenIntent,
  onRetryDirectOpen,
}: ChatMessageAreaProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    loadMessages, loadOlderMessages, sendFriendMessage, sendGroupMessage, toggleDetail,
    deleteMessage, recallFriendMessage, editFriendMessage,
    recallGroupMessage, editGroupMessage, openThread,
    conversationLocalState,
    getIMConversations,
    getIMMessages,
    getIMThreadMessages,
    getIMSenderProfile,
    messageHasMore,
    messageLoadingMore,
    currentUserPtid,
    loadGroupMembers,
    scrollToMessageUlid,
    setScrollToMessageUlid,
    encryptionEnabled,
    groupSecurityState,
    friendP2pStatus,
    peerOnline,
    typingPeers,
    threadCounts,
    reactions,
    pinnedMessages,
    reactToMessage,
    pinMessage,
  } = useActiveSocialChatSlice((s) => ({
    activeTab: s.activeTab,
    activeSessionUlid: s.activeSessionUlid,
    activeGroupUlid: s.activeGroupUlid,
    loadMessages: s.loadMessages,
    loadOlderMessages: s.loadOlderMessages,
    sendFriendMessage: s.sendFriendMessage,
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
    currentUserPtid: s.currentUserPtid,
    loadGroupMembers: s.loadGroupMembers,
    scrollToMessageUlid: s.scrollToMessageUlid,
    setScrollToMessageUlid: s.setScrollToMessageUlid,
    encryptionEnabled: s.encryptionEnabled,
    groupSecurityState: s.groupSecurityState,
    friendP2pStatus: s.friendP2pStatus,
    peerOnline: s.peerOnline,
    typingPeers: s.typingPeers,
    threadCounts: s.threadCounts,
    reactions: s.reactions,
    pinnedMessages: s.pinnedMessages,
    reactToMessage: s.reactToMessage,
    pinMessage: s.pinMessage,
  }));
  const [inputValue, setInputValue] = useState('');
  const draftsRef = useRef<Record<string, string>>({});
  const prevActiveRef = useRef<string | null>(null);
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
  const [composerError, setComposerError] = useState<PresentedError | null>(null);
  const [reactionMutations, setReactionMutations] = useState<Record<string, MessageReactionMutation>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const actionOverlayHostRef = useRef<HTMLDivElement>(null);
  const prependRestoreRef = useRef<{ previousHeight: number } | null>(null);
  const reactionRequestIdRef = useRef(0);
  const reactionsRef = useRef(reactions);
  const reactionTimeoutsRef = useRef<Map<string, number>>(new Map());

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const directSecurityState = useCryptoStore((state) => (
    activeUlid ? state.conversationSecurity[activeUlid]?.aggregateLevel ?? 'idle' : 'idle'
  ));
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
  const authorityStationId = activeConversation?.authorityStationId?.trim() || '';

  const subtitle = (() => {
    if (activeTab === 'friend') return '';
    return activeConversation ? t('chat.social.detail.membersCount', { count: activeConversation.memberCount ?? 0 }) : '';
  })();

  // Resolve the active peer DID for friend conversations. Used by the
  // header presence dot to decide whether the friend is reachable on
  // station, separate from whether our P2P channel happens to be up.
  const activePeerDid = activeTab === 'friend' ? activeConversation?.peerPtid || null : null;

  // Peer-presence indicator. Truth source: Station's PresenceFlip
  // events carried by the unified `/events/stream` runtime.
  //
  // Unknown (peer DID never seen by the realtime stream) renders
  // *no* indicator rather than a grey dot — a grey dot would be hard
  // to distinguish from "offline" at a glance, and "we don't know yet"
  // is a real third state.
  const peerOnlineIndicator = (() => {
    if (activeTab !== 'friend' || !activePeerDid) return null;
    const known = activePeerDid in peerOnline;
    if (!known) return null;
    const online = peerOnline[activePeerDid];
    const label = online ? 'Online' : 'Offline';
    const bg = online ? token.colorSuccessBg : token.colorFillSecondary;
    const color = online ? token.colorSuccess : token.colorTextQuaternary;
    return (
      <span
        data-chat-presence-tag={label}
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

  useLayoutEffect(() => {
    if (prependRestoreRef.current && scrollContainerRef.current) {
      const { previousHeight } = prependRestoreRef.current;
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight - previousHeight;
      prependRestoreRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView(chatMessageTailScrollOptions());
  }, [mainTimelineMessages.length]);

  useEffect(() => {
    const prev = prevActiveRef.current;
    if (prev) draftsRef.current[prev] = inputValue;
    setInputValue(activeUlid ? (draftsRef.current[activeUlid] ?? '') : '');
    prevActiveRef.current = activeUlid ?? null;
    setReplyToUlid(null);
    setDeleteTarget(null);
    setDeletingMessage(false);
    setComposerError(null);
  }, [activeUlid]);

  useEffect(() => {
    const openSearch = () => setShowSearch(true);
    window.addEventListener('peers-chat:open-search', openSearch);
    return () => window.removeEventListener('peers-chat:open-search', openSearch);
  }, []);

  useEffect(() => {
    reactionsRef.current = reactions;
  }, [reactions]);

  useEffect(() => () => {
    for (const timeout of reactionTimeoutsRef.current.values()) {
      window.clearTimeout(timeout);
    }
    reactionTimeoutsRef.current.clear();
  }, []);

  // ---- Typing-state outbound pulses --------------------------------
  //
  // Wire contract: see docs/architecture/messaging-platform/design.md
  // §8.2. The sender emits *at most* one `typing=true`
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
  // Station Messaging validates active membership and fans the
  // ephemeral pulse out to all other active conversation members.
  const typingThrottleRef = useRef<{ lastTrueAt: number; idleTimer: number | null }>({
    lastTrueAt: 0,
    idleTimer: null,
  });

  const fireTyping = (typing: boolean) => {
    if (!activeUlid) return;
    api.messagingTypingSend(activeUlid, typing).catch((err) => {
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
    if (!activeUlid) return;
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
  // receivers' bubbles clear immediately rather than waiting for the
  // GC sweep TTL. We deliberately use a ref-captured "last
  // conversation" rather than the closure-captured value below
  // because by the time this teardown runs the activeUlid has
  // already changed.
  const lastTypingConversationRef = useRef<string | null>(null);
  useEffect(() => {
    lastTypingConversationRef.current = activeUlid;
    return () => {
      const ref = typingThrottleRef.current;
      if (ref.idleTimer != null) {
        window.clearTimeout(ref.idleTimer);
        ref.idleTimer = null;
      }
      if (ref.lastTrueAt > 0 && lastTypingConversationRef.current) {
        api.messagingTypingSend(lastTypingConversationRef.current, false).catch(() => {});
        ref.lastTrueAt = 0;
      }
    };
  }, [activeUlid]);

  // Receiver-side: derive whether the peer is composing in the
  // currently-active conversation. We also expose a list of typing
  // names for group chats once the group fan-out lands; for friend
  // chats the entry is keyed on the peer's actor_ptid.
  const peerIsTyping = (() => {
    if (!activeUlid) return false;
    const map = typingPeers[activeUlid];
    if (!map) return false;
    if (activeTab === 'friend') {
      if (!activePeerDid) return false;
      const e = map[activePeerDid];
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
    setComposerError(null);
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
        const receiverPtid = activeConversation?.peerPtid || '';
        await sendFriendMessage(
          activeUlid,
          receiverPtid,
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
      setInputValue(content);
      setReplyToUlid(replyRef ?? null);
      const presentedError = presentError(err, {
        mode: 'toast',
        mapper: mapChatError,
        context: { operation: 'send' },
      });
      setComposerError(presentedError);
    } finally {
      setSending(false);
    }
  };

  /** Voice / video calls are only meaningful for friend chats with
   *  an active RTCPeerConnection. Text chat uses the realtime SSE
   *  stream; WebRTC readiness gates calls only. */
  const callsAvailable = (() => {
    if (activeTab !== 'friend' || !activeUlid || !currentUserPtid) return false;
    const s = friendP2pStatus[activeUlid];
    return !!s && s.state === 'connected';
  })();

  const handleStartCall = async (kind: 'audio' | 'video') => {
    if (!callsAvailable || !currentUserPtid) return;
    const peerPtid = activePeerDid;
    if (!peerPtid) return;
    try {
      await callP2p.startCall(currentUserPtid, peerPtid, kind);
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

  const handleReaction = async (message: ChatMessage, emoji: string) => {
    if (!activeUlid || !currentUserPtid) return;
    const currentMutation = reactionMutations[message.ulid];
    const currentMutationConverged = Boolean(
      currentMutation
      && currentMutation.phase !== 'pending'
      && messageReactionProjectionMatches(
        reactions[message.ulid] ?? [],
        currentUserPtid,
        currentMutation,
      ),
    );
    if (
      currentMutation
      && currentMutation.phase !== 'error'
      && !currentMutationConverged
    ) {
      return;
    }

    const requestId = ++reactionRequestIdRef.current;
    const mutation = beginMessageReactionMutation(
      reactions[message.ulid] ?? [],
      currentUserPtid,
      emoji,
      requestId,
    );
    const existingTimeout = reactionTimeoutsRef.current.get(message.ulid);
    if (existingTimeout !== undefined) window.clearTimeout(existingTimeout);
    reactionTimeoutsRef.current.delete(message.ulid);
    setReactionMutations(current => ({ ...current, [message.ulid]: mutation }));

    try {
      await reactToMessage(activeUlid, message.ulid, emoji, mutation.remove);
      setReactionMutations((current) => {
        const activeMutation = current[message.ulid];
        if (!activeMutation || activeMutation.requestId !== requestId) return current;
        return {
          ...current,
          [message.ulid]: {
            ...activeMutation,
            phase: 'awaiting-projection',
          },
        };
      });
      const timeout = window.setTimeout(() => {
        setReactionMutations((current) => {
          const activeMutation = current[message.ulid];
          if (
            !activeMutation
            || activeMutation.requestId !== requestId
            || activeMutation.phase !== 'awaiting-projection'
          ) {
            return current;
          }
          if (messageReactionProjectionMatches(
            reactionsRef.current[message.ulid] ?? [],
            currentUserPtid,
            activeMutation,
          )) {
            const next = { ...current };
            delete next[message.ulid];
            return next;
          }
          return {
            ...current,
            [message.ulid]: {
              ...activeMutation,
              phase: 'error',
            },
          };
        });
        reactionTimeoutsRef.current.delete(message.ulid);
      }, REACTION_PROJECTION_TIMEOUT_MS);
      reactionTimeoutsRef.current.set(message.ulid, timeout);
    } catch (error) {
      log.error('chat', 'message reaction failed', {
        conversationId: activeUlid,
        messageId: message.ulid,
        error,
      });
      setReactionMutations((current) => {
        const activeMutation = current[message.ulid];
        if (!activeMutation || activeMutation.requestId !== requestId) return current;
        return {
          ...current,
          [message.ulid]: {
            ...activeMutation,
            phase: 'error',
          },
        };
      });
    }
  };

  const retryReaction = (message: ChatMessage) => {
    const mutation = reactionMutations[message.ulid];
    if (!mutation || mutation.phase !== 'error') return;
    void handleReaction(message, mutation.emoji);
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

  if (!activeUlid && directOpenIntent) {
    return (
      <Flexbox
        data-chat-conversation-intent={directOpenIntent.peerPtid}
        data-chat-conversation-intent-state={directOpenIntent.phase}
        flex={1}
        style={{
          height: '100%',
          minWidth: 0,
          background: token.colorBgLayout,
        }}
      >
        <Flexbox
          horizontal
          align="center"
          style={{
            height: 64,
            padding: '0 18px',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            flexShrink: 0,
          }}
        >
          <Text strong style={{ fontSize: 14 }}>
            {directOpenIntent.displayName}
          </Text>
        </Flexbox>

        <Flexbox
          flex={1}
          align="center"
          justify="center"
          gap={12}
          aria-live="polite"
          style={{ padding: 24 }}
        >
          {directOpenIntent.phase === 'creating' ? (
            <>
              <Spin size="small" />
              <Text type="secondary">
                {t('common.state.loading', { ns: 'common' })}
              </Text>
            </>
          ) : (
            <Flexbox
              data-chat-conversation-intent-error={directOpenIntent.error.code}
              gap={10}
              style={{ width: 'min(420px, 100%)' }}
            >
              <PresentedErrorAlert error={directOpenIntent.error} />
              {directOpenIntent.error.recoverable && (
                <Button
                  data-chat-conversation-intent-retry
                  icon={<RefreshCw size={14} />}
                  onClick={onRetryDirectOpen}
                >
                  {t('chat.message.action.retry')}
                </Button>
              )}
            </Flexbox>
          )}
        </Flexbox>

        <ChatComposer
          activeConversationId=""
          disabled
          editing={false}
          surfaceBackground={token.colorBgContainer}
          value={inputValue}
          onChange={handleInputChange}
          onBlurInput={stopTypingPulse}
          onCancelEdit={cancelEdit}
          onCancelReply={() => setReplyToUlid(null)}
          onSend={handleSend}
          replyPreview={replyingPreview}
          replyPreviewKey={replyToUlid}
          sending={false}
          capabilities={CHAT_COMPOSER_CAPABILITIES_DESKTOP_MAIN}
        />
      </Flexbox>
    );
  }

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
    ? directSecurityState === 'establishing'
      ? t('chat.social.encryption.establishing')
      : peerIsTyping
      ? t('chat.social.messageArea.typing')
      : ''
    : groupSecurityState[activeUlid] === 'establishing'
      ? t('chat.social.encryption.establishing')
      : groupSecurityState[activeUlid] === 'crypto-desynced'
        ? t('chat.social.encryption.cryptoDesynced')
        : subtitle;
  const conversationEncrypted = activeTab === 'friend'
    ? directSecurityState === 'ready'
    : groupSecurityState[activeUlid] === 'ready';

  return (
    <Flexbox
      data-chat-conversation-pane={activeUlid}
      data-session-security={activeTab === 'friend' ? directSecurityState : undefined}
      data-group-security={activeTab === 'group' ? groupSecurityState[activeUlid] || 'unknown' : undefined}
      data-chat-typing={peerIsTyping ? 'active' : 'inactive'}
      data-chat-background={activeBackground || 'default'}
      data-chat-background-image={activeLocalState?.backgroundImage || ''}
      flex={1}
      gap={0}
      style={{
        height: '100%',
        minWidth: 0,
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
                <span
                  data-chat-station="authority"
                  data-chat-station-id={authorityStationId}
                  data-chat-station-state={authorityStationId ? 'available' : 'unavailable'}
                  title={authorityStationId || t('chat.social.detail.authorityStationUnavailable')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    minWidth: 0,
                    maxWidth: 'min(180px, 24vw)',
                    padding: '1px 6px',
                    borderRadius: 999,
                    background: token.colorFillQuaternary,
                    color: token.colorTextTertiary,
                    fontSize: 10,
                    lineHeight: '16px',
                    flexShrink: 1,
                  }}
                >
                  <RadioTower aria-hidden="true" size={11} style={{ flexShrink: 0 }} />
                  <span
                    style={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {authorityStationId
                      ? `${t('chat.social.findPeople.scopeStation')} · ${authorityStationId}`
                      : t('chat.social.detail.authorityStationUnavailable')}
                  </span>
                </span>
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
          <Button
            data-chat-detail-toggle
            type="text"
            icon={<MoreHorizontal size={16} />}
            style={{ width: 32, height: 32, borderRadius: 10 }}
            onClick={toggleDetail}
          />
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
            actionOverlayHostRef={actionOverlayHostRef}
            activeConversationId={activeUlid}
            activeKind={activeKind}
            currentUserPtid={currentUserPtid}
            scrollContainerRef={scrollContainerRef}
            getSenderProfile={getIMSenderProfile}
            highlightedMessageUlid={highlightedMessageUlid}
            isPinned={(message) => Boolean(pinnedMessages[message.ulid])}
            messages={mainTimelineMessages}
            onDelete={confirmDeleteMessage}
            onEdit={handleStartEdit}
            onForward={setForwardTarget}
            onOpenThread={openThread}
            onPin={(msg) => {
              if (!activeUlid) return;
              pinMessage(activeUlid, msg.ulid, Boolean(pinnedMessages[msg.ulid]));
            }}
            onReact={(message, emoji) => {
              void handleReaction(message, emoji);
            }}
            onRecall={handleRecall}
            onReply={(messageUlid) => {
              setEditingUlid(null);
              setReplyToUlid(messageUlid);
            }}
            onRetryReaction={retryReaction}
            reactionMutationFor={(message) => {
              const mutation = reactionMutationForProjection(
                reactions[message.ulid] ?? [],
                currentUserPtid,
                reactionMutations[message.ulid],
              );
              return mutation
                ? { emoji: mutation.emoji, phase: mutation.phase }
                : undefined;
            }}
            resolveReactions={(message) => [
              ...visibleMessageReactions(
                reactions[message.ulid] ?? [],
                reactionMutationForProjection(
                  reactions[message.ulid] ?? [],
                  currentUserPtid,
                  reactionMutations[message.ulid],
                ),
              ),
            ]}
            resolveThreadStats={(message) => {
              const threadKey = socialThreadKey(activeKind, activeUlid, message.ulid);
              const threadSummary = threadCounts[threadKey];
              const replyIds = loadedThreadReplyIds(currentMessages, message.ulid);
              return {
                replyCount: loadedThreadReplyCount(currentMessages, message.ulid),
                replyIds,
                previewMessages: threadPreviewMessagesForRoot(message.ulid),
                unreadCount: threadSummary?.unreadCount ?? 0,
              };
            }}
          />
        )}
        <div
          ref={bottomRef}
          data-chat-message-bottom-sentinel
          style={{ flex: '0 0 1px', height: 1 }}
        />
      </Flexbox>

      {composerError && (
        <Flexbox
          data-chat-error={composerError.code || composerError.severity}
          style={{ padding: '0 16px 12px', background: conversationSurfaceBackground }}
        >
          <PresentedErrorAlert error={composerError} onClose={() => setComposerError(null)} />
        </Flexbox>
      )}

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

      <div
        ref={actionOverlayHostRef}
        data-message-action-overlay-host
        aria-hidden={!activeUlid}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 20,
        }}
      />
    </Flexbox>
  );
}
