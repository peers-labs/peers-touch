import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as PtButton,
  Empty as PtEmpty,
  Icon,
  IconButton as PtIconButton,
  Spin as PtSpin,
  TextField as PtTextField,
  Tooltip as PtTooltip,
} from '@peers-touch/ui';
import {
  Server,
  Lock, ShieldAlert, Bot, Pencil,
} from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import {
  directConversationDisplayName,
  type SocialMessage,
} from '../../store/socialProjection';
import { useCryptoStore } from '../../store/cryptoStore';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
  useActiveSocialChatStore,
} from './useActiveSocialChatStore';
import { SearchMessagesModal } from './SearchMessagesModal';
import { callP2p } from '../../modules/p2p/callP2p';
import { groupCallManager } from '../../modules/groupCall';
import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { newSendIntentId } from '../../utils/messagingSendIntent';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { presentError } from '../../services/errorPresenter';
import { ChatComposer, type ChatComposerDraft } from './ChatComposer';
import { TypingIndicator } from './message/TypingIndicator';
import {
  DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN,
} from './chatPresentationPolicy';
import {
  type ChatMessage,
  messageThreadRootUlid,
  replyPreviewForMessage,
} from './message/chatMessageModel';
import { ChatMessageTimeline } from './message/ChatMessageTimeline';
import {
  chatMessageTailScrollOptions,
  chatMessageTailScrollTop,
  isChatMessageTailPinned,
} from './message/chatMessageTimelinePolicy';
import {
  beginMessageReactionMutation,
  messageReactionProjectionMatches,
  type MessageReactionMutation,
} from './message/messageReactionState';
import { ChatDeleteConfirmOverlay } from './ChatDeleteConfirmOverlay';
import { ForwardPickerModal } from './ForwardPickerModal';
import { useOssAttachmentUrl } from '../shared/oss/useOssAttachmentUrl';
import type { DirectConversationOpenIntent } from './contactSelection';
import { resolveFederationStationName } from '../../store/federation';
import {
  resolveConversationStationChip,
  useLocalStationConnection,
} from '../../store/stationConnection';
import { notifyError, notifySuccess } from '../../ui/feedback';

const REACTION_PROJECTION_TIMEOUT_MS = 8_000;
const EMPTY_RAW_MESSAGES: SocialMessage[] = [];
const EMPTY_PROJECTED_MESSAGES: ChatMessage[] = [];

interface ChatMessageAreaProps {
  directOpenIntent: DirectConversationOpenIntent | null;
  /** True below the 720px narrow breakpoint; enables the header back control. */
  narrow?: boolean;
  /** Return from the single-pane conversation view to the catalog rail. */
  onNarrowBack?: () => void;
}

export function ChatMessageArea({
  directOpenIntent,
  narrow = false,
  onNarrowBack,
}: ChatMessageAreaProps) {
  const { t } = useTranslation('chat');
  const {
    activeTab, activeSessionUlid, activeGroupUlid,
    loadMessages, loadOlderMessages, retryMessage, sendFriendMessage, sendGroupMessage, toggleDetail,
    deleteMessage, recallFriendMessage, editFriendMessage,
    recallGroupMessage, editGroupMessage, openThread,
    conversationLocalState,
    conversationBackgroundPreviews,
    getIMConversations,
    getIMMessages,
    getIMSenderProfile,
    getIMThreadMessages,
    messageHasMore,
    messageLoadingMore,
    markFriendRead,
    markGroupRead,
    currentUserPtid,
    loadGroupMembers,
    scrollToMessageUlid,
    setScrollToMessageUlid,
    encryptionEnabled,
    groupSecurityState,
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
    retryMessage: s.retryMessage,
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
    conversationBackgroundPreviews: s.conversationBackgroundPreviews,
    getIMConversations: s.getIMConversations,
    getIMMessages: s.getIMMessages,
    getIMSenderProfile: s.getIMSenderProfile,
    getIMThreadMessages: s.getIMThreadMessages,
    messageHasMore: s.messageHasMore,
    messageLoadingMore: s.messageLoadingMore,
    markFriendRead: s.markFriendRead,
    markGroupRead: s.markGroupRead,
    currentUserPtid: s.currentUserPtid,
    loadGroupMembers: s.loadGroupMembers,
    scrollToMessageUlid: s.scrollToMessageUlid,
    setScrollToMessageUlid: s.setScrollToMessageUlid,
    encryptionEnabled: s.encryptionEnabled,
    groupSecurityState: s.groupSecurityState,
    peerOnline: s.peerOnline,
    typingPeers: s.typingPeers,
    threadCounts: s.threadCounts,
    reactions: s.reactions,
    pinnedMessages: s.pinnedMessages,
    reactToMessage: s.reactToMessage,
    pinMessage: s.pinMessage,
  }));
  const actorStationEntries = useActiveChatFederationSlice(
    (state) => state.actorStationEntries,
  );
  const groups = useActiveSocialChatSlice((s) => s.groups);
  const groupMembers = useActiveSocialChatSlice((s) => s.groupMembers);
  const renameGroupConversation = useActiveSocialChatSlice((s) => s.renameGroupConversation);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupNameSaving, setGroupNameSaving] = useState(false);
  const [groupNameHovered, setGroupNameHovered] = useState(false);
  // Composer text lives inside <ChatComposer /> (remounted per
  // conversation/edit target via React key); draftsRef only restores
  // the seed text when switching back. No message-list state depends on
  // keystrokes.
  const draftsRef = useRef<Record<string, string>>({});
  const [showSearch, setShowSearch] = useState(false);
  const [sending, setSending] = useState(false);
  const [replyToUlid, setReplyToUlid] = useState<string | null>(null);
  const [highlightedMessageUlid, setHighlightedMessageUlid] = useState<string | null>(null);
  // Tracks the conversation whose ephemeral UI state has been reset; drives
  // the render-phase adjustment below.
  const [resetConversationId, setResetConversationId] = useState<string | null>(null);
  // When set, the input field operates in "edit" mode: pressing
  // Send dispatches `editFriendMessage(activeUlid, editingUlid, …)`
  // instead of creating a new message. The banner above the input
  // shows the original content + a cancel handle.
  const [editingUlid, setEditingUlid] = useState<string | null>(null);
  // Mirror for the mount-stable draft-change callback: edited text must
  // never overwrite the new-message draft for a conversation. Synced in a
  // commit effect (render-phase ref writes are banned by react-hooks/refs).
  const editingUlidRef = useRef<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [deletingMessage, setDeletingMessage] = useState(false);
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [reactionMutations, setReactionMutations] = useState<Record<string, MessageReactionMutation>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tailPinnedRef = useRef(true);
  const tailReconcilePendingRef = useRef(false);
  const actionOverlayHostRef = useRef<HTMLDivElement>(null);
  const prependRestoreRef = useRef<{ previousHeight: number } | null>(null);
  const reactionRequestIdRef = useRef(0);
  const reactionsRef = useRef(reactions);
  const reactionTimeoutsRef = useRef<Map<string, number>>(new Map());
  // Commit-synced mirrors (see the sync effect after activeUlidRef) keep
  // timeline callbacks mount-stable so the memoized timeline and rows are not
  // invalidated by per-render closure identities.
  const reactionMutationsRef = useRef(reactionMutations);
  const currentUserPtidRef = useRef(currentUserPtid);
  const pinnedMessagesRef = useRef(pinnedMessages);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  // Bot direct conversations are Station-resident plaintext: no E2EE lock,
  // no calls, and a one-way composer. Classified from the peer actor's kind
  // (AGENT) in the profile projection. This hook MUST stay above every early
  // return — the empty/error panes render fewer children, not fewer hooks.
  const isAutomatedConversation = useSocialChatStore((s) => (
    activeTab === 'friend' && activeUlid ? s.isAutomatedConversation(activeUlid) : false
  ));
  const detailOpen = useSocialChatStore((s) => s.showDetail);
  const directSecurityState = useCryptoStore((state) => (
    activeUlid ? state.conversationSecurity[activeUlid]?.aggregateLevel ?? 'idle' : 'idle'
  ));
  const activeKind = activeTab === 'friend' ? 'friend' : 'group';
  const activeKindRef = useRef<'friend' | 'group'>(activeKind);
  const activeConversation = activeUlid
    ? getIMConversations().find((conversation) => conversation.kind === activeKind && conversation.id === activeUlid)
    : undefined;
  // Subscribe to the raw slice identity explicitly: the projected array is
  // read through a store getter, so its useMemo needs the raw identity to
  // invalidate when messages actually change.
  const activeRawMessages = useActiveSocialChatStore(
    (s) => (activeUlid ? s.messages[activeUlid] ?? EMPTY_RAW_MESSAGES : EMPTY_RAW_MESSAGES),
    Object.is,
  );
  const currentMessages = useMemo(() => {
    if (!activeUlid) return EMPTY_PROJECTED_MESSAGES;
    // activeRawMessages is the source-array identity: it changes exactly when
    // the store replaces this conversation's message slice, which is the
    // invalidation signal for the store-memoized projection below.
    return activeRawMessages === EMPTY_RAW_MESSAGES
      ? EMPTY_PROJECTED_MESSAGES
      : getIMMessages(activeKind, activeUlid);
  }, [activeKind, activeUlid, activeRawMessages, getIMMessages]);
  // Stable array identity: the timeline memo must not see a new roots array
  // on every parent re-render caused by unrelated store fan-out.
  const mainTimelineMessages = useMemo(
    () => currentMessages.filter((message) => !messageThreadRootUlid(message)),
    [currentMessages],
  );
  const pinnedMessageUlids = useMemo(
    () => new Set(Object.keys(pinnedMessages).filter((ulid) => Boolean(pinnedMessages[ulid]))),
    [pinnedMessages],
  );
  const projectThreadMessages = useCallback(
    (rootUlid: string) => (
      activeUlid ? getIMThreadMessages(activeKind, activeUlid, rootUlid) : []
    ),
    [activeKind, activeUlid, getIMThreadMessages],
  );
  const activeLocalState = activeUlid ? conversationLocalState[`${activeTab}:${activeUlid}`] : undefined;
  const newestAuthoritySequence = currentMessages.reduce(
    (maximum, message) => Math.max(maximum, message.eventSequence),
    0,
  );
  const activeBackground = activeLocalState?.background;
  const activeBackgroundImageUrl = useOssAttachmentUrl(activeLocalState?.backgroundImage || undefined);
  const activeBackgroundPreview = activeUlid
    ? conversationBackgroundPreviews[`${activeTab}:${activeUlid}`]
    : undefined;

  // Self-direct (Saved Messages): no peer presence or calls; the header
  // title resolves from the authenticated profile with a localized fallback.
  const isSelfDirect = activeTab === 'friend' && activeConversation?.selfDirect === true;
  const currentName = activeTab === 'group'
    ? (activeConversation?.title || '')
    : directConversationDisplayName(
      activeConversation ?? { title: '' },
      t('chat.social.contacts.savedMessages'),
      '',
    );
  const activeGroup = activeTab === 'group' && activeUlid
    ? groups.find((group) => group.ulid === activeUlid)
    : undefined;
  const activeGroupMembers = activeTab === 'group' && activeUlid
    ? (groupMembers[activeUlid] ?? [])
    : [];
  const canRenameGroup = activeTab === 'group'
    && Boolean(activeUlid)
    && (
      (activeGroup?.ownerPtid && activeGroup.ownerPtid === currentUserPtid)
      || (activeGroupMembers.find((member) => member.ptid === currentUserPtid)?.role ?? 0) >= 2
    );

  const startGroupRename = () => {
    setGroupNameDraft(activeConversation?.canonicalName || activeGroup?.name || currentName || '');
    setEditingGroupName(true);
  };
  const cancelGroupRename = () => {
    setEditingGroupName(false);
    setGroupNameDraft('');
  };
  const saveGroupRename = async () => {
    const next = groupNameDraft.trim();
    if (!activeUlid || !next || groupNameSaving) {
      cancelGroupRename();
      return;
    }
    const canonical = (activeConversation?.canonicalName || activeGroup?.name || currentName).trim();
    if (next === canonical) {
      cancelGroupRename();
      return;
    }
    setGroupNameSaving(true);
    try {
      await renameGroupConversation(activeUlid, next);
      setEditingGroupName(false);
      setGroupNameDraft('');
    } catch (error) {
      log.error('chat', 'header group rename failed', { groupUlid: activeUlid, error });
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
    } finally {
      setGroupNameSaving(false);
    }
  };

  const authorityStationId = activeConversation?.authorityStationId?.trim() || '';
  const authorityStationName = resolveFederationStationName({
    actorPtid: activeConversation?.peerPtid,
    stationPeerId: authorityStationId,
    actorStationEntries,
  });
  const localStation = useLocalStationConnection();
  const stationChip = activeConversation && !isAutomatedConversation
    ? resolveConversationStationChip({
      kind: activeTab === 'group' ? 'group' : 'friend',
      authorityStationId,
      authorityStationName,
      localStation,
    })
    : null;

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
  // Unknown is rendered explicitly instead of being collapsed into Offline.
  const peerOnlineIndicator = (() => {
    if (activeTab !== 'friend' || !activePeerDid) return null;
    const known = activePeerDid in peerOnline;
    const online = known ? peerOnline[activePeerDid] : null;
    const state = online === null ? 'unknown' : online ? 'online' : 'offline';
    const label = t(`chat.social.presence.${state}`);
    return (
      <span
        className="sc-presence-tag"
        data-chat-presence-tag={state}
        data-chat-presence-source="station"
        data-online={online ? '1' : '0'}
        aria-label={label}
      >
        <span className="sc-presence-tag__dot" />
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

  const scrollToMessageTail = useCallback(() => {
    bottomRef.current?.scrollIntoView(chatMessageTailScrollOptions());
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollTop = chatMessageTailScrollTop(container);
    }
  }, []);

  useLayoutEffect(() => {
    if (scrollToMessageUlid || highlightedMessageUlid) {
      tailReconcilePendingRef.current = false;
      tailPinnedRef.current = false;
      return;
    }
    if (prependRestoreRef.current && scrollContainerRef.current) {
      const { previousHeight } = prependRestoreRef.current;
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight - previousHeight;
      prependRestoreRef.current = null;
      return;
    }
    tailReconcilePendingRef.current = true;
    tailPinnedRef.current = true;
    scrollToMessageTail();
  }, [mainTimelineMessages.length, scrollToMessageTail]);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (tailPinnedRef.current) {
        scrollToMessageTail();
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollToMessageTail]);

  const handleTimelineMeasured = useCallback(() => {
    if (!tailReconcilePendingRef.current && !tailPinnedRef.current) return;
    scrollToMessageTail();
    tailReconcilePendingRef.current = false;
    tailPinnedRef.current = true;
  }, [scrollToMessageTail]);

  // Reset ephemeral reply / delete / rename UI when the active conversation
  // changes. The guarded render-phase update is React's documented "adjusting
  // state when a prop changes" pattern: it commits before paint without the
  // cascading render a synchronous effect update would cause.
  if (resetConversationId !== (activeUlid ?? null)) {
    setResetConversationId(activeUlid ?? null);
    setReplyToUlid(null);
    setDeleteTarget(null);
    setDeletingMessage(false);
    setEditingGroupName(false);
    setGroupNameDraft('');
    setGroupNameHovered(false);
  }

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
  // Wire contract: see docs/architecture/domains/chat/messaging/design.md
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

  // The composer owns text state; the parent only keeps a per-conversation
  // draft ref and emits throttled typing pulses. Everything here is
  // mount-stable so keystrokes never invalidate composer props or re-render
  // the message list.
  const activeUlidRef = useRef<string | null>(null);

  // Mirrors for mount-stable callbacks sync at commit time: event handlers
  // only observe them after paint, while render-phase ref writes are banned
  // by react-hooks/refs.
  useEffect(() => {
    activeUlidRef.current = activeUlid;
    activeKindRef.current = activeKind;
    editingUlidRef.current = editingUlid;
    currentUserPtidRef.current = currentUserPtid;
    reactionMutationsRef.current = reactionMutations;
    pinnedMessagesRef.current = pinnedMessages;
  });

  const fireTyping = useCallback((conversationId: string, typing: boolean) => {
    api.messagingTypingSend(conversationId, typing).catch((err) => {
      // Typing is best-effort; debug-level only so a temporarily
      // unreachable station does not spam the user-visible log.
      log.debug('chat', 'typing pulse failed', { typing, error: err });
    });
  }, []);

  const scheduleIdleStop = useCallback((conversationId: string) => {
    const ref = typingThrottleRef.current;
    if (ref.idleTimer != null) {
      window.clearTimeout(ref.idleTimer);
    }
    ref.idleTimer = window.setTimeout(() => {
      fireTyping(conversationId, false);
      ref.lastTrueAt = 0;
      ref.idleTimer = null;
    }, 4000);
  }, [fireTyping]);

  // Zero-arg seed for the keyed composer's lazy initializer: ref access
  // stays inside a callback body (never render scope) and the draft is read
  // exactly once per composer mount.
  const readActiveConversationDraft = useCallback(() => {
    const conversationId = activeUlidRef.current;
    return conversationId ? draftsRef.current[conversationId] ?? '' : '';
  }, []);

  const handleDraftChange = useCallback((value: string) => {
    const conversationId = activeUlidRef.current;
    if (!conversationId) return;
    // Edited-message text is not a new-message draft.
    if (!editingUlidRef.current) {
      draftsRef.current[conversationId] = value;
    }
    if (!value.trim()) {
      // Empty input — treat as "stopped". Cancel the idle timer
      // and emit `typing=false` only if we previously emitted true.
      const ref = typingThrottleRef.current;
      if (ref.idleTimer != null) {
        window.clearTimeout(ref.idleTimer);
        ref.idleTimer = null;
      }
      if (ref.lastTrueAt > 0) {
        fireTyping(conversationId, false);
        ref.lastTrueAt = 0;
      }
      return;
    }
    const now = Date.now();
    const ref = typingThrottleRef.current;
    if (now - ref.lastTrueAt > 3000) {
      fireTyping(conversationId, true);
      ref.lastTrueAt = now;
    }
    scheduleIdleStop(conversationId);
  }, [fireTyping, scheduleIdleStop]);

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
    if (!mainTimelineMessages.some((m) => m.ulid === scrollToMessageUlid)) return;
    tailPinnedRef.current = false;
    tailReconcilePendingRef.current = false;
    setHighlightedMessageUlid(scrollToMessageUlid);
  }, [scrollToMessageUlid, activeUlid, currentMessages, setScrollToMessageUlid]);

  useEffect(() => {
    if (!highlightedMessageUlid) return;
    const timer = window.setTimeout(() => setHighlightedMessageUlid(null), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageUlid]);

  useEffect(() => {
    if (!activeUlid || newestAuthoritySequence <= 0) return;
    const markRead = activeKind === 'friend' ? markFriendRead : markGroupRead;
    void markRead(activeUlid).catch((error) => {
      log.warn('chat', 'active conversation read cursor refresh failed', {
        conversationId: activeUlid,
        error,
      });
    });
  }, [
    activeKind,
    activeUlid,
    markFriendRead,
    markGroupRead,
    newestAuthoritySequence,
  ]);

  const handleScroll = async () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    if (!tailReconcilePendingRef.current) {
      tailPinnedRef.current = isChatMessageTailPinned(container);
    }
    if (!activeUlid) return;
    if (!messageHasMore[activeUlid] || messageLoadingMore[activeUlid]) return;
    if (container.scrollTop > 40) return;
    prependRestoreRef.current = { previousHeight: container.scrollHeight };
    try {
      await loadOlderMessages(activeUlid, activeTab === 'friend' ? 'friend' : 'group');
    } catch {
      prependRestoreRef.current = null;
    }
  };

  const stopTypingPulse = useCallback(() => {
    const conversationId = activeUlidRef.current;
    const ref = typingThrottleRef.current;
    if (ref.idleTimer != null) {
      window.clearTimeout(ref.idleTimer);
      ref.idleTimer = null;
    }
    if (ref.lastTrueAt > 0 && conversationId) {
      fireTyping(conversationId, false);
      ref.lastTrueAt = 0;
    }
  }, [fireTyping]);

  const handleSend = async (draft: ChatComposerDraft): Promise<boolean> => {
    if ((!draft.text && draft.attachments.length === 0) || !activeUlid) return false;
    const content = draft.text;
    const replyRef = replyToUlid || undefined;
    const editTarget = editingUlid;
    // The composer clears its own text after success; these resets only
    // flip reply/edit UI state. On failure the composer keeps its text
    // and reply target.
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
          notifyError(t('chat.social.messageArea.editFailed'));
          // Keep the editor open with its text on failure.
          setSending(false);
          return false;
        }
        setReplyToUlid(null);
        setEditingUlid(null);
        setSending(false);
        return true;
      }
      if (activeTab === 'friend') {
        const receiverPtid = activeConversation?.peerPtid || '';
        // MP-D33: one user send action keeps one send intent; the BFF
        // dedupes on (device, intent) and a lost IPC answer is reconciled
        // by status lookup rather than resend.
        const sendIntentId = newSendIntentId();
        await sendFriendMessage(
          activeUlid,
          receiverPtid,
          content,
          draft.messageType,
          replyRef,
          draft.attachments.length > 0 ? draft.attachments : undefined,
          undefined,
          sendIntentId,
        );
      } else {
        const sendIntentId = newSendIntentId();
        await sendGroupMessage(
          activeUlid,
          content,
          draft.messageType,
          replyRef,
          draft.attachments.length > 0 ? draft.attachments : undefined,
          undefined,
          sendIntentId,
        );
      }
      setReplyToUlid(null);
      setSending(false);
      return true;
    } catch (err) {
      log.error('chat', 'composer send failed', err);
      // All send failures surface through the shell-wide floating toast;
      // the conversation pane never swaps to an inline error state.
      presentError(err, {
        mode: 'toast',
        mapper: mapChatError,
        context: { operation: 'send' },
      });
      setSending(false);
      // Keep composer text + reply target; the composer does not clear
      // because onSend resolved false.
      return false;
    }
  };

  /** Voice / video calls gate on authoritative peer presence. The
   *  RTCPeerConnection is established on-demand by startCall when
   *  no connection exists, so pre-existing P2P state is not required. */
  const callsAvailable = (() => {
    if (activeTab !== 'friend' || !activeUlid || !currentUserPtid || !activePeerDid) return false;
    return peerOnline[activePeerDid] === true;
  })();
  const groupCallsAvailable = activeTab === 'group' && Boolean(activeUlid && currentUserPtid);
  const callAvailable = callsAvailable || groupCallsAvailable;

  const handleStartCall = async (kind: 'audio' | 'video') => {
    try {
      if (activeTab === 'group') {
        if (!groupCallsAvailable || !activeUlid) return;
        await groupCallManager.joinGroupCall(activeUlid, kind);
        return;
      }
      if (!callsAvailable || !currentUserPtid || !activePeerDid) return;
      await callP2p.startCall(currentUserPtid, activePeerDid, kind);
    } catch (err) {
      log.error('chat', 'startCall failed', err);
      notifyError(t('chat.social.call.mediaDenied'));
    }
  };

  const handleRecall = useCallback(async (msg: ChatMessage) => {
    const conversationId = activeUlidRef.current;
    if (!conversationId) return;
    try {
      if (activeKindRef.current === 'friend') {
        await recallFriendMessage(conversationId, msg.ulid);
      } else {
        await recallGroupMessage(conversationId, msg.ulid);
      }
    } catch (err) {
      log.error('chat', 'recall message failed', err);
      notifyError(t('chat.social.messageArea.recallFailed'));
    }
  }, [recallFriendMessage, recallGroupMessage, t]);

  const handleReaction = useCallback(async (message: ChatMessage, emoji: string) => {
    const conversationId = activeUlidRef.current;
    const actorPtid = currentUserPtidRef.current;
    if (!conversationId || !actorPtid) return;
    const currentMutation = reactionMutationsRef.current[message.ulid];
    const currentReactions = reactionsRef.current[message.ulid] ?? [];
    const currentMutationConverged = Boolean(
      currentMutation
      && currentMutation.phase !== 'pending'
      && messageReactionProjectionMatches(
        currentReactions,
        actorPtid,
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
      currentReactions,
      actorPtid,
      emoji,
      requestId,
    );
    const existingTimeout = reactionTimeoutsRef.current.get(message.ulid);
    if (existingTimeout !== undefined) window.clearTimeout(existingTimeout);
    reactionTimeoutsRef.current.delete(message.ulid);
    setReactionMutations(current => ({ ...current, [message.ulid]: mutation }));

    try {
      await reactToMessage(conversationId, message.ulid, emoji, mutation.remove);
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
          const actorPtid = currentUserPtidRef.current;
          if (
            actorPtid
            && messageReactionProjectionMatches(
              reactionsRef.current[message.ulid] ?? [],
              actorPtid,
              activeMutation,
            )
          ) {
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
        conversationId,
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
  }, [reactToMessage]);

  const retryReaction = useCallback((message: ChatMessage) => {
    const mutation = reactionMutationsRef.current[message.ulid];
    if (!mutation || mutation.phase !== 'error') return;
    void handleReaction(message, mutation.emoji);
  }, [handleReaction]);

  const retryFailedMessage = useCallback(async (message: ChatMessage) => {
    const conversationId = activeUlidRef.current;
    if (!conversationId) return;
    try {
      await retryMessage(conversationId, message.ulid, activeKindRef.current);
    } catch (error) {
      log.error('chat', 'message retry failed', {
        conversationId,
        messageId: message.ulid,
        error,
      });
      notifyError(t('chat.social.messageArea.retryFailed'));
    }
  }, [retryMessage, t]);

  const confirmDeleteMessage = useCallback((target: ChatMessage) => {
    if (!activeUlidRef.current) return;
    setDeleteTarget(target);
  }, []);

  const handlePin = useCallback((message: ChatMessage) => {
    const conversationId = activeUlidRef.current;
    if (!conversationId) return;
    pinMessage(conversationId, message.ulid, !pinnedMessagesRef.current[message.ulid]);
  }, [pinMessage]);

  const handleReply = useCallback((messageUlid: string) => {
    setEditingUlid(null);
    setReplyToUlid(messageUlid);
  }, []);

  const handleAnchorReached = useCallback(() => {
    setScrollToMessageUlid(null);
  }, [setScrollToMessageUlid]);

  const handleConfirmDelete = async () => {
    if (!activeUlid || !deleteTarget) return;
    setDeletingMessage(true);
    try {
      await deleteMessage(activeUlid, deleteTarget.ulid, activeKind);
      setDeleteTarget(null);
    } catch (e) {
      log.error('chat', 'deleteMessage failed', e);
      notifyError(t('chat.social.messageArea.deleteFailed'));
    } finally {
      setDeletingMessage(false);
    }
  };

  const handleStartEdit = useCallback((msg: ChatMessage) => {
    // The composer remounts (key includes editingUlid) and seeds from
    // editPreview — no controlled text state in the parent.
    setEditingUlid(msg.ulid);
    setReplyToUlid(null);
  }, []);

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
      notifySuccess(t('chat.social.messageArea.forwardSent'));
    } catch (err) {
      log.error('chat', 'forward message failed', err);
      notifyError(t('chat.social.messageArea.forwardFailed'));
    }
  };

  const cancelEdit = useCallback(() => {
    // Remount seeds the composer from the saved draft, not edit text.
    setEditingUlid(null);
  }, []);
  const cancelReply = useCallback(() => {
    setReplyToUlid(null);
  }, []);

  const replyingMsg = replyToUlid ? currentMessages.find((m) => m.ulid === replyToUlid) : null;
  const replyingPreview = replyPreviewForMessage(replyingMsg, {
    image: t('chat.social.messageArea.attachmentTypeImage'),
    video: t('chat.social.messageArea.attachmentTypeVideo'),
    audio: t('chat.social.messageArea.attachmentTypeAudio'),
    file: t('chat.social.messageArea.attachmentTypeFile'),
  });

  // Narrow single-pane swap: the back tile returns to the catalog rail.
  // CSS hides it above the 720px breakpoint (prototype sk-chat-back parity).
  const narrowBack = narrow ? (
    <PtIconButton
      actionId="chat-back-to-list"
      className="sc-chat-head__back"
      data-chat-narrow-back
      iconId="arrow-left"
      iconSize={18}
      emphasis="quiet"
      density="compact"
      label={t('chat.social.messageArea.backToList')}
      onActivate={() => onNarrowBack?.()}
    />
  ) : null;

  if (!activeUlid && directOpenIntent) {
    return (
      <div
        className="sc-conversation"
        data-chat-conversation-intent={directOpenIntent.peerPtid}
        data-chat-conversation-intent-state={directOpenIntent.phase}
      >
        <header className="sc-chat-head">
          {narrowBack}
          <div className="sc-chat-head-id">
            <div className="sc-chat-head-name">
              <strong>{directOpenIntent.displayName}</strong>
            </div>
          </div>
        </header>

        {/* The pane always stays open: creation failures are reported through
            the shell-wide floating toast, never as a content-replacing inline
            error. Re-open by selecting the contact again. */}
        <div className="sc-conversation__center" aria-live="polite">
          {directOpenIntent.phase === 'creating' ? (
            <PtSpin size="small" label={t('common.state.loading', { ns: 'common' })} />
          ) : (
            <PtEmpty
              icon={<Icon iconId="message-circle" size={36} className="sc-conversation-empty__icon" />}
              description={
                <span className="sc-conversation-empty__hint">
                  {t('chat.social.messageArea.noMessages')}
                </span>
              }
            />
          )}
        </div>

        <ChatComposer
          key="chat-composer:disabled"
          activeConversationId=""
          disabled
          editing={false}
          surfaceBackground="var(--pt-surface)"
          onBlurInput={stopTypingPulse}
          onCancelEdit={cancelEdit}
          onCancelReply={cancelReply}
          onSend={handleSend}
          replyPreview={replyingPreview}
          replyPreviewKey={replyToUlid}
          sending={false}
          capabilities={DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN}
        />
      </div>
    );
  }

  if (!activeUlid) {
    return (
      <div className="sc-conversation sc-conversation--empty">
        <PtEmpty
          icon={<Icon iconId="inbox" size={40} className="sc-conversation-empty__icon" />}
          description={
            <span className="sc-conversation-empty__hint">
              {t('chat.social.messageArea.selectConversation')}
            </span>
          }
        />
      </div>
    );
  }

  // Wallpaper is a full-bleed CSS layer keyed off data-chat-background on the
  // root pane (north-star ::before grammar). Only an uploaded image needs an
  // inline custom property; preset gradients live entirely in chat.css.
  const wallpaperImageUrl = activeBackgroundPreview || activeBackgroundImageUrl || undefined;
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
  const unsupportedCallReason = t('chat.social.call.unsupported');
  return (
    <div
      className="sc-conversation"
      data-chat-conversation-pane={activeUlid}
      data-session-security={activeTab === 'friend' ? directSecurityState : undefined}
      data-group-security={activeTab === 'group' ? groupSecurityState[activeUlid] || 'unknown' : undefined}
      data-chat-typing={peerIsTyping ? 'active' : 'inactive'}
      data-chat-background={activeBackground || 'default'}
      data-chat-background-image={activeLocalState?.backgroundImage || ''}
      data-chat-background-preview={activeBackgroundPreview ? 'local' : 'durable'}
      style={wallpaperImageUrl
        ? { '--sc-chat-bg-image': `url("${wallpaperImageUrl}")` } as CSSProperties
        : undefined}
    >
      <SearchMessagesModal
        open={showSearch}
        onClose={() => setShowSearch(false)}
        initialScope={activeTab === 'friend' ? 'friend' : 'group'}
        conversationId={activeUlid ?? undefined}
      />

      <header className="sc-chat-head">
        {narrowBack}
        <div className="sc-chat-head-id">
          <div className="sc-chat-head-name">
            {activeTab === 'group' && editingGroupName ? (
              <PtTextField
                autoFocus
                value={groupNameDraft}
                disabled={groupNameSaving}
                aria-label={t('chat.social.detail.groupName')}
                onValueChange={setGroupNameDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveGroupRename();
                  if (event.key === 'Escape') cancelGroupRename();
                }}
                onBlur={() => void saveGroupRename()}
                className="sc-chat-head__rename"
                data-chat-group-name-editor
              />
            ) : (
              <div
                className="sc-chat-head__title"
                onMouseEnter={() => setGroupNameHovered(true)}
                onMouseLeave={() => setGroupNameHovered(false)}
              >
                <strong>{currentName}</strong>
                {canRenameGroup && (
                  <PtTooltip label={t('chat.social.detail.editGroupName')}>
                    <PtButton
                      actionId="chat-rename-group"
                      className="sc-chat-head__rename-btn"
                      data-chat-group-rename
                      emphasis="quiet"
                      density="compact"
                      leading={<Pencil size={12} />}
                      aria-label={t('chat.social.detail.editGroupName')}
                      onActivate={startGroupRename}
                      data-hovered={groupNameHovered || undefined}
                    />
                  </PtTooltip>
                )}
              </div>
            )}
            {!isAutomatedConversation && !isSelfDirect && peerOnlineIndicator}
            {isAutomatedConversation ? (
              <PtTooltip label={t('chat.automation.stationManagedTip', {
                defaultValue: 'Automated service · Station-resident, not end-to-end encrypted',
              })}>
                <ShieldAlert size={13} className="sc-chat-head__shield" aria-label={t('chat.automation.stationManaged')} />
              </PtTooltip>
            ) : (
              encryptionEnabled && conversationEncrypted && (
                <PtTooltip label={t('chat.social.encryption.enabled')}>
                  <Lock size={13} className="sc-chat-head__lock" />
                </PtTooltip>
              )
            )}
            {/* Station chip: local groups bind to the user's own Station
                with live realtime connectivity; federated chats show the
                peer authority name only when known. Unknown renders
                nothing — never a fake "unavailable" badge. Automated
                conversations already express Station residency via the
                amber shield + subtitle. */}
            {stationChip && (
              <span
                className="sc-chat-head__station"
                data-chat-station={activeTab === 'group' ? 'local' : 'authority'}
                data-chat-station-id={stationChip.stationId}
                data-chat-station-name={stationChip.label}
                data-chat-station-state={stationChip.state}
                title={stationChip.state === 'connected'
                  ? t('chat.social.detail.stationConnected', { station: stationChip.label })
                  : stationChip.state === 'disconnected'
                    ? t('chat.social.detail.stationDisconnected', { station: stationChip.label })
                    : stationChip.label}
              >
                {stationChip.state === 'neutral' ? (
                  <Server aria-hidden="true" size={11} style={{ flexShrink: 0 }} />
                ) : (
                  <span aria-hidden="true" className="sc-chat-head__station-dot" />
                )}
                <span className="sc-chat-head__station-label">
                  {activeTab === 'group'
                    ? stationChip.label
                    : `${t('chat.social.findPeople.scopeStation')} · ${stationChip.label}`}
                </span>
              </span>
            )}
            {(headerSubtitle || isAutomatedConversation) && (
              <span className="sc-chat-head__subtitle">
                {isAutomatedConversation
                  ? t('chat.automation.stationManaged', { defaultValue: 'Automated service · Station resident' })
                  : headerSubtitle}
              </span>
            )}
          </div>
        </div>
        <div className="sc-chat-head-actions">
          {/* Automated conversations are one-way publishing channels and
              self-direct has no peer: no calls. */}
          {!isAutomatedConversation && !isSelfDirect && (
            <PtTooltip
              label={callAvailable ? t('chat.social.call.startAudio') : unsupportedCallReason}
            >
              <PtIconButton
                actionId="chat-call-audio"
                className="sc-head-action"
                iconId="phone"
                iconSize={19}
                emphasis="quiet"
                label={callAvailable ? t('chat.social.call.startAudio') : unsupportedCallReason}
                availability={callAvailable ? undefined : { kind: 'disabled', reason: unsupportedCallReason }}
                onClick={() => handleStartCall('audio')}
              />
            </PtTooltip>
          )}
          {!isAutomatedConversation && !isSelfDirect && (
            <PtTooltip
              label={callAvailable ? t('chat.social.call.startVideo') : unsupportedCallReason}
            >
              <PtIconButton
                actionId="chat-call-video"
                className="sc-head-action"
                iconId="video"
                iconSize={19}
                emphasis="quiet"
                label={callAvailable ? t('chat.social.call.startVideo') : unsupportedCallReason}
                availability={callAvailable ? undefined : { kind: 'disabled', reason: unsupportedCallReason }}
                onClick={() => handleStartCall('video')}
              />
            </PtTooltip>
          )}
          <PtIconButton
            actionId="chat-open-detail"
            data-chat-detail-toggle
            className="sc-head-action"
            iconId="info"
            iconSize={19}
            emphasis="quiet"
            label={t('chat.social.detail.title')}
            aria-expanded={detailOpen}
            onClick={toggleDetail}
          />
        </div>
      </header>

      <div
        className="chat-message-scroll sc-conversation__stream"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        {activeUlid && messageLoadingMore[activeUlid] && (
          <div className="sc-conversation__loading-more">
            <PtSpin size="small" />
          </div>
        )}
        {mainTimelineMessages.length === 0 ? (
          <div className="sc-conversation__center">
            <PtEmpty
              icon={<Icon iconId="message-circle" size={36} className="sc-conversation-empty__icon" />}
              description={
                <span className="sc-conversation-empty__hint">
                  {isSelfDirect
                    ? t('chat.social.contacts.savedMessagesHint')
                    : t('chat.social.messageArea.noMessages')}
                </span>
              }
            />
          </div>
        ) : (
          <ChatMessageTimeline
            actionOverlayHostRef={actionOverlayHostRef}
            activeConversationId={activeUlid}
            activeKind={activeKind}
            currentUserPtid={currentUserPtid}
            scrollContainerRef={scrollContainerRef}
            getSenderProfile={getIMSenderProfile}
            highlightedMessageUlid={highlightedMessageUlid}
            scrollToMessageUlid={scrollToMessageUlid}
            onAnchorReached={handleAnchorReached}
            conversationMessages={currentMessages}
            messages={mainTimelineMessages}
            onTimelineMeasured={handleTimelineMeasured}
            onDelete={confirmDeleteMessage}
            onEdit={handleStartEdit}
            onForward={setForwardTarget}
            onOpenThread={openThread}
            onPin={handlePin}
            onReact={handleReaction}
            onRecall={handleRecall}
            onReply={handleReply}
            onRetryMessage={retryFailedMessage}
            onRetryReaction={retryReaction}
            pinnedMessageUlids={pinnedMessageUlids}
            projectThreadMessages={projectThreadMessages}
            reactions={reactions}
            reactionMutations={reactionMutations}
            threadCounts={threadCounts}
          />
        )}
        {peerIsTyping && !isAutomatedConversation && (
          <TypingIndicator
            kind={activeKind}
            avatarUrl={activeConversation?.avatar}
            name={currentName}
          />
        )}
        <div
          ref={bottomRef}
          className="sc-conversation__bottom-sentinel"
          data-chat-message-bottom-sentinel
        />
      </div>

      {isAutomatedConversation ? (
        <div
          className="sc-conversation__bot-bar"
          data-bot-oneway-composer="true"
        >
          <Bot size={14} />
          <span>
            {t('chat.automation.oneWayComposer', {
              defaultValue: 'One-way publishing channel — replies are not supported',
            })}
          </span>
        </div>
      ) : (
      <ChatComposer
        key={`chat-composer:${activeUlid}:${editingUlid ?? 'new'}`}
        activeConversationId={activeUlid}
        disabled={!activeUlid}
        editing={Boolean(editingUlid)}
        initialValue={editingUlid
          ? currentMessages.find((m) => m.ulid === editingUlid)?.content ?? ''
          : undefined}
        initialDraft={readActiveConversationDraft}
        onDraftChange={handleDraftChange}
        onBlurInput={stopTypingPulse}
        onCancelEdit={cancelEdit}
        onCancelReply={cancelReply}
        onSend={handleSend}
        replyPreview={replyingPreview}
        replyPreviewKey={replyToUlid}
        editPreview={editingUlid ? currentMessages.find((m) => m.ulid === editingUlid)?.content || '' : undefined}
        sending={sending}
        capabilities={DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN}
      />
      )}

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
        className="sc-conversation__overlay-host"
      />
    </div>
  );
}
