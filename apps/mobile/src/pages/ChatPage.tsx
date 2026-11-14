/**
 * ChatPage.tsx — Route-scoped controller for the chat tab.
 *
 * W6A contract: this page owns narrow store subscriptions, route-local state,
 * attachment I/O, and typed command dispatch. Render-only page, section, and
 * overlay units live under ./chat. All visible text uses i18n.
 *
 * Virtualization: conversation and message lists use bounded windowing
 * to preserve scroll anchors and keep DOM node count stable.
 */

import { Component, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Icon, Spin, Text } from '@peers-touch/ui';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useShallow } from 'zustand/shallow';
import {
  canSubmitChatComposerDraft,
  canEditChatMessage,
  isRecalledChatMessage,
  shouldSendComposerEnter,
} from '@peers-touch/client-chat-core';

import { confirm, confirmDestructive, notifySuccess } from '../app/feedback/mobileFeedback';
import { useMobileI18n } from '../app/mobileI18n';
import { useMobilePlatform } from '../services/platform/PlatformContext';
import type { MobileChatDetailRoute } from '../app/navigation';
import { useMobileNavigationStore } from '../app/navigation';
import { chatSurfaceFixtureRouteKind, useChatSurfaceFixture } from '../acceptance/chatSurfaceFixture';
import type { BoundedListHandle } from '../components/BoundedList';
import { MobileNotice } from '../components/MobileNotice';
import { MobilePageLifetimeContext, useMobilePageDisposal } from '../components/mobilePageLifetime';
import { MobileMessageAttachmentItem } from '../features/chat/MessageAttachment';
import { AttachmentDetailHost } from '../features/chat/AttachmentDetailHost';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import {
  chatActionKey,
  loadChatActionStates,
  saveChatActionStates,
  type ChatActionState,
} from '../features/chat/chatActionState';
import {
  markChatAttachmentDraftsSubmitted,
  markSubmittedChatAttachmentDraftsFailed,
  patchChatAttachmentDraft,
  readyChatAttachmentStages,
  type MobileChatAttachmentDraft,
} from '../features/chat/chatAttachmentDraftState';
import {
  dispatchSendMessage,
  dispatchEditMessage,
  dispatchForwardMessage,
  dispatchHideMessageForMe,
  dispatchModerateMessage,
  dispatchRecallMessage,
  dispatchBlockUser,
  dispatchUnblockUser,
  dispatchGroupUpdate,
  dispatchGroupInviteMember,
  dispatchGroupLeave,
  dispatchGroupRemoveMember,
  dispatchGroupUpdateMember,
  dispatchGroupTransferOwnership,
  dispatchGroupDissolve,
  dispatchMessagePin,
  dispatchMessageReaction,
  dispatchLoadConversationHistory,
  friendPatchFromActionPatch,
  type ChatMessageSendContext,
} from '../features/chat/chatCommands';
import {
  buildChatDraftEnvelope,
  isChatComposerDraftEmpty,
  readChatDraftEnvelope,
  type ChatComposerDraft,
} from '../features/chat/chatDraftEnvelope';
import { recoveredComposerDraft } from '../features/chat/composerRecoveryProjection';
import {
  isChatMessageCommandBusy,
  type ChatMessageCommandOutcome,
} from '../features/chat/messageCommandState';
import {
  messageProjectionMetadata,
  type MessageDeliveryDisplayState,
} from '../features/chat/messageProjection';
import {
  dispatchSenderTypingRequest,
} from '../features/chat/typingDispatch';
import { useMessageFlagState } from '../features/chat/messageFlagState';
import { useChatMessageAnchor } from '../features/chat/useChatMessageAnchor';
import { useChatReadCursor } from '../features/chat/useChatReadCursor';
import { useMobileChatVoiceRecorder } from '../features/chat/useMobileChatVoiceRecorder';
import { mobileCallManager } from '../features/call/callState';
import {
  mobileGroupCallManager, readMobileGroupCallRooms, subscribeMobileGroupCallRooms,
} from '../features/call/groupCallRuntime';
import {
  useConversationListProjection,
  conversationAvatar,
  conversationTitle,
  formatRelativeTime,
  friendSettingsToActionState,
  messageTimestampMillis,
  chatMessageAttachments,
  isOwnChatMessage,
  useChatHistoryProjection,
  conversationPreferenceState,
  selectConversationTypingPeers,
  type MobileConversation,
} from '../features/chat/chatSelectors';
import {
  requestSocialFriendshipStatus,
  requestSocialPeerProfiles,
} from '../features/social/socialRuntime';
import { formatSocialError, useSocialStore } from '../features/social/socialStore';
import { SocialApiError, readableErrorMessage, type SocialMessage, type SocialMessageAttachment } from '../features/social/socialTypes';
import { MemberRole } from '../gen/proto/domain/chat/conversation_pb';
import { ChatStorageOperationState } from '../gen/proto/domain/chat/storage_pb';
import { MobileDraftSurfaceKind } from '../gen/proto/domain/mobile/reliability_pb';
import { getDraftRestorationPort } from '../runtimes/commandRuntime';
import { secureRandomUuid } from '../utils/randomIdentity';
import {
  chatStorageReleasedBytes,
  mobileChatStorageProjectionRuntime,
} from '../runtimes/chatStorageRuntime';
import {
  messagingDiscardAttachmentStage,
  messagingRestoreAttachmentStage,
  messagingRecoverAttachmentComposer,
  messagingReleaseAttachmentStagePreview,
  messagingStageAttachment,
  type MessagingAccountInput,
  type MessagingAttachmentStageProjection,
  type MessagingMemberAuthorityMemberProjection,
  type MessagingSubmitCommandResult,
} from '../services/mobileCommands';
import {
  ChatConversationListPageContent,
  ChatThreadPageContent,
} from './chat/ChatPageContent';
import {
  AttachmentDraftChip,
  ChatMessageSelectionToolbar,
  EncryptedAttachmentReferenceChip,
  MessageCommandStatus,
  MessageDeliveryStatus,
} from './chat/ChatMessagePresentation';
import { MobileChatComposer } from './chat/MobileChatComposer';
import {
  ChatMessageSectionBoundary,
  chatMessageSenderPtids,
  messageContentForSearch,
} from './chat/ChatMessageSectionBoundary';
import {
  ChatDestructiveConfirmSheet,
  ChatActionSheet,
  ChatOverlayHost,
  ForwardMessageSheet,
  GroupManagementModal,
  MessageActionSheet,
  type MessageForwardDestination,
} from './chat/ChatOverlayHost';
import { ChatAcceptanceSurface } from './chat/ChatAcceptanceSurface';
import {
  chatActionStateMatchesPatch,
  conversationSettingsFeedback,
  IDLE_CONVERSATION_SETTINGS_FEEDBACK,
  type ConversationSettingsFeedback,
} from './chat/conversationSettingsState';
import {
  chatInputPanelState,
  useChatBottomOcclusion,
} from './chat/chatBottomOcclusion';
import {
  MOBILE_CHAT_COMPOSER_CAPABILITIES_THREAD,
  mobileChatLayoutForSurface,
  mobileChatVisualCssVars,
} from './chat/chatPresentationPolicy';

const TYPING_TRUE_INTERVAL_MS = 3000;
const TYPING_FALSE_DELAY_MS = 4000;
const EMPTY_MESSAGES: SocialMessage[] = [];
const MOBILE_THREAD_COMPOSER_CAPABILITIES =
  MOBILE_CHAT_COMPOSER_CAPABILITIES_THREAD;
const MOBILE_THREAD_VISUAL_VARS = mobileChatVisualCssVars(
  mobileChatLayoutForSurface('mobile-thread'),
) as CSSProperties;
/** Maximum messages mounted in one traversable window. */
const MESSAGE_WINDOW_SIZE = 200;

type EditingMessage = {
  kind: 'friend' | 'group';
  ulid: string;
  content: string;
};

type PendingComposerSubmission = {
  conversationId: string;
  messageId: string;
  attachmentIds: string[];
  submittedText: string;
  replyToMessageId?: string;
  threadRootMessageId?: string;
};

type ForwardMessageSource = {
  conversationId: string;
  messageIds: string[];
};

// ---------------------------------------------------------------------------
// ChatPage — pure renderer with explicit page-local recovery
// ---------------------------------------------------------------------------

class ChatMountGuard extends Component<{
  children: ReactNode;
  fallback: (retry: () => void) => ReactNode;
}, { hasError: boolean; retryCount: number }> {
  state = { hasError: false, retryCount: 0 };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: Error) {
    console.error('[mobile-chat] render failed', {
      name: error.name,
      message: error.message,
    });
  }
  retry = () => this.setState((s) => ({ hasError: false, retryCount: s.retryCount + 1 }));
  render() {
    if (this.state.hasError) return this.props.fallback(this.retry);
    return this.props.children;
  }
}

interface ChatPageProps {
  readonly activeDetail: MobileChatDetailRoute | null;
  readonly onStartConversation: () => void;
  readonly searchEntry?: ReactNode;
  readonly listHeader?: ReactNode;
  readonly onOpenSearch?: (conversationId: string) => void;
  readonly onOpenConversation: (route: MobileChatDetailRoute) => void;
  readonly onBack: () => void;
}

export function ChatPage(props: ChatPageProps) {
  const { t } = useMobileI18n();
  const chatFixture = useChatSurfaceFixture();
  const pageLifetime = useContext(MobilePageLifetimeContext);
  if (chatFixture.surfaceId) {
    const pageRouteKind = !props.activeDetail ? 'list'
      : props.activeDetail.routeId === 'detail:group-conversation' ? 'group' : 'direct';
    if (pageLifetime?.visible === false
      || chatSurfaceFixtureRouteKind(chatFixture.surfaceId) !== pageRouteKind) return null;
    return (
      <ChatAcceptanceSurface
        key={`${chatFixture.surfaceId}:${chatFixture.revision}`}
        surfaceId={chatFixture.surfaceId}
        listHeader={props.listHeader}
      />
    );
  }
  return (
    <ChatMountGuard fallback={(retry) => (
      <section className="mobile-page" data-testid="chat-render-error" role="alert" data-product-surface="chat.list-error">
        <MobileNotice tone="error">{t('mobile.chat.renderFailed')}</MobileNotice>
        <Button
          actionId="chat.retry-render"
          leading={<Icon iconId="rotate-ccw" size={16} />}
          onActivate={retry}
        >
          {t('common.action.retry')}
        </Button>
      </section>
    )}>
      <ChatPageInner {...props} />
    </ChatMountGuard>
  );
}

function ChatPageInner({
  activeDetail,
  onStartConversation,
  onOpenConversation,
  onBack,
  searchEntry,
  listHeader,
  onOpenSearch,
}: ChatPageProps) {
  const { t } = useMobileI18n();
  const platform = useMobilePlatform();
  const activeSessionUlid = activeDetail?.routeId === 'detail:chat-conversation'
    ? activeDetail.sessionUlid
    : null;
  const activeGroupUlid = activeDetail?.routeId === 'detail:group-conversation'
    ? activeDetail.groupUlid
    : null;
  const groupCallRooms = useSyncExternalStore(subscribeMobileGroupCallRooms, readMobileGroupCallRooms, readMobileGroupCallRooms);
  const routeHasMessageAnchor = Boolean(
    activeDetail?.messageId || activeDetail?.threadRootMessageId,
  );

  // --- Local UI state (no business logic) ---
  const [draft, setDraft] = useState('');
  const conversationQuery = useMobileNavigationStore((state) => state.messageQueries.chats);
  const setMessageQuery = useMobileNavigationStore((state) => state.setMessageQuery);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [composerSubmitting, setComposerSubmitting] = useState(false);
  const [attachmentDrafts, setAttachmentDraftState] = useState<MobileChatAttachmentDraft[]>([]);
  const attachmentDraftsRef = useRef<MobileChatAttachmentDraft[]>([]);
  const discardedAttachmentDraftIdsRef = useRef(new Set<string>());
  const setAttachmentDrafts = useCallback((
    next: MobileChatAttachmentDraft[] | ((current: MobileChatAttachmentDraft[]) => MobileChatAttachmentDraft[]),
  ) => {
    const value = typeof next === 'function' ? next(attachmentDraftsRef.current) : next;
    attachmentDraftsRef.current = value;
    setAttachmentDraftState(value);
  }, []);
  const [encryptedAttachmentRefs, setEncryptedAttachmentRefs] = useState<string[]>([]);
  const [pendingAttachmentSubmission, setPendingAttachmentSubmission] = useState<PendingComposerSubmission | null>(null);
  const [chatActionStates, setChatActionStates] = useState<Record<string, ChatActionState>>({});
  const [conversationSettingsState, setConversationSettingsState] = useState<ConversationSettingsFeedback>(
    IDLE_CONVERSATION_SETTINGS_FEEDBACK,
  );
  const [highlightedMessageUlid, setHighlightedMessageUlid] = useState('');
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState('');
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);
  const [replyToMessageUlid, setReplyToMessageUlid] = useState('');
  const [threadRootMessageUlid, setThreadRootMessageUlid] = useState('');
  const [messageActionUlid, setMessageActionUlid] = useState('');
  const [selectionActive, setSelectionActive] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [forwardMessageSource, setForwardMessageSource] = useState<ForwardMessageSource | null>(null);
  const [forwardPendingDestinationId, setForwardPendingDestinationId] = useState('');
  const [forwardError, setForwardError] = useState('');
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [clearHistoryBusy, setClearHistoryBusy] = useState(false);
  const [localActionError, setLocalActionError] = useState('');
  const messageWindow = useRef<BoundedListHandle>(null);

  // --- Narrow store selectors (batched via useShallow to prevent torn-read cascades) ---
  const {
    currentUserPtid,
    loading,
    error,
    currentUserProfile,
    friendshipStatus,
    friendRequests,
    friendConversationSettings,
    messagingConversations,
    lastReconcileAt,
    selectedConversationId,
    selectSession,
    sendTypingState,
    clearError: clearSocialError,
    updateConversationSettings: updateFriendConversationSettings,
    loadFriendThreadMessages,
    friendMessageCommandOutcomes,
    groupCommandOutcomes,
    refreshFriendMessageCommandOutcomes,
  } = useSocialStore(useShallow((s) => ({
    currentUserPtid: s.currentUserPtid,
    loading: s.loading,
    error: s.error,
    currentUserProfile: s.currentUserProfile,
    friendshipStatus: s.friendshipStatus,
    friendRequests: s.friendRequests,
    friendConversationSettings: s.conversationSettings,
    messagingConversations: s.messagingConversations,
    lastReconcileAt: s.lastReconcileAt,
    selectedConversationId: s.activeSessionUlid,
    selectSession: s.selectSession,
    sendTypingState: s.sendTypingState,
    clearError: s.clearError,
    updateConversationSettings: s.updateConversationSettings,
    loadFriendThreadMessages: s.loadThreadMessages,
    friendMessageCommandOutcomes: s.messageCommandOutcomes,
    groupCommandOutcomes: s.groupCommandOutcomes,
    refreshFriendMessageCommandOutcomes: s.refreshMessageCommandOutcomes,
  })));
  const activeConversationId = activeGroupUlid || activeSessionUlid || '';
  const authSession = useAuthStore((s) => s.session);
  const draftScopeKey = authSession
    ? `${authSession.stationPeerId}:${authSession.actorRef.ptid}:${authSession.deviceId}`
    : '';
  const draftSessionRef = useRef(authSession);
  const translateRef = useRef(t);
  draftSessionRef.current = authSession;
  translateRef.current = t;
  const messageFlagKind = activeGroupUlid
    ? 'group'
    : activeSessionUlid
      ? 'friend'
      : null;
  const messageFlags = useMessageFlagState(
    authSession,
    messageFlagKind,
    activeConversationId,
  );
  const messages = useSocialStore((s) => (activeConversationId ? s.messages[activeConversationId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const projectedThreadMessages = useSocialStore((s) => (
    threadRootMessageUlid
      ? s.threadMessages[threadRootMessageUlid] ?? EMPTY_MESSAGES
      : EMPTY_MESSAGES
  ));
  const peerProfiles = useSocialStore((s) => s.peerProfiles);
  const typingPeers = useSocialStore((s) => {
    const id = activeGroupUlid || activeSessionUlid || '';
    return selectConversationTypingPeers(s, id);
  });

  // --- Conversation list projection (single call to reduce store subscriptions) ---
  const { surfaceItems: allSurfaceItems, all: baseConversations } = useConversationListProjection(
    conversationQuery,
    chatActionStates,
    friendConversationSettings,
  );
  const filteredConversationSurfaceItems = allSurfaceItems;

  // --- Derived conversation data (memoised) ---
  const conversations = useMemo(() =>
    baseConversations.filter((c): c is Extract<MobileConversation, { kind: 'friend' }> => c.kind === 'friend').map((c) => c.conversation),
    [baseConversations],
  );
  const groupConversations = useMemo(() =>
    baseConversations.filter((c): c is Extract<MobileConversation, { kind: 'group' }> => c.kind === 'group').map((c) => c.conversation),
    [baseConversations],
  );
  const forwardDestinations = useMemo<MessageForwardDestination[]>(
    () => baseConversations.map((conversation) => ({
      key: conversation.key,
      conversationId: conversation.kind === 'friend'
        ? conversation.conversation.session.ulid
        : conversation.conversation.projection.conversationId,
      kind: conversation.kind,
      title: conversationTitle(conversation),
      subtitle: t(conversation.kind === 'friend'
        ? 'mobile.chat.forwardDestinationDirect'
        : 'mobile.chat.forwardDestinationGroup'),
      avatar: conversationAvatar(conversation),
    })),
    [baseConversations, t],
  );

  const activeConversation = conversations.find((c) => c.session.ulid === activeSessionUlid);
  const activeGroupConversation = groupConversations.find(
    (conversation) => conversation.projection.conversationId === activeGroupUlid,
  );
  const activeConversationKey = activeGroupUlid
    ? `group:${activeGroupUlid}`
    : activeSessionUlid
      ? `friend:${activeSessionUlid}`
      : '';
  const actionState = friendSettingsToActionState(
    activeConversationId ? friendConversationSettings[activeConversationId] : undefined,
    chatActionStates[activeConversationKey],
  );
  const history = useChatHistoryProjection(
    messages,
    projectedThreadMessages,
    threadRootMessageUlid,
    '',
  );
  const readTarget = history.visible.at(-1);
  const reportReadCursorError = useCallback((readError: unknown) => {
    setLocalActionError(formatChatOperationError(readError));
  }, []);
  useChatReadCursor({
    session: authSession,
    conversationId: activeConversationId,
    messageId: readTarget?.ulid ?? '',
    sequence: readTarget?.eventSequence ?? 0,
    visible: activeDetail !== null,
    onError: reportReadCursorError,
  });
  useChatMessageAnchor({
    route: activeDetail,
    conversationId: activeConversationId,
    messages,
    threadMessages: projectedThreadMessages,
    threadRootMessageId: threadRootMessageUlid,
    setThreadRootMessageId: setThreadRootMessageUlid,
    highlight: setHighlightedMessageUlid,
    controller: messageWindow,
  });
  const activeConversationKeyRef = useRef('');
  const chatActionStatesRef = useRef<Record<string, ChatActionState>>({});
  const chatActionStateWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const conversationSettingsAttemptRef = useRef(0);
  const conversationSettingsPendingRef = useRef(false);
  useEffect(() => {
    activeConversationKeyRef.current = activeConversationKey;
    return () => { activeConversationKeyRef.current = ''; };
  }, [activeConversationKey]);
  const pendingAttachmentSubmissionRef = useRef<PendingComposerSubmission | null>(null);
  const draftValueRef = useRef('');
  const replyToMessageUlidRef = useRef('');
  const encryptedAttachmentRefsRef = useRef<readonly string[]>([]);
  const threadRootMessageUlidRef = useRef('');
  const draftLoadGenerationRef = useRef(0);
  const initializedComposerScope = useRef('');
  const restoredComposerScope = useRef('');
  const initializedThreadScope = useRef('');
  const draftScopeKeyRef = useRef(draftScopeKey);
  draftScopeKeyRef.current = draftScopeKey;
  const draftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const composerSubmittingRef = useRef(false);
  const suspendedComposerRef = useRef<{
    draft: ChatComposerDraft;
    attachments: MobileChatAttachmentDraft[];
  } | null>(null);
  const emojiWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftPort = useMemo(() => getDraftRestorationPort(), []);
  activeConversationKeyRef.current = activeConversationKey;
  draftValueRef.current = draft;
  replyToMessageUlidRef.current = replyToMessageUlid;
  encryptedAttachmentRefsRef.current = encryptedAttachmentRefs;
  threadRootMessageUlidRef.current = threadRootMessageUlid;
  const attachmentUploading = attachmentDrafts.some(
    (attachment) => attachment.status === 'uploading',
  );
  const attachmentStagingFailed = attachmentDrafts.some(
    (attachment) => attachment.status === 'failed',
  );
  const activeInputPanel = chatInputPanelState({
    emojiOpen: composerEmojiOpen,
    attachmentOpen: attachmentDrafts.length > 0
      || encryptedAttachmentRefs.length > 0,
  });
  const chatBottomOcclusion = useChatBottomOcclusion({
    activePanel: activeInputPanel,
    tabBarVisible: activeDetail === null,
  });
  const chatThreadStyle = useMemo(
    () => ({
      ...MOBILE_THREAD_VISUAL_VARS,
      ...chatBottomOcclusion.style,
    }),
    [chatBottomOcclusion.style],
  );

  const peerTyping = activeConversation
    ? Boolean(typingPeers[activeConversation.peerPtid]?.typing)
    : Object.entries(typingPeers).some(([ptid, entry]) => ptid !== currentUserPtid && entry.typing);
  const groupMembers = useMemo<MessagingMemberAuthorityMemberProjection[]>(
    () => activeGroupConversation?.projection.members
      ?? activeGroupConversation?.projection.memberPtids.map((ptid) => ({
        ptid,
        role: ptid === activeGroupConversation.projection.ownerPtid
          ? MemberRole.OWNER
          : MemberRole.MEMBER,
        homeStationPeerId: '',
        muted: false,
      }))
      ?? [],
    [activeGroupConversation],
  );
  const groupMemberPtids = useMemo(
    () => new Set(groupMembers.map((member) => member.ptid)),
    [groupMembers],
  );
  const groupInviteCandidates = useMemo(
    () => conversations.filter((conversation) => {
      if (
        !conversation.peerPtid
        || groupMemberPtids.has(conversation.peerPtid)
        || friendshipStatus[conversation.peerPtid]?.blocked
      ) {
        return false;
      }
      return friendRequests.some((request) => (
        request.status === 2
        && request.federationId === activeGroupConversation?.projection.federationId
        && (
          (request.senderPtid === currentUserPtid
            && request.receiverPtid === conversation.peerPtid)
          || (request.receiverPtid === currentUserPtid
            && request.senderPtid === conversation.peerPtid)
        )
      ));
    }),
    [
      activeGroupConversation?.projection.federationId,
      conversations,
      currentUserPtid,
      friendRequests,
      friendshipStatus,
      groupMemberPtids,
    ],
  );
  const myGroupRole = activeGroupConversation?.projection.ownerPtid === currentUserPtid
    ? MemberRole.OWNER
    : groupMembers.find((member) => member.ptid === currentUserPtid)?.role
      ?? MemberRole.UNSPECIFIED;
  const canManageGroupMembers = myGroupRole >= MemberRole.ADMIN;

  // --- Refs ---
  const composingRef = useRef(false);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const lastCompositionEndRef = useRef(0);
  const lastTypingPulseRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const emojiStorageKey = authSession
    ? `chat.recent-emojis:${authSession.stationPeerId}:${authSession.actorRef.ptid}`
    : '';
  useEffect(() => {
    let cancelled = false;
    if (!emojiStorageKey) setRecentEmojis([]);
    if (emojiStorageKey) {
      void platform.secureStorage.get(emojiStorageKey).then(value => {
        if (cancelled || !value) return;
        try {
          const parsed: unknown = JSON.parse(value);
          if (Array.isArray(parsed)) setRecentEmojis(parsed.filter((item): item is string => typeof item === 'string').slice(0, 12));
        } catch { /* Invalid preferences do not prevent composing a message. */ }
      }).catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [emojiStorageKey, platform]);
  const rememberEmoji = (emoji: string) => {
    const next = [emoji, ...recentEmojis.filter(item => item !== emoji)].slice(0, 12);
    setRecentEmojis(next);
    if (emojiStorageKey) {
      emojiWriteQueueRef.current = emojiWriteQueueRef.current
        .then(() => platform.secureStorage.set(emojiStorageKey, JSON.stringify(next)))
        .catch(() => undefined);
    }
  };

  const enqueueDraftPersistence = useCallback((
    targetId: string,
    nextDraft: ChatComposerDraft,
  ) => {
    if (!authSession || !targetId) return;
    const stationPeerId = authSession.stationPeerId;
    const actorPtid = authSession.actorRef.ptid;
    const snapshot: ChatComposerDraft = {
      ...nextDraft,
      stagedAttachmentIds: nextDraft.stagedAttachmentIds
        ?? (targetId === activeConversationId
          ? readyChatAttachmentStages(suspendedComposerRef.current?.attachments ?? attachmentDraftsRef.current).map(stage => stage.stageId)
          : []),
      threadRootMessageId: nextDraft.threadRootMessageId
        ?? (targetId === activeConversationId ? threadRootMessageUlidRef.current : ''),
      pendingMessageId: nextDraft.pendingMessageId
        ?? (pendingAttachmentSubmissionRef.current?.conversationId === targetId
          ? pendingAttachmentSubmissionRef.current.messageId : ''),
    };
    draftWriteQueueRef.current = draftWriteQueueRef.current
      .then(async () => {
        if (isChatComposerDraftEmpty(snapshot)) {
          await draftPort.remove(
            stationPeerId,
            actorPtid,
            MobileDraftSurfaceKind.CHAT_COMPOSER,
            targetId,
          );
          return;
        }
        await draftPort.save(buildChatDraftEnvelope(
          { stationPeerId, actorPtid },
          targetId,
          snapshot,
          Date.now(),
        ));
      })
      .catch((draftError) => {
        const currentSession = draftSessionRef.current;
        if (!currentSession || currentSession.stationPeerId !== stationPeerId
          || currentSession.actorRef.ptid !== actorPtid) return;
        setLocalActionError(
          `${t('mobile.recovery.draftRestore.title')}: ${formatChatOperationError(draftError)}`,
        );
      });
  }, [activeConversationId, authSession, draftPort, t]);

  useEffect(() => {
    if (selectedConversationId !== (activeConversationId || null)) {
      void selectSession(activeConversationId || null);
    }
  }, [activeConversationId, selectSession, selectedConversationId]);

  useEffect(() => {
    const scope = `${activeConversationId}:${draftScopeKey}:${routeHasMessageAnchor}`;
    if (initializedThreadScope.current === scope) return;
    initializedThreadScope.current = scope;
    // Route anchors own thread selection independently of composer restoration.
    if (!routeHasMessageAnchor) setThreadRootMessageUlid('');
  }, [activeConversationId, draftScopeKey, routeHasMessageAnchor]);

  useEffect(() => {
    if (
      activeGroupUlid
      && lastReconcileAt !== null
      && !messagingConversations.some(
        (conversation) => conversation.conversationId === activeGroupUlid,
      )
    ) {
      onBack();
    }
  }, [activeGroupUlid, lastReconcileAt, messagingConversations, onBack]);

  // --- Side effects: persist the old target, then restore the new target ---
  useEffect(() => {
    const authSession = draftSessionRef.current;
    const scope = `${draftScopeKey}:${activeConversationId}`;
    if (restoredComposerScope.current === scope) return;
    const preserveDraft = initializedComposerScope.current === scope;
    initializedComposerScope.current = scope;
    const loadGeneration = draftLoadGenerationRef.current + 1;
    draftLoadGenerationRef.current = loadGeneration;
    if (!preserveDraft) {
      setActionSheetOpen(false);
      setGroupManageOpen(false);
      setComposerEmojiOpen(false);
      composerSubmittingRef.current = false;
      setComposerSubmitting(false);
      suspendedComposerRef.current = null;
      setEditingMessage(null);
      setReplyToMessageUlid('');
      replyToMessageUlidRef.current = '';
      setEncryptedAttachmentRefs([]);
      encryptedAttachmentRefsRef.current = [];
      setMessageActionUlid('');
      setSelectionActive(false);
      setSelectedMessageIds([]);
      setSelectionBusy(false);
      setForwardMessageSource(null);
      setForwardPendingDestinationId('');
      setForwardError('');
      setClearHistoryConfirmOpen(false);
      setClearHistoryBusy(false);
      conversationSettingsAttemptRef.current += 1;
      conversationSettingsPendingRef.current = false;
      setConversationSettingsState(IDLE_CONVERSATION_SETTINGS_FEEDBACK);
      setLocalActionError('');
      setAttachmentDrafts([]);
      pendingAttachmentSubmissionRef.current = null;
      setPendingAttachmentSubmission(null);
      setDraft('');
      draftValueRef.current = '';
    }

    if (!authSession || !activeConversationId) {
      restoredComposerScope.current = scope;
      return;
    }
    const stationPeerId = authSession.stationPeerId;
    const actorPtid = authSession.actorRef.ptid;
    void draftWriteQueueRef.current
      .then(() => draftPort.load(
        stationPeerId,
        actorPtid,
        MobileDraftSurfaceKind.CHAT_COMPOSER,
        activeConversationId,
      ))
      .then(async (envelope) => {
        const saved = envelope ? readChatDraftEnvelope(envelope) : null;
        const native = await messagingRecoverAttachmentComposer({
          stationPeerId, actorPtid, conversationId: activeConversationId,
          stageIds: saved?.stagedAttachmentIds ?? [],
        });
        const restored = recoveredComposerDraft(saved, native);
        if (
          draftLoadGenerationRef.current !== loadGeneration
          || (!preserveDraft && (draftValueRef.current
            || replyToMessageUlidRef.current
            || encryptedAttachmentRefsRef.current.length > 0
            || attachmentDraftsRef.current.length > 0))
        ) {
          return;
        }
        if (!preserveDraft) {
          draftValueRef.current = restored.text;
          replyToMessageUlidRef.current = restored.replyToMessageId;
          encryptedAttachmentRefsRef.current = restored.encryptedAttachmentRefs;
          setDraft(restored.text);
          setReplyToMessageUlid(restored.replyToMessageId);
          setEncryptedAttachmentRefs([...restored.encryptedAttachmentRefs]);
          if (restored.threadRootMessageId) setThreadRootMessageUlid(restored.threadRootMessageId);
          if (restored.pendingMessageId) {
            const pending: PendingComposerSubmission = {
              conversationId: activeConversationId,
              messageId: restored.pendingMessageId,
              attachmentIds: [...restored.encryptedAttachmentRefs],
              submittedText: restored.text,
              replyToMessageId: restored.replyToMessageId,
              threadRootMessageId: restored.threadRootMessageId,
            };
            pendingAttachmentSubmissionRef.current = pending;
            setPendingAttachmentSubmission(pending);
          }
        }
        const recovered = await Promise.all(native.stages.map(async stage => {
          const stageId = stage.stageId;
          try {
            const access = await messagingRestoreAttachmentStage({
              stationPeerId, actorPtid, stageId,
            });
            return {
              id: stageId, filename: access.stage.filename,
              mimeType: access.stage.mimeType, previewUrl: access.assetUrl,
              previewHandle: access.accessHandle,
              voiceNote: access.stage.voiceNote, attempt: 0,
              status: 'ready' as const, attachment: access.stage,
            };
          } catch (restoreError) {
            if (draftLoadGenerationRef.current === loadGeneration) {
              setLocalActionError(`${translateRef.current('mobile.recovery.draftRestore.title')}: ${formatChatOperationError(restoreError)}`);
            }
            // Keep a removable failed item, preserving its native identity.
            return {
              id: stageId, filename: stage.filename,
              mimeType: stage.mimeType, previewUrl: '', attempt: 0,
              status: 'failed' as const,
              attachment: stage,
            };
          }
        }));
        if (draftLoadGenerationRef.current !== loadGeneration) {
          recovered.forEach(item => releaseDraftPreview(authSession, item));
          return;
        }
        setAttachmentDrafts(current => {
          const present = new Set(current.flatMap(item => [item.id, item.attachment?.stageId]));
          const added = recovered.filter(item => !present.has(item.id));
          recovered.filter(item => present.has(item.id)).forEach(item => releaseDraftPreview(authSession, item));
          return [...current, ...added];
        });
        restoredComposerScope.current = scope;
      })
      .catch((draftError) => {
        if (draftLoadGenerationRef.current !== loadGeneration) return;
        setLocalActionError(
          `${translateRef.current('mobile.recovery.draftRestore.title')}: ${formatChatOperationError(draftError)}`,
        );
      });
    return () => {
      draftLoadGenerationRef.current += 1;
    };
  }, [
    activeConversationId,
    activeSessionUlid,
    draftScopeKey,
    draftPort,
    setAttachmentDrafts,
  ]);

  useMobilePageDisposal(() => {
    const session = draftSessionRef.current;
    attachmentDraftsRef.current.forEach(item => releaseDraftPreview(session, item));
    suspendedComposerRef.current?.attachments.forEach(item => releaseDraftPreview(session, item));
  });

  useEffect(() => {
    if (
      !pendingAttachmentSubmission
      || pendingAttachmentSubmission.conversationId !== activeConversationId
    ) {
      return;
    }
    const projectedMessages = activeConversationId ? messages : [];
    const projected = projectedMessages.find((message) => message.ulid === pendingAttachmentSubmission.messageId);
    if (!projected) return;
    const messagingState = (projected as { messagingState?: string }).messagingState;
    if (messagingState === 'failed' || messagingState === 'terminal') {
      setAttachmentDrafts((drafts) => (
        markSubmittedChatAttachmentDraftsFailed(drafts)
      ));
      pendingAttachmentSubmissionRef.current = null;
      setPendingAttachmentSubmission(null);
      return;
    }
    if (
      !isAuthoritativeMessageProjection(
        projected,
        pendingAttachmentSubmission.attachmentIds,
      )
    ) return;
    attachmentDrafts.forEach((item) => releaseDraftPreview(authSession, item));
    setAttachmentDrafts([]);
    if (draftValueRef.current === pendingAttachmentSubmission.submittedText) {
      draftValueRef.current = '';
      replyToMessageUlidRef.current = '';
      encryptedAttachmentRefsRef.current = [];
      setDraft('');
      setReplyToMessageUlid('');
      setEncryptedAttachmentRefs([]);
      pendingAttachmentSubmissionRef.current = null;
      enqueueDraftPersistence(activeConversationId, {
        text: '',
        replyToMessageId: '',
        encryptedAttachmentRefs: [],
        stagedAttachmentIds: [],
        pendingMessageId: '',
      });
    }
    pendingAttachmentSubmissionRef.current = null;
    setPendingAttachmentSubmission(null);
  }, [
    activeConversationId,
    attachmentDrafts,
    authSession,
    enqueueDraftPersistence,
    messages,
    pendingAttachmentSubmission,
  ]);

  useEffect(() => {
    if (!authSession) {
      chatActionStatesRef.current = {};
      setChatActionStates({});
      return;
    }
    let active = true;
    void loadChatActionStates(authSession).then((states) => {
      if (!active) return;
      chatActionStatesRef.current = states;
      setChatActionStates(states);
    });
    return () => { active = false; };
  }, [authSession]);

  const requestedProfilesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ptids = new Set<string>();
    if (activeConversation?.peerPtid) ptids.add(activeConversation.peerPtid);
    groupMembers.forEach((member) => {
      if (member.ptid && member.ptid !== currentUserPtid) ptids.add(member.ptid);
    });
    chatMessageSenderPtids(messages, currentUserPtid).forEach((ptid) => ptids.add(ptid));
    const known = useSocialStore.getState().peerProfiles;
    ptids.forEach((ptid) => {
      if (ptid && !(ptid in known) && !requestedProfilesRef.current.has(ptid)) {
        requestedProfilesRef.current.add(ptid);
        void requestSocialPeerProfiles([ptid]);
      }
    });
  }, [activeConversation?.peerPtid, currentUserPtid, groupMembers, messages]);

  useEffect(() => {
    if (activeConversation?.peerPtid) {
      void requestSocialFriendshipStatus(activeConversation.peerPtid)
        .catch(() => undefined);
    }
  }, [activeConversation?.peerPtid]);

  useEffect(() => {
    if (!activeGroupConversation) return;
    setGroupNameDraft(activeGroupConversation.projection.name);
    setGroupDescriptionDraft(activeGroupConversation.projection.description ?? '');
  }, [activeGroupConversation]);

  // --- Sender typing publication ---
  const publishTypingState = useCallback((
    conversationId: string,
    typing: boolean,
  ) => {
    if (!conversationId) return Promise.resolve();
    return dispatchSenderTypingRequest(
      { conversationId, typing },
      sendTypingState,
    );
  }, [sendTypingState]);

  const emitTypingState = useCallback((
    typing: boolean,
  ) => publishTypingState(activeConversationId, typing), [
    activeConversationId,
    publishTypingState,
  ]);

  useEffect(() => {
    return () => {
      if (typingIdleTimerRef.current) { window.clearTimeout(typingIdleTimerRef.current); typingIdleTimerRef.current = null; }
      if (lastTypingPulseRef.current > 0 && activeConversationId) {
        void dispatchSenderTypingRequest(
          { conversationId: activeConversationId, typing: false },
          sendTypingState,
        );
      }
      lastTypingPulseRef.current = 0;
    };
  }, [activeConversationId, sendTypingState]);

  // --- Command dispatch wrappers ---
  const runChatOperation = useCallback(async (operation: () => Promise<unknown>, failureKey: string) => {
    setLocalActionError('');
    try { await operation(); } catch (operationError) {
      setLocalActionError(`${t(failureKey)}: ${formatChatOperationError(operationError)}`);
    }
  }, [t]);

  const handleDraftChange = useCallback((value: string) => {
    draftValueRef.current = value;
    setDraft(value);
    if (!editingMessage) {
      enqueueDraftPersistence(activeConversationId, {
        text: value,
        replyToMessageId: replyToMessageUlidRef.current,
        encryptedAttachmentRefs: encryptedAttachmentRefsRef.current,
      });
    }
    if (!activeConversationId) return;
    if (!value.trim()) {
      if (typingIdleTimerRef.current) {
        window.clearTimeout(typingIdleTimerRef.current);
        typingIdleTimerRef.current = null;
      }
      if (lastTypingPulseRef.current > 0) {
        lastTypingPulseRef.current = 0;
        void emitTypingState(false);
      }
      return;
    }
    const now = Date.now();
    if (now - lastTypingPulseRef.current > TYPING_TRUE_INTERVAL_MS) {
      lastTypingPulseRef.current = now;
      void emitTypingState(true);
    }
    if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = window.setTimeout(() => {
      lastTypingPulseRef.current = 0;
      void emitTypingState(false);
    }, TYPING_FALSE_DELAY_MS);
  }, [activeConversationId, editingMessage, emitTypingState, enqueueDraftPersistence]);

  const updateReplyContext = useCallback((messageId: string) => {
    replyToMessageUlidRef.current = messageId;
    setReplyToMessageUlid(messageId);
    if (editingMessage) return;
    enqueueDraftPersistence(activeConversationId, {
      text: draftValueRef.current,
      replyToMessageId: messageId,
      encryptedAttachmentRefs: encryptedAttachmentRefsRef.current,
    });
  }, [activeConversationId, editingMessage, enqueueDraftPersistence]);

  const updateEncryptedAttachmentRefs = useCallback((
    references: readonly string[],
  ) => {
    const next = [...references];
    encryptedAttachmentRefsRef.current = next;
    setEncryptedAttachmentRefs(next);
    if (editingMessage) return;
    enqueueDraftPersistence(activeConversationId, {
      text: draftValueRef.current,
      replyToMessageId: replyToMessageUlidRef.current,
      encryptedAttachmentRefs: next,
    });
  }, [activeConversationId, editingMessage, enqueueDraftPersistence]);

  const restoreComposerAfterEdit = useCallback(() => {
    const suspended = suspendedComposerRef.current;
    const restored = suspended?.draft ?? { text: '', replyToMessageId: '', encryptedAttachmentRefs: [] };
    draftValueRef.current = restored.text;
    replyToMessageUlidRef.current = restored.replyToMessageId;
    encryptedAttachmentRefsRef.current = restored.encryptedAttachmentRefs;
    setEditingMessage(null);
    setDraft(restored.text);
    setReplyToMessageUlid(restored.replyToMessageId);
    setEncryptedAttachmentRefs([...restored.encryptedAttachmentRefs]);
    setAttachmentDrafts(suspended?.attachments ?? []);
    suspendedComposerRef.current = null;
    enqueueDraftPersistence(activeConversationId, restored);
  }, [activeConversationId, enqueueDraftPersistence]);

  const applySendOutcome = useCallback((
    conversationId: string,
    submittedText: string,
    attachments: MessagingAttachmentStageProjection[],
    outcome: MessagingSubmitCommandResult,
    context: ChatMessageSendContext,
    submissionGeneration: number,
  ) => {
    validateSendOutcome(outcome, attachments.length);
    const submission = {
      conversationId,
      messageId: outcome.messageId!,
      attachmentIds: outcome.attachmentIds,
      submittedText,
      replyToMessageId: context.replyToMessageId,
      threadRootMessageId: context.threadRootMessageId,
    };
    enqueueDraftPersistence(conversationId, {
      text: submittedText,
      replyToMessageId: context.replyToMessageId ?? '',
      threadRootMessageId: context.threadRootMessageId ?? '',
      encryptedAttachmentRefs: outcome.attachmentIds,
      stagedAttachmentIds: [],
      pendingMessageId: outcome.messageId,
    });
    if (draftLoadGenerationRef.current !== submissionGeneration
      || activeConversationKeyRef.current !== `${activeGroupUlid ? 'group' : 'friend'}:${conversationId}`) return;
    encryptedAttachmentRefsRef.current = outcome.attachmentIds;
    setEncryptedAttachmentRefs(outcome.attachmentIds);
    setAttachmentDrafts((drafts) => (
      markChatAttachmentDraftsSubmitted(drafts)
    ));
    pendingAttachmentSubmissionRef.current = submission;
    setPendingAttachmentSubmission(submission);
  }, [activeGroupUlid, enqueueDraftPersistence]);

  const submitMessage = useCallback(async () => {
    if (composerSubmittingRef.current || pendingAttachmentSubmissionRef.current) return;
    const readyAttachments = readyChatAttachmentStages(attachmentDrafts);
    if (
      attachmentUploading
      || attachmentStagingFailed
      || encryptedAttachmentRefs.length > 0
      || !canSubmitChatComposerDraft({
        text: draft,
        attachmentCount: readyAttachments.length,
        capabilities: MOBILE_THREAD_COMPOSER_CAPABILITIES,
      })
    ) return;
    const sendContext: ChatMessageSendContext = {
      replyToMessageId: replyToMessageUlid || (threadRootMessageUlid || undefined),
      threadRootMessageId: threadRootMessageUlid || undefined,
    };

    if (!activeConversationId || (!activeConversation && !activeGroupConversation)) return;
    if (
      activeConversation
      && friendshipStatus[activeConversation.peerPtid]?.blocked
    ) {
      throw new Error(t('mobile.chat.blockedComposer'));
    }
    void emitTypingState(false);
    const submissionKey = activeConversationKeyRef.current;
    const submissionGeneration = draftLoadGenerationRef.current;
    composerSubmittingRef.current = true;
    setComposerSubmitting(true);
    try {
    const activeKind = activeGroupConversation ? 'group' : 'friend';
    if (editingMessage?.kind === activeKind) {
      await dispatchEditMessage(activeConversationId, editingMessage.ulid, draft);
      if (activeConversationKeyRef.current === submissionKey) restoreComposerAfterEdit();
      return;
    }
    const outcome = await dispatchSendMessage(
      activeConversationId,
      draft,
      readyAttachments,
      sendContext,
    );
    if (outcome) {
      applySendOutcome(
        activeConversationId,
        draft,
        readyAttachments,
        outcome,
        sendContext,
        submissionGeneration,
      );
    }
    } finally {
      if (draftLoadGenerationRef.current === submissionGeneration
        && activeConversationKeyRef.current === submissionKey) {
        composerSubmittingRef.current = false;
        setComposerSubmitting(false);
      }
    }
  }, [activeConversation, activeConversationId, activeGroupConversation, applySendOutcome, attachmentDrafts, attachmentStagingFailed, attachmentUploading, restoreComposerAfterEdit, draft, editingMessage, emitTypingState, encryptedAttachmentRefs.length, friendshipStatus, replyToMessageUlid, t, threadRootMessageUlid]);

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent;
    if (!shouldSendComposerEnter({
      key: event.key, shiftKey: event.shiftKey, isComposing: composingRef.current,
      nativeIsComposing: native.isComposing, keyCode: native.keyCode,
      lastCompositionEndAt: lastCompositionEndRef.current,
    })) return;
    event.preventDefault();
    void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed');
  }, [runChatOperation, submitMessage]);

  const removeAttachmentDraft = async (id: string) => {
    if (pendingAttachmentSubmission) return;
    const removed = attachmentDrafts.find((item) => item.id === id);
    if (!removed) return;
    try {
      if (removed.attachment) {
        await discardStagedAttachments(authSession, [removed]);
      }
      discardedAttachmentDraftIdsRef.current.add(id);
      setAttachmentDrafts((drafts) => drafts.filter((item) => item.id !== id));
      releaseDraftPreview(authSession, removed);
      enqueueDraftPersistence(activeConversationId, {
        text: draftValueRef.current, replyToMessageId: replyToMessageUlidRef.current,
        encryptedAttachmentRefs: encryptedAttachmentRefsRef.current,
        stagedAttachmentIds: attachmentDraftsRef.current.flatMap(item => item.attachment ? [item.attachment.stageId] : []),
      });
      if (encryptedAttachmentRefsRef.current.length > 0) {
        updateEncryptedAttachmentRefs([]);
      }
    } catch (discardError) {
      setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(discardError)}`);
    }
  };

  const openMobileFilePicker = () => {
    if (editingMessage || attachmentUploading || pendingAttachmentSubmission || composerSubmittingRef.current) return;
    setComposerEmojiOpen(false);
    fileInputRef.current?.click();
  };
  const openMobileCamera = () => {
    if (editingMessage || attachmentUploading || pendingAttachmentSubmission || composerSubmittingRef.current) return;
    setComposerEmojiOpen(false);
    cameraInputRef.current?.click();
  };

  const stageAttachmentDraft = async (
    item: MobileChatAttachmentDraft,
    uploadConversationKey: string,
  ) => {
    if (!authSession || !item.file) return;
    const uploadConversationId = activeConversationId;
    const uploadGeneration = draftLoadGenerationRef.current;
    const uploadScope = draftScopeKey;
    const account = messagingAccountFromSession(authSession);
    let completedAttachment: MessagingAttachmentStageProjection | undefined;
    setAttachmentDrafts((drafts) => patchChatAttachmentDraft(
      drafts,
      item.id,
      {
        attempt: item.attempt + 1,
        status: 'uploading',
        attachment: undefined,
      },
    ));
    try {
      const attachment = await messagingStageAttachment({
        ...account,
        conversationId: uploadConversationId,
        file: item.file,
        voiceNote: item.voiceNote,
      });
      completedAttachment = attachment;
      if (discardedAttachmentDraftIdsRef.current.delete(item.id)) {
        await messagingDiscardAttachmentStage({ ...account, stageId: attachment.stageId });
        return;
      }
      // This write is independent of the currently displayed route. Late
      // completion restores to its originating conversation and exact account.
      const persistStage = draftWriteQueueRef.current.then(async () => {
        const envelope = await draftPort.load(account.stationPeerId, account.actorPtid,
          MobileDraftSurfaceKind.CHAT_COMPOSER, uploadConversationId);
        const old = envelope ? readChatDraftEnvelope(envelope) : null;
        await draftPort.save(buildChatDraftEnvelope(account, uploadConversationId, {
          text: old?.text ?? '', replyToMessageId: old?.replyToMessageId ?? '',
          encryptedAttachmentRefs: old?.encryptedAttachmentRefs ?? [],
          stagedAttachmentIds: [...(old?.stagedAttachmentIds ?? []), attachment.stageId],
          threadRootMessageId: old?.threadRootMessageId,
          pendingMessageId: old?.pendingMessageId,
        }, Date.now()));
      });
      draftWriteQueueRef.current = persistStage.catch(() => undefined);
      await persistStage;
      if (uploadGeneration !== draftLoadGenerationRef.current
        || uploadConversationKey !== activeConversationKeyRef.current) {
        revokeObjectUrl(item.previewUrl);
        // Returning to the same conversation before completion must not require
        // another navigation to discover its newly committed source.
        if (uploadScope === draftScopeKeyRef.current
          && uploadConversationKey === activeConversationKeyRef.current) {
          const generation = draftLoadGenerationRef.current;
          const access = await messagingRestoreAttachmentStage({ ...account, stageId: attachment.stageId });
          const recovered: MobileChatAttachmentDraft = {
            id: attachment.stageId, filename: attachment.filename, mimeType: attachment.mimeType,
            previewUrl: access.assetUrl, previewHandle: access.accessHandle,
            voiceNote: attachment.voiceNote, attachment, status: 'ready', attempt: 1,
          };
          if (generation !== draftLoadGenerationRef.current
            || attachmentDraftsRef.current.some(draft => draft.attachment?.stageId === attachment.stageId)) {
            releaseDraftPreview(authSession, recovered);
          } else setAttachmentDrafts(current => [...current, recovered]);
        }
        return;
      }
      const access = await messagingRestoreAttachmentStage({ ...account, stageId: attachment.stageId });
      if (uploadGeneration !== draftLoadGenerationRef.current
        || !attachmentDraftsRef.current.some(draft => draft.id === item.id)) {
        releaseDraftPreview(authSession, { ...item, previewUrl: access.assetUrl,
          previewHandle: access.accessHandle });
        return;
      }
      releaseDraftPreview(authSession, item);
      setAttachmentDrafts((drafts) => patchChatAttachmentDraft(
        drafts,
        item.id,
        { status: 'ready', attachment, previewUrl: access.assetUrl,
          previewHandle: access.accessHandle },
      ));
    } catch (uploadError) {
      if (uploadGeneration !== draftLoadGenerationRef.current
        || uploadConversationKey !== activeConversationKeyRef.current
        || !attachmentDraftsRef.current.some(draft => draft.id === item.id)) return;
      setAttachmentDrafts((drafts) => patchChatAttachmentDraft(
        drafts,
        item.id,
        { status: 'failed', attachment: completedAttachment },
      ));
      setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(uploadError)}`);
    }
  };

  const retryAttachmentDraft = async (id: string) => {
    if (pendingAttachmentSubmission || attachmentUploading) return;
    const retry = attachmentDrafts.find((item) => item.id === id);
    if (!retry || retry.status !== 'failed') return;
    if (retry.attachment && authSession) {
      const session = authSession;
      const generation = draftLoadGenerationRef.current;
      try {
        const access = await messagingRestoreAttachmentStage({
          ...messagingAccountFromSession(authSession), stageId: retry.attachment.stageId,
        });
        if (draftLoadGenerationRef.current !== generation
          || !attachmentDraftsRef.current.some(item => item.id === id)) {
          releaseDraftPreview(session, { ...retry, previewUrl: access.assetUrl,
            previewHandle: access.accessHandle });
          return;
        }
        releaseDraftPreview(session, retry);
        setAttachmentDrafts(current => patchChatAttachmentDraft(current, id, {
          status: 'ready', attachment: access.stage, filename: access.stage.filename,
          mimeType: access.stage.mimeType, voiceNote: access.stage.voiceNote,
          previewUrl: access.assetUrl, previewHandle: access.accessHandle,
        }));
        enqueueDraftPersistence(activeConversationId, {
          text: draftValueRef.current, replyToMessageId: replyToMessageUlidRef.current,
          encryptedAttachmentRefs: encryptedAttachmentRefsRef.current,
        });
      } catch (error) {
        if (draftLoadGenerationRef.current === generation) setLocalActionError(formatChatOperationError(error));
      }
      return;
    }
    if (encryptedAttachmentRefsRef.current.length > 0) {
      updateEncryptedAttachmentRefs([]);
    }
    await stageAttachmentDraft(retry, activeConversationKey);
  };

  const handleMobileFilesSelected = async (files: FileList | null) => {
    if (!files?.length || !authSession || editingMessage || pendingAttachmentSubmission || composerSubmittingRef.current) return;
    const conversationId = activeGroupUlid || activeSessionUlid || '';
    const uploadConversationKey = activeConversationKey;
    if (!conversationId) return;
    setLocalActionError('');
    try {
      const selected = Array.from(files).map((file) => ({
        id: secureRandomUuid('mobile.chat.attachmentIdentityUnavailable'),
        file,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        previewUrl: URL.createObjectURL(file),
        attempt: 0,
        status: 'uploading' as const,
      }));
      setAttachmentDrafts((current) => [...current, ...selected]);
      await Promise.all(
        selected.map((item) => stageAttachmentDraft(
          item,
          uploadConversationKey,
        )),
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (cameraInputRef.current) cameraInputRef.current.value = '';
    }
  };

  const voiceRecorder = useMobileChatVoiceRecorder({
    disabled: !authSession
      || !activeConversationId
      || Boolean(editingMessage)
      || attachmentUploading
      || Boolean(pendingAttachmentSubmission),
    onRecorded: ({ file, metadata }) => {
      const item: MobileChatAttachmentDraft = {
        id: secureRandomUuid('mobile.chat.attachmentIdentityUnavailable'),
        file,
        filename: file.name,
        mimeType: file.type || metadata.codec,
        previewUrl: URL.createObjectURL(file),
        voiceNote: metadata,
        attempt: 0,
        status: 'uploading',
      };
      const uploadConversationKey = activeConversationKeyRef.current;
      setAttachmentDrafts((current) => [...current, item]);
      void stageAttachmentDraft(item, uploadConversationKey);
    },
    onDenied: () => setLocalActionError(t('chat.social.composer.voiceDenied')),
    onUnsupported: () => setLocalActionError(t('chat.social.composer.voiceUnsupported')),
    onFailed: () => setLocalActionError(t('chat.social.composer.voiceSendFailed')),
  });

  useEffect(() => () => {
    voiceRecorder.stopRecording(true);
  }, [activeConversationKey, voiceRecorder.stopRecording]);

  const startVoiceRecording = () => {
    setComposerEmojiOpen(false);
    composerInputRef.current?.blur();
    setLocalActionError('');
    void voiceRecorder.startRecording();
  };

  const openConversation = (conversation: MobileConversation) => {
    if (conversation.kind === 'group') {
      const groupUlid = conversation.conversation.projection.conversationId;
      onOpenConversation({
        routeId: 'detail:group-conversation',
        groupUlid,
      });
      void selectSession(groupUlid);
      return;
    }
    const sessionUlid = conversation.conversation.session.ulid;
    onOpenConversation({ routeId: 'detail:chat-conversation', sessionUlid });
    void selectSession(sessionUlid);
  };

  const updateChatActionState = async (
    key: string,
    patch: Partial<ChatActionState>,
    mode: 'dispatch' | 'retry' = 'dispatch',
  ) => {
    if (conversationSettingsPendingRef.current) return;
    const conversationId = activeConversationId;
    const attempt = conversationSettingsAttemptRef.current + 1;
    conversationSettingsAttemptRef.current = attempt;
    conversationSettingsPendingRef.current = true;
    setConversationSettingsState(conversationSettingsFeedback(
      key,
      mode === 'retry' ? 'retrying' : 'pending',
      patch,
    ));

    try {
      if (!authSession) throw new Error('mobile.auth.missingIdentityScope');
      let confirmedActionState: ChatActionState | undefined;
      const readProjectedActionState = () => {
        const projected = useSocialStore.getState().conversationSettings[conversationId];
        return projected
          ? friendSettingsToActionState(projected, undefined)
          : undefined;
      };

      if (mode === 'retry') {
        await useSocialStore.getState().loadConversationSettings(conversationId);
        confirmedActionState = readProjectedActionState();
      }

      if (!chatActionStateMatchesPatch(confirmedActionState, patch)) {
        await updateFriendConversationSettings(
          conversationId,
          friendPatchFromActionPatch(patch),
        );
        confirmedActionState = readProjectedActionState();
      }

      if (!chatActionStateMatchesPatch(confirmedActionState, patch)) {
        throw new Error('mobile.chat.conversationSettingsProjectionUnconfirmed');
      }

      if (
        activeConversationKeyRef.current === key
        && conversationSettingsAttemptRef.current === attempt
      ) {
        setConversationSettingsState(conversationSettingsFeedback(key, 'committed', patch));
      }

      const nextFallback = {
        ...chatActionStatesRef.current,
        [key]: confirmedActionState,
      };
      chatActionStatesRef.current = nextFallback;
      setChatActionStates(nextFallback);
      const fallbackWrite = chatActionStateWriteQueueRef.current.then(
        () => saveChatActionStates(authSession, nextFallback),
      );
      chatActionStateWriteQueueRef.current = fallbackWrite.then(
        () => undefined,
        () => undefined,
      );
    } catch {
      if (
        activeConversationKeyRef.current === key
        && conversationSettingsAttemptRef.current === attempt
      ) {
        setConversationSettingsState(conversationSettingsFeedback(key, 'failed', patch));
      }
    } finally {
      if (conversationSettingsAttemptRef.current === attempt) {
        conversationSettingsPendingRef.current = false;
      }
    }
  };

  const clearConversationData = async () => {
    if (!activeConversationId) return;
    setActionSheetOpen(false);
    setLocalActionError('');
    setClearHistoryBusy(true);
    try {
      const result = await mobileChatStorageProjectionRuntime
        .clearConversation(activeConversationId);
      if (
        !result
        || result.error
        || result.operation?.state !== ChatStorageOperationState.SUCCEEDED
      ) {
        throw new Error(
          result?.error?.message || 'chat conversation cleanup did not complete',
        );
      }
      const releasedBytes = chatStorageReleasedBytes(result) ?? 0n;
      await selectSession(activeConversationId);
      setClearHistoryConfirmOpen(false);
      notifySuccess(
        <>
          <Text strong>{t('mobile.chat.clearHistorySuccessTitle')}</Text>{' '}
          <span
            data-chat-conversation-clear-result="succeeded"
            data-chat-storage-released-bytes={releasedBytes.toString()}
          >
            {t('mobile.chat.clearHistorySuccessBody', {
              bytes: formatReleasedBytes(releasedBytes),
            })}
          </span>
        </>,
      );
    } catch (error) {
      setLocalActionError(formatChatOperationError(error));
    } finally {
      setClearHistoryBusy(false);
    }
  };

  const scrollToMessage = async (messageUlid: string) => {
    const scope = activeConversationKeyRef.current;
    const current = () => activeConversationKeyRef.current === scope
      && useAuthStore.getState().session === authSession;
    if (!messageWindow.current?.reveal(messageUlid)) {
      setThreadRootMessageUlid('');
      try {
        await dispatchLoadConversationHistory(
          activeGroupUlid ? 'group' : 'friend', activeConversationId,
        );
      } catch {
        if (current()) {
          setLocalActionError(t('mobile.chat.messageUnavailable'));
        }
        return;
      }
      if (!current()) return;
      requestAnimationFrame(() => {
        if (!current()) return;
        if (!messageWindow.current?.reveal(messageUlid)) {
          setLocalActionError(t('mobile.chat.messageUnavailable'));
        }
      });
    }
    setHighlightedMessageUlid(messageUlid);
  };

  const openMessageThread = (message: SocialMessage) => {
    const rootMessageUlid = message.threadRootUlid || message.ulid;
    setThreadRootMessageUlid(rootMessageUlid);
    setMessageActionUlid('');
    void runChatOperation(
      () => loadFriendThreadMessages(activeConversationId, rootMessageUlid),
      'mobile.chat.operationThreadFailed',
    );
  };

  const toggleMessageReaction = async (
    message: SocialMessage,
    reaction: string,
  ) => {
    const remove = messageProjectionMetadata(message).reactions.some(
      (item) => item.actorPtid === currentUserPtid && item.reaction === reaction,
    );
    await dispatchMessageReaction(
      activeGroupUlid ? 'group' : 'friend',
      activeConversationId,
      message.ulid,
      reaction,
      remove,
      threadRootMessageUlid || message.threadRootUlid || undefined,
    );
    setMessageActionUlid('');
  };

  const toggleMessagePin = async (message: SocialMessage) => {
    await dispatchMessagePin(
      activeGroupUlid ? 'group' : 'friend',
      activeConversationId,
      message.ulid,
      Boolean(messageProjectionMetadata(message).pinnedByPtid),
      threadRootMessageUlid || message.threadRootUlid || undefined,
    );
    setMessageActionUlid('');
  };

  const retryFailedMessage = async (message: SocialMessage) => {
    if (chatMessageAttachments(message).length > 0 || !message.content.trim()) {
      throw new Error(t('mobile.chat.retryAttachmentUnavailable'));
    }
    const context = {
      replyToMessageId: message.replyToUlid || undefined,
      threadRootMessageId: message.threadRootUlid || undefined,
    };
    await dispatchSendMessage(activeConversationId, message.content, [], context);
  };

  const forwardSelectedMessage = async (destination: MessageForwardDestination) => {
    if (!authSession || !forwardMessageSource || forwardPendingDestinationId) return;
    const sourceKey = activeConversationKeyRef.current;
    const remaining = [...forwardMessageSource.messageIds];
    setForwardError('');
    setForwardPendingDestinationId(destination.conversationId);
    try {
      while (remaining.length > 0) {
        await dispatchForwardMessage(
          authSession,
          destination.kind,
          forwardMessageSource.conversationId,
          remaining[0],
          destination.conversationId,
        );
        remaining.shift();
        if (activeConversationKeyRef.current !== sourceKey) return;
        setSelectedMessageIds(current => current.filter(id => remaining.includes(id)));
      }
      setForwardMessageSource(null);
      setSelectionActive(false);
      setSelectedMessageIds([]);
    } catch {
      if (activeConversationKeyRef.current === sourceKey) {
        setForwardMessageSource({ ...forwardMessageSource, messageIds: remaining });
        setForwardError(t('mobile.chat.operationForwardFailed'));
      }
    } finally {
      if (activeConversationKeyRef.current === sourceKey) setForwardPendingDestinationId('');
    }
  };
  const toggleSelectedMessage = (messageId: string) => {
    if (selectionBusy) return;
    setSelectedMessageIds(current => current.includes(messageId) ? current.filter(id => id !== messageId) : [...current, messageId]);
  };
  const hideSelectedMessages = () => {
    if (selectionBusy || selectedMessageIds.length === 0) return;
    const ids = [...selectedMessageIds];
    const key = activeConversationKeyRef.current;
    void confirmDestructive({
      title: t('mobile.chat.deleteForMeConfirmTitle'),
      description: t('mobile.chat.deleteSelectedBody', { count: ids.length }),
      confirmLabel: t('mobile.chat.deleteForMe'),
      cancelLabel: t('common.action.cancel'),
      onConfirm: async () => {
        setSelectionBusy(true);
        const remaining = [...ids];
        try {
          for (const id of ids) {
            await dispatchHideMessageForMe(activeGroupUlid ? 'group' : 'friend', activeConversationId, id);
            remaining.shift();
            if (activeConversationKeyRef.current !== key) return;
            setSelectedMessageIds([...remaining]);
          }
          setSelectionActive(false);
        } finally {
          if (activeConversationKeyRef.current === key) setSelectionBusy(false);
        }
      },
    });
  };

  // -----------------------------------------------------------------------
  // Thread view (active conversation)
  // -----------------------------------------------------------------------
  if (activeConversation || activeGroupConversation) {
    const isGroupThread = Boolean(activeGroupConversation);
    const title = activeGroupConversation?.projection.name
      || activeConversation?.peerName
      || '';
    const activeKey = activeConversationKey;
    const ownAvatar = currentUserProfile?.avatar || '';
    const ownName = authSession?.actorRef.acct || currentUserPtid || '';
    const peerProfile = activeConversation
      ? peerProfiles[activeConversation.peerPtid] ?? null
      : null;
    const activePeerBlocked = activeConversation
      ? Boolean(friendshipStatus[activeConversation.peerPtid]?.blocked)
      : false;
    const peerMessageAvatar = peerProfile?.avatar || activeConversation?.peerAvatar || '';
    const conversationSubtitle = peerTyping
      ? t('mobile.chat.typing')
      : activeGroupConversation
        ? t('mobile.group.memberCount', {
            count: activeGroupConversation.projection.memberPtids.length,
          })
        : t('mobile.chat.encrypted');

    const visibleMessages = history.visible;
    const messageCommandOutcomes = friendMessageCommandOutcomes;
    const threadMessages = visibleMessages;
    const selectedActionMessage = history.byId.get(messageActionUlid);
    const selectedActionModerated = selectedActionMessage
      ? messageProjectionMetadata(selectedActionMessage).moderated
      : false;
    const selectedActionCanEdit = selectedActionMessage
      ? canEditChatMessage({
        own: isOwnChatMessage(selectedActionMessage, currentUserPtid),
        recalled: isRecalledChatMessage(selectedActionMessage) || selectedActionModerated,
        encrypted: false,
        content: selectedActionMessage.content,
      })
      : false;
    const selectedActionFlagged = selectedActionMessage
      ? messageFlags.flaggedMessageIds.has(selectedActionMessage.ulid)
      : false;
    const selectedActionCommandOutcome = selectedActionMessage
      ? messageCommandOutcomes[selectedActionMessage.ulid]
      : undefined;
    const replyTargetMessage = history.byId.get(replyToMessageUlid);
    const threadReplyCount = history.replyCount;
    const headerTitle = threadRootMessageUlid ? t('mobile.chat.thread') : title;
    const subtitle = threadRootMessageUlid
      ? t('mobile.chat.threadReplyCount', { count: threadReplyCount })
      : conversationSubtitle;

    return (
      <ChatThreadPageContent
        activeInputPanel={chatBottomOcclusion.activePanel}
        keyboardOverlapHeight={chatBottomOcclusion.keyboardOverlapHeight}
        productSurface={isGroupThread
          ? 'chat.group-thread'
          : 'chat.direct-thread'}
        style={chatThreadStyle}
        tabBarVisible={chatBottomOcclusion.tabBarVisible}
      >
        <AttachmentDetailHost />
        <header className="page-header chat-thread-header">
          <button className="header-action" type="button" onClick={() => {
            if (threadRootMessageUlid && !activeDetail?.messageId) {
              setThreadRootMessageUlid('');
              updateReplyContext('');
              setMessageActionUlid('');
              return;
            }
            onBack();
          }} aria-label={t('common.action.back')}>
            <Icon iconId="arrow-left" size={20} />
          </button>
          <>
              <div className="header-title-stack">
                <h1 className="header-title compact">{headerTitle}</h1>
                <Text tone="secondary">{subtitle}</Text>
              </div>
              {!threadRootMessageUlid ? (
                <div className="chat-header-actions">
                  {(activeGroupConversation || (activeConversation && !activePeerBlocked)) ? (
                    <>
                      <button
                        className="header-action"
                        type="button"
                        data-group-call-start={activeGroupConversation ? 'audio' : undefined}
                        data-direct-call-start={activeConversation ? 'audio' : undefined}
                        onClick={() => {
                          void runChatOperation(
                            () => activeGroupConversation
                              ? mobileGroupCallManager.joinGroupCall(activeGroupConversation.projection.conversationId, 'audio')
                              : mobileCallManager.startOutgoingCall(activeConversation!.peerPtid, 'audio'),
                            'mobile.chat.callFailed',
                          );
                        }}
                        aria-label={t('mobile.chat.startAudioCall')}
                      >
                        <Icon iconId="phone" size={19} />
                      </button>
                      <button
                        className="header-action"
                        type="button"
                        data-group-call-start={activeGroupConversation ? 'video' : undefined}
                        data-direct-call-start={activeConversation ? 'video' : undefined}
                        onClick={() => {
                          void runChatOperation(
                            () => activeGroupConversation
                              ? mobileGroupCallManager.joinGroupCall(activeGroupConversation.projection.conversationId, 'video')
                              : mobileCallManager.startOutgoingCall(activeConversation!.peerPtid, 'video'),
                            'mobile.chat.callFailed',
                          );
                        }}
                        aria-label={t('mobile.chat.startVideoCall')}
                      >
                        <Icon iconId="video" size={20} />
                      </button>
                    </>
                  ) : null}
                  <button data-chat-actions-open className="header-action" type="button" onClick={() => setActionSheetOpen(true)} aria-label={t('mobile.chat.moreActions')}><Icon iconId="more-horizontal" size={20} /></button>
                </div>
              ) : null}
          </>
        </header>

        {activeGroupUlid && groupCallRooms.has(activeGroupUlid) ? <div className="mobile-group-call-banner">
          <Text>{t('mobile.groupCall.inProgress')}</Text>
          <Button actionId="group-call.join" label={t('mobile.groupCall.join')} onActivate={() => {
            void runChatOperation(() => mobileGroupCallManager.joinGroupCall(activeGroupUlid), 'mobile.chat.callFailed');
          }} />
        </div> : null}

        <ChatOverlayHost>
          <ChatActionSheet
            open={actionSheetOpen} state={actionState} onClose={() => setActionSheetOpen(false)}
            settingsFeedback={conversationSettingsState.conversationKey === activeKey
              ? conversationSettingsState
              : IDLE_CONVERSATION_SETTINGS_FEEDBACK}
            onRetrySettings={() => {
              if (conversationSettingsState.phase !== 'failed' || !conversationSettingsState.patch) return;
              void updateChatActionState(activeKey, conversationSettingsState.patch, 'retry');
            }}
            onSearch={() => { setActionSheetOpen(false); onOpenSearch?.(activeConversationId); }}
            onToggleMute={() => { void updateChatActionState(activeKey, { muted: !actionState.muted }); }}
            onToggleSticky={() => { void updateChatActionState(activeKey, { sticky: !actionState.sticky }); }}
            onToggleAlert={() => { void updateChatActionState(activeKey, { alertEnabled: !actionState.alertEnabled }); }}
            onSelectBackground={(bg) => { void updateChatActionState(activeKey, { background: bg }); }}
            onClearHistory={() => {
              setActionSheetOpen(false);
              setClearHistoryConfirmOpen(true);
            }}
            isFriendThread={Boolean(activeConversation)}
            onManageGroup={activeGroupConversation ? () => {
              setGroupManageOpen(true);
              setActionSheetOpen(false);
            } : undefined}
            peerBlocked={activePeerBlocked}
            onBlockPeer={() => {
              if (!activeConversation) return;
              void confirmDestructive({
                title: t('mobile.contacts.blockConfirmTitle'),
                description: t('mobile.contacts.blockConfirmBody'),
                confirmLabel: t('mobile.contacts.block'),
                cancelLabel: t('common.action.cancel'),
                onConfirm: async () => {
                  await dispatchBlockUser(activeConversation.peerPtid);
                  setActionSheetOpen(false);
                },
              });
            }}
            onUnblockPeer={() => {
              if (!activeConversation) return;
              void confirm({
                title: t('mobile.contacts.unblockConfirmTitle'),
                description: t('mobile.contacts.unblockConfirmBody'),
                confirmLabel: t('mobile.contacts.unblock'),
                cancelLabel: t('common.action.cancel'),
                onConfirm: async () => { await dispatchUnblockUser(activeConversation.peerPtid); },
              });
            }}
          />

          <MessageActionSheet
            message={selectedActionMessage}
            currentUserPtid={currentUserPtid}
            canEdit={selectedActionCanEdit}
            commandBusy={isChatMessageCommandBusy(selectedActionCommandOutcome)}
            onCopyError={() => setLocalActionError(t('mobile.chat.copyFailed'))}
            onSelect={() => {
              if (!selectedActionMessage) return;
              setSelectionActive(true);
              setSelectedMessageIds([selectedActionMessage.ulid]);
              setMessageActionUlid('');
            }}
            onClose={() => setMessageActionUlid('')}
            onReply={() => {
              if (!selectedActionMessage) return;
              updateReplyContext(selectedActionMessage.ulid);
              setMessageActionUlid('');
            }}
            onForward={() => {
              if (!selectedActionMessage) return;
              setForwardMessageSource({
                conversationId: activeConversationId,
                messageIds: [selectedActionMessage.ulid],
              });
              setMessageActionUlid('');
            }}
            onOpenThread={() => {
              if (selectedActionMessage) openMessageThread(selectedActionMessage);
            }}
            onToggleReaction={(reaction) => {
              if (!selectedActionMessage) return;
              void runChatOperation(
                () => toggleMessageReaction(selectedActionMessage, reaction),
                'mobile.chat.operationReactionFailed',
              );
            }}
            onTogglePin={() => {
              if (!selectedActionMessage) return;
              void runChatOperation(
                () => toggleMessagePin(selectedActionMessage),
                'mobile.chat.operationPinFailed',
              );
            }}
            flagged={selectedActionFlagged}
            flagLabel={t(selectedActionFlagged ? 'mobile.chat.unflagOnDevice' : 'mobile.chat.flagOnDevice')}
            flagLoading={messageFlags.loading}
            onToggleFlag={() => {
              if (!selectedActionMessage) return;
              void runChatOperation(
                async () => {
                  await messageFlags.toggle(selectedActionMessage.ulid);
                  setMessageActionUlid('');
                },
                'mobile.chat.operationLocalFlagFailed',
              );
            }}
            onEdit={() => {
              if (!selectedActionMessage || composerSubmittingRef.current || pendingAttachmentSubmissionRef.current || attachmentUploading) return;
              suspendedComposerRef.current = {
                draft: {
                  text: draftValueRef.current,
                  replyToMessageId: replyToMessageUlidRef.current,
                  encryptedAttachmentRefs: encryptedAttachmentRefsRef.current,
                },
                attachments: attachmentDrafts,
              };
              setAttachmentDrafts([]);
              setEditingMessage({
                kind: isGroupThread ? 'group' : 'friend',
                ulid: selectedActionMessage.ulid,
                content: selectedActionMessage.content,
              });
              replyToMessageUlidRef.current = '';
              encryptedAttachmentRefsRef.current = [];
              setReplyToMessageUlid('');
              setEncryptedAttachmentRefs([]);
              draftValueRef.current = selectedActionMessage.content;
              setDraft(selectedActionMessage.content);
              setMessageActionUlid('');
            }}
            onRecall={() => {
              if (!selectedActionMessage) return;
              const messageUlid = selectedActionMessage.ulid;
              setMessageActionUlid('');
              void runChatOperation(
                () => dispatchRecallMessage(activeConversationId, messageUlid),
                'mobile.chat.operationRecallFailed',
              );
            }}
            onHideForMe={() => {
              if (!selectedActionMessage) return;
              const messageUlid = selectedActionMessage.ulid;
              setMessageActionUlid('');
              void confirmDestructive({
                title: t('mobile.chat.deleteForMeConfirmTitle'),
                description: t('mobile.chat.deleteForMeConfirmBody'),
                confirmLabel: t('mobile.chat.deleteForMe'),
                cancelLabel: t('common.action.cancel'),
                onConfirm: () => runChatOperation(
                  () => dispatchHideMessageForMe(
                    isGroupThread ? 'group' : 'friend',
                    activeConversationId,
                    messageUlid,
                  ),
                  'mobile.chat.operationHideFailed',
                ),
              });
            }}
            canModerate={isGroupThread && canManageGroupMembers}
            onModerate={() => {
              if (!selectedActionMessage || !isGroupThread) return;
              const messageUlid = selectedActionMessage.ulid;
              setMessageActionUlid('');
              void confirmDestructive({
                title: t('mobile.chat.moderateConfirmTitle'),
                description: t('mobile.chat.moderateConfirmBody'),
                confirmLabel: t('mobile.chat.moderate'),
                cancelLabel: t('common.action.cancel'),
                onConfirm: () => runChatOperation(
                  () => dispatchModerateMessage(
                    activeConversationId,
                    messageUlid,
                    'group_policy_violation',
                  ),
                  'mobile.chat.operationModerateFailed',
                ),
              });
            }}
          />

          <ForwardMessageSheet
            open={Boolean(forwardMessageSource)}
            destinations={forwardDestinations}
            pendingDestinationId={forwardPendingDestinationId}
            error={forwardError}
            onClose={() => {
              if (!forwardPendingDestinationId) {
                setForwardMessageSource(null);
                setForwardError('');
              }
            }}
            onSelect={(destination) => {
              void forwardSelectedMessage(destination);
            }}
          />

          <ChatDestructiveConfirmSheet
            open={clearHistoryConfirmOpen}
            busy={clearHistoryBusy}
            onCancel={() => {
              if (!clearHistoryBusy) setClearHistoryConfirmOpen(false);
            }}
            onConfirm={() => {
              void clearConversationData();
            }}
          />

          {activeGroupConversation ? (
            <GroupManagementModal
              open={groupManageOpen}
              onClose={() => setGroupManageOpen(false)}
              conversation={activeGroupConversation.projection}
              members={groupMembers}
              myRole={myGroupRole}
              canManage={canManageGroupMembers}
              groupNameDraft={groupNameDraft}
              setGroupNameDraft={setGroupNameDraft}
              groupDescriptionDraft={groupDescriptionDraft}
              setGroupDescriptionDraft={setGroupDescriptionDraft}
              conversationSettings={friendConversationSettings[activeConversationId]}
              groupCommandOutcomes={groupCommandOutcomes}
              inviteCandidates={groupInviteCandidates}
              peerProfiles={peerProfiles}
              currentUserPtid={currentUserPtid}
              onSaveGroup={(name, description) => dispatchGroupUpdate(
                activeConversationId,
                { name, description },
              )}
              onUpdateMySettings={(patch) => updateFriendConversationSettings(
                activeConversationId,
                patch,
              )}
              onUpdateMemberRole={(memberPtid, role) => dispatchGroupUpdateMember(
                activeConversationId,
                memberPtid,
                { role },
              )}
              onTransferOwnership={(memberPtid) => dispatchGroupTransferOwnership(
                activeConversationId,
                memberPtid,
              )}
              onToggleMemberMuted={(memberPtid, muted) => dispatchGroupUpdateMember(
                activeConversationId,
                memberPtid,
                { muted },
              )}
              onRemoveMember={(memberPtid) => dispatchGroupRemoveMember(
                activeConversationId,
                memberPtid,
              )}
              onInviteMember={(memberPtid) => dispatchGroupInviteMember(
                activeConversationId,
                memberPtid,
              )}
              onDissolveGroup={async () => {
                await dispatchGroupDissolve(activeConversationId);
              }}
              onLeaveGroup={async () => {
                await dispatchGroupLeave(activeConversationId);
              }}
            />
          ) : null}
        </ChatOverlayHost>

        {messageFlags.loadFailed ? (
          <MobileNotice>{t('mobile.chat.localFlagUnavailable')}</MobileNotice>
        ) : null}
        {localActionError ? <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice> : null}

        {selectionActive && (
          <ChatMessageSelectionToolbar count={selectedMessageIds.length} busy={selectionBusy}
            onForward={() => setForwardMessageSource({ conversationId: activeConversationId, messageIds: selectedMessageIds })}
            onHide={hideSelectedMessages}
            onCancel={() => { setSelectionActive(false); setSelectedMessageIds([]); }} />
        )}
        <ChatMessageSectionBoundary
          surfaceKey={`messages:${activeConversationKey}:${threadRootMessageUlid}`}
          background={actionState.background}
          messages={threadMessages}
          historyById={history.byId}
          currentUserPtid={currentUserPtid}
          highlightedMessageUlid={highlightedMessageUlid}
          ownAvatar={ownAvatar}
          ownName={ownName}
          peerProfiles={peerProfiles}
          peerMessageAvatar={peerMessageAvatar}
          peerName={activeConversation?.peerName || ''}
          title={title}
          flaggedMessageIds={messageFlags.flaggedMessageIds}
          messageCommandOutcomes={messageCommandOutcomes}
          windowSize={MESSAGE_WINDOW_SIZE}
          controllerRef={messageWindow}
          renderAttachments={(attachments, mine) => (
            <MobileMessageAttachments
              attachments={attachments}
              isOwn={mine}
              session={authSession}
            />
          )}
          renderMetaRow={({
            message,
            deliveryState,
            commandOutcome,
            canRetry,
            recalled,
          }) => (
            <MessageMetaRow
              time={formatRelativeTime(messageTimestampMillis(message), t)}
              edited={Boolean(message.editedAt && !recalled)}
              flaggedOnDevice={messageFlags.flaggedMessageIds.has(message.ulid)}
              deliveryState={deliveryState}
              commandOutcome={commandOutcome}
              canRetry={canRetry}
              canOpenActions={!recalled}
              onRetry={() => {
                void runChatOperation(
                  () => retryFailedMessage(message),
                  'mobile.chat.operationRetryFailed',
                );
              }}
              onOpenActions={() => {
                setMessageActionUlid(message.ulid);
                void refreshFriendMessageCommandOutcomes();
              }}
            />
          )}
          onScrollToMessage={(messageUlid) => { void scrollToMessage(messageUlid); }}
          onToggleReaction={(message, reaction) => {
            void runChatOperation(
              () => toggleMessageReaction(message, reaction),
              'mobile.chat.operationReactionFailed',
            );
          }}
          onOpenActions={message => {
            setMessageActionUlid(message.ulid);
            void refreshFriendMessageCommandOutcomes();
          }}
          selectionActive={selectionActive}
          selectedIds={new Set(selectedMessageIds)}
          onToggleSelection={toggleSelectedMessage}
        />

        {activePeerBlocked ? (
          <footer className="message-composer readonly">
            <div
              className="message-composer-input-panels"
              ref={chatBottomOcclusion.inputPanelRef}
            />
            <div
              className="message-composer-surface readonly"
              ref={chatBottomOcclusion.composerRef}
            >
              <Text tone="secondary">{t('mobile.chat.blockedComposer')}</Text>
            </div>
          </footer>
        ) : (
          <MobileChatComposer
            key={activeConversationKey}
            draft={draft}
            placeholder={t(threadRootMessageUlid ? 'mobile.chat.threadReplyPlaceholder' : 'mobile.chat.messagePlaceholder')}
            inputRef={composerInputRef}
            composerRef={chatBottomOcclusion.composerRef}
            inputPanelRef={chatBottomOcclusion.inputPanelRef}
            inputProps={{
              onFocus: () => setComposerEmojiOpen(false),
              onCompositionStart: () => { composingRef.current = true; },
              onCompositionEnd: () => { composingRef.current = false; lastCompositionEndRef.current = Date.now(); },
              onKeyDown: handleComposerKeyDown,
            }}
            onDraftChange={handleDraftChange}
            onSend={() => void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed')}
            sendDisabledReason={voiceRecorder.recording || composerSubmitting || !canSubmitChatComposerDraft({ text: draft, attachmentCount: readyChatAttachmentStages(attachmentDrafts).length, capabilities: MOBILE_THREAD_COMPOSER_CAPABILITIES }) || attachmentUploading || attachmentStagingFailed || encryptedAttachmentRefs.length > 0 || Boolean(pendingAttachmentSubmission)
              ? t(attachmentStagingFailed ? 'mobile.chat.attachmentRetryBeforeSend' : attachmentUploading || pendingAttachmentSubmission || composerSubmitting ? 'mobile.chat.waitForAttachments' : voiceRecorder.recording ? 'mobile.chat.finishVoiceBeforeSend' : 'chat.social.composer.sendDisabled')
              : undefined}
            sending={composerSubmitting || attachmentUploading || Boolean(pendingAttachmentSubmission)}
            toolsDisabled={voiceRecorder.recording || composerSubmitting || attachmentUploading || Boolean(editingMessage) || Boolean(pendingAttachmentSubmission)}
            inputDisabled={voiceRecorder.recording || composerSubmitting || Boolean(pendingAttachmentSubmission)}
            editing={Boolean(editingMessage)}
            keyboardOpen={chatBottomOcclusion.keyboardOverlapHeight > 0}
            title={headerTitle}
            context={editingMessage
              ? { text: t('mobile.chat.editing'), onCancel: restoreComposerAfterEdit }
              : replyToMessageUlid ? {
                  text: t('mobile.chat.replyingTo', { message: replyTargetMessage ? messageContentForSearch(replyTargetMessage, t) : t('mobile.chat.noPreview') }),
                  onCancel: () => updateReplyContext(''),
                } : undefined}
            recording={voiceRecorder.recording ? {
              seconds: voiceRecorder.recordingSeconds,
              cancel: () => voiceRecorder.stopRecording(true),
              finish: () => voiceRecorder.stopRecording(false),
            } : undefined}
            onChooseFile={openMobileFilePicker}
            onTakePhoto={openMobileCamera}
            onRecordVoice={startVoiceRecording}
            emojiOpen={composerEmojiOpen}
            onEmojiOpenChange={setComposerEmojiOpen}
            recentEmojis={recentEmojis}
            onEmojiUsed={rememberEmoji}
            attachments={attachmentDrafts.length > 0 || encryptedAttachmentRefs.length > 0 ? (
                <div
                  className="message-composer-panel attachment-draft-panel"
                  data-product-surface={attachmentUploading
                    ? 'chat.attachment-uploading'
                    : attachmentStagingFailed
                      ? 'chat.attachment-failed'
                      : 'chat.attachment-ready'}
                >
                  {attachmentDrafts.map((item) => (
                    <AttachmentDraftChip
                      key={item.id}
                      draft={item}
                      disabled={Boolean(pendingAttachmentSubmission)}
                      onRetry={() => { void retryAttachmentDraft(item.id); }}
                      onRemove={() => { void removeAttachmentDraft(item.id); }}
                    />
                  ))}
                  {attachmentDrafts.length === 0
                    ? encryptedAttachmentRefs.map((reference) => (
                        <EncryptedAttachmentReferenceChip
                          key={reference}
                          disabled={Boolean(pendingAttachmentSubmission)}
                          onRemove={() => updateEncryptedAttachmentRefs(
                            encryptedAttachmentRefs.filter(
                              (candidate) => candidate !== reference,
                            ),
                          )}
                        />
                      ))
                    : null}
                  {attachmentUploading ? <Spin size="small" /> : null}
                  {pendingAttachmentSubmission ? <Text tone="secondary">{t('chat.social.messageArea.attachmentStateDownloading')}</Text> : null}
                  {attachmentDrafts.length === 0 && encryptedAttachmentRefs.length > 0
                    ? <Text tone="secondary">{t('mobile.chat.retryAttachmentUnavailable')}</Text>
                    : null}
                </div>
              ) : null}
            nativePickers={<>
              <input ref={fileInputRef} className="visually-hidden-file-input" type="file" multiple onChange={e => { void handleMobileFilesSelected(e.target.files); }} />
              <input ref={cameraInputRef} className="visually-hidden-file-input" type="file" accept="image/*" capture="environment" onChange={e => { void handleMobileFilesSelected(e.target.files); }} />
            </>}
          />
        )}

      </ChatThreadPageContent>
    );
  }

  // -----------------------------------------------------------------------
  // Conversation list view
  // -----------------------------------------------------------------------
  return (
    <ChatConversationListPageContent
      query={conversationQuery}
      items={filteredConversationSurfaceItems}
      conversationCount={baseConversations.length}
      loading={loading}
      localError={localActionError}
      socialError={error ? formatSocialError(error) : ''}
      groupError={''}
      onQueryChange={(nextQuery) => {
        setMessageQuery('chats', nextQuery);
      }}
      onDismissLocalError={() => setLocalActionError('')}
      onDismissSocialError={clearSocialError}
      onDismissGroupError={() => undefined}
      onStartConversation={onStartConversation}
      onOpenConversation={openConversation}
      searchEntry={searchEntry}
      listHeader={listHeader}
    />
  );
}

// ---------------------------------------------------------------------------
// Page-owned controller helpers
// ---------------------------------------------------------------------------

function MessageMetaRow({
  time,
  edited,
  flaggedOnDevice,
  deliveryState,
  commandOutcome,
  canRetry,
  canOpenActions,
  onRetry,
  onOpenActions,
}: {
  time: string;
  edited: boolean;
  flaggedOnDevice: boolean;
  deliveryState: MessageDeliveryDisplayState | null;
  commandOutcome?: ChatMessageCommandOutcome;
  canRetry: boolean;
  canOpenActions: boolean;
  onRetry: () => void;
  onOpenActions: () => void;
}) {
  const { t } = useMobileI18n();
  return (
    <span className="message-meta attachment-only-meta message-meta-row">
      {edited ? <span>{t('mobile.chat.edited')}</span> : null}
      {flaggedOnDevice ? (
        <span className="message-local-flag" data-message-local-flag="true">
          <Icon iconId="flag" size={11} />
          <span>{t('mobile.chat.flaggedOnDevice')}</span>
        </span>
      ) : null}
      <span>{time}</span>
      {deliveryState ? (
        <MessageDeliveryStatus
          state={deliveryState}
          canRetry={canRetry}
          onRetry={onRetry}
        />
      ) : null}
      {commandOutcome ? (
        <MessageCommandStatus outcome={commandOutcome} />
      ) : null}
      {canOpenActions ? (
        <button
          type="button"
          className="message-action-button message-overflow-button"
          aria-label={t('mobile.chat.messageActions')}
          onClick={onOpenActions}
        >
          <Icon iconId="more-horizontal" size={13} />
        </button>
      ) : null}
    </span>
  );
}

function MobileMessageAttachments({ attachments, isOwn }: {
  attachments: Array<SocialMessageAttachment>; isOwn: boolean; session: MobileAuthSession | null;
}) {
  return (
    <div className={`mobile-message-attachments ${isOwn ? 'own' : 'peer'}`}>
      {attachments.map((attachment, index) => (
        <MobileMessageAttachmentItem key={`${attachment.cid || attachment.filename}-${index}`} attachment={attachment} />
      ))}
    </div>
  );
}

function formatChatOperationError(error: unknown): string {
  if (error instanceof SocialApiError) return formatSocialError(error);
  return readableErrorMessage(error, 'operation_failed');
}

function formatReleasedBytes(value: bigint): string {
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = bytes / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function revokeObjectUrl(url: string) { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }

function releaseDraftPreview(session: MobileAuthSession | null, draft: MobileChatAttachmentDraft) {
  revokeObjectUrl(draft.previewUrl);
  if (session && draft.previewHandle) {
    void messagingReleaseAttachmentStagePreview({
      ...messagingAccountFromSession(session),
      handle: draft.previewHandle,
    }).catch(() => undefined);
  }
}

function validateSendOutcome(
  outcome: MessagingSubmitCommandResult,
  expectedAttachmentCount: number,
): void {
  if (outcome.attachmentIds.length !== expectedAttachmentCount) {
    throw new Error('mobile.messaging.attachmentCountMismatch');
  }
  if (outcome.state === 'pending' && outcome.commandId && outcome.messageId) return;
  if (expectedAttachmentCount > 0 && outcome.state === 'draft' && outcome.messageId) return;
  throw new Error('mobile.messaging.sendOutcomeInvalid');
}

function isAuthoritativeMessageProjection(
  message: SocialMessage,
  expectedAttachmentIds: string[],
): boolean {
  const state = (message as { messagingState?: string }).messagingState;
  if (!state || !['accepted', 'delivered', 'read', 'committed'].includes(state)) {
    return false;
  }
  const projectedAttachmentIds = chatMessageAttachments(message)
    .map((attachment) => attachment.cid)
    .filter(Boolean);
  return sameStringSet(projectedAttachmentIds, expectedAttachmentIds);
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

function messagingAccountFromSession(session: MobileAuthSession): MessagingAccountInput {
  const actorPtid = session.actorRef.ptid.trim();
  if (!actorPtid) throw new Error('mobile.auth.missingIdentityScope');
  return {
    stationPeerId: session.stationPeerId,
    actorPtid,
  };
}

async function discardStagedAttachments(
  session: MobileAuthSession | null,
  drafts: MobileChatAttachmentDraft[],
): Promise<void> {
  if (!session || drafts.length === 0) return;
  const account = messagingAccountFromSession(session);
  await Promise.all(drafts.flatMap((draft) => (
    draft.attachment
      ? [messagingDiscardAttachmentStage({
          ...account,
          stageId: draft.attachment.stageId,
        })]
      : []
  )));
}
