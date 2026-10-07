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

import { Component, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Input, Modal, Spin, Typography, type InputRef } from 'antd';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ArrowLeft, CornerUpLeft, Flag, FolderOpen, Mic, MoreHorizontal, Phone, Plus, RotateCcw, Scissors, Search, Send, Smile, Square, Video, X } from 'lucide-react';
import { useShallow } from 'zustand/shallow';
import {
  CHAT_COMPOSER_CAPABILITIES_MOBILE_THREAD,
  canSubmitChatComposerDraft,
  canEditChatMessage,
  chatMediaKindForAttachment,
  chatVisualCssVars,
  chatVisualLayoutForSurface,
  formatChatAttachmentSize,
  isRecalledChatMessage,
  shouldSendComposerEnter,
} from '@peers-touch/client-chat-core';

import { useMobileI18n } from '../app/mobileI18n';
import type { MobileChatDetailRoute } from '../app/navigation';
import { readRouteQuery, saveRouteQuery } from '../app/navigation/scrollRestoration';
import { BoundedList, type BoundedListHandle } from '../components/BoundedList';
import { MobileNotice } from '../components/MobileNotice';
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
import {
  isChatMessageCommandBusy,
  type ChatMessageCommandOutcome,
} from '../features/chat/messageCommandState';
import {
  messageProjectionMetadata,
  type MessageDeliveryDisplayState,
} from '../features/chat/messageProjection';
import {
  IDLE_SENDER_TYPING_FEEDBACK,
  beginSenderTypingFeedback,
  dispatchSenderTypingRequest,
  settleSenderTypingFeedback,
} from '../features/chat/typingFeedbackState';
import { useMessageFlagState } from '../features/chat/messageFlagState';
import { useChatHistorySearch } from '../features/chat/useChatHistorySearch';
import { useMobileChatVoiceRecorder } from '../features/chat/useMobileChatVoiceRecorder';
import { mobileCallManager } from '../features/call/callState';
import {
  useConversationListProjection,
  conversationAvatar,
  conversationTitle,
  formatRelativeTime,
  stationHostFromUrl,
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
import {
  chatStorageReleasedBytes,
  mobileChatStorageProjectionRuntime,
} from '../runtimes/chatStorageRuntime';
import {
  messagingDiscardAttachmentStage,
  messagingOpenAttachment,
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
  ComposerToolButton,
  EncryptedAttachmentReferenceChip,
  MessageAttachmentPresentation,
  MessageCommandStatus,
  MessageDeliveryStatus,
} from './chat/ChatMessagePresentation';
import {
  ChatMessageSectionBoundary,
  chatMessageSenderPtids,
  messageContentForSearch,
  messageKey,
} from './chat/ChatMessageSectionBoundary';
import {
  ChatActionSheet,
  ChatOverlayHost,
  ForwardMessageSheet,
  GroupManagementModal,
  MessageActionSheet,
  type MessageForwardDestination,
} from './chat/ChatOverlayHost';
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
import { SenderTypingFeedback } from './chat/SenderTypingFeedback';

const { Text } = Typography;
const TYPING_TRUE_INTERVAL_MS = 3000;
const TYPING_FALSE_DELAY_MS = 4000;
const EMPTY_MESSAGES: SocialMessage[] = [];
const MOBILE_THREAD_COMPOSER_CAPABILITIES = CHAT_COMPOSER_CAPABILITIES_MOBILE_THREAD;
const MOBILE_THREAD_VISUAL_VARS = chatVisualCssVars(chatVisualLayoutForSurface('mobile-thread')) as CSSProperties;
const MOBILE_COMPOSER_EMOJIS = ['😀', '😊', '😂', '😍', '👍', '🙏', '🎉', '🔥', '❤️', '✨', '😭', '🤔'] as const;
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
  messageId: string;
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
  readonly onOpenConversation: (route: MobileChatDetailRoute) => void;
  readonly onBack: () => void;
}

export function ChatPage(props: ChatPageProps) {
  const { t } = useMobileI18n();
  return (
    <ChatMountGuard fallback={(retry) => (
      <section className="mobile-page" data-testid="chat-render-error" role="alert">
        <MobileNotice tone="error">{t('mobile.chat.renderFailed')}</MobileNotice>
        <Button icon={<RotateCcw size={16} />} onClick={retry}>
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
  onOpenConversation,
  onBack,
}: ChatPageProps) {
  const { t } = useMobileI18n();
  const activeSessionUlid = activeDetail?.routeId === 'detail:chat-conversation'
    ? activeDetail.sessionUlid
    : null;
  const activeGroupUlid = activeDetail?.routeId === 'detail:group-conversation'
    ? activeDetail.groupUlid
    : null;

  // --- Local UI state (no business logic) ---
  const [draft, setDraft] = useState('');
  const [conversationQuery, setConversationQuery] = useState(() => readRouteQuery('tab:chat'));
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [composerMoreOpen, setComposerMoreOpen] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<MobileChatAttachmentDraft[]>([]);
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
  const [forwardMessageSource, setForwardMessageSource] = useState<ForwardMessageSource | null>(null);
  const [forwardPendingDestinationId, setForwardPendingDestinationId] = useState('');
  const [localActionError, setLocalActionError] = useState('');
  const [senderTypingFeedback, setSenderTypingFeedback] = useState(
    IDLE_SENDER_TYPING_FEEDBACK,
  );
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
  const searchSession = useSocialStore((s) => s.authSession);
  const historySearch = useChatHistorySearch(
    searchSession, activeGroupUlid ? 'group' : 'friend', activeConversationId,
  );
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
    threadSearchQuery,
  );
  const activeConversationKeyRef = useRef('');
  const chatActionStatesRef = useRef<Record<string, ChatActionState>>({});
  const chatActionStateWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const conversationSettingsAttemptRef = useRef(0);
  const conversationSettingsPendingRef = useRef(false);
  useEffect(() => () => { activeConversationKeyRef.current = ''; }, []);
  const pendingAttachmentSubmissionRef = useRef<PendingComposerSubmission | null>(null);
  const draftValueRef = useRef('');
  const replyToMessageUlidRef = useRef('');
  const encryptedAttachmentRefsRef = useRef<readonly string[]>([]);
  const draftLoadGenerationRef = useRef(0);
  const draftWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const draftPort = useMemo(() => getDraftRestorationPort(), []);
  activeConversationKeyRef.current = activeConversationKey;
  draftValueRef.current = draft;
  replyToMessageUlidRef.current = replyToMessageUlid;
  encryptedAttachmentRefsRef.current = encryptedAttachmentRefs;
  const attachmentUploading = attachmentDrafts.some(
    (attachment) => attachment.status === 'uploading',
  );
  const attachmentStagingFailed = attachmentDrafts.some(
    (attachment) => attachment.status === 'failed',
  );
  const activeInputPanel = chatInputPanelState({
    emojiOpen: composerEmojiOpen,
    attachmentOpen: composerMoreOpen
      || attachmentDrafts.length > 0
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
  const composerInputRef = useRef<InputRef | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCompositionEndRef = useRef(0);
  const lastTypingPulseRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingConversationRef = useRef('');
  const typingAttemptRef = useRef(0);

  const enqueueDraftPersistence = useCallback((
    targetId: string,
    nextDraft: ChatComposerDraft,
  ) => {
    if (!authSession || !targetId) return;
    const stationPeerId = authSession.stationPeerId;
    const actorPtid = authSession.actorRef.ptid;
    draftWriteQueueRef.current = draftWriteQueueRef.current
      .then(async () => {
        if (isChatComposerDraftEmpty(nextDraft)) {
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
          nextDraft,
          Date.now(),
        ));
      })
      .catch((draftError) => {
        setLocalActionError(
          `${t('mobile.recovery.draftRestore.title')}: ${formatChatOperationError(draftError)}`,
        );
      });
  }, [authSession, draftPort, t]);

  useEffect(() => {
    if (selectedConversationId !== (activeConversationId || null)) {
      void selectSession(activeConversationId || null);
    }
  }, [activeConversationId, selectSession, selectedConversationId]);

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
    const loadGeneration = draftLoadGenerationRef.current + 1;
    draftLoadGenerationRef.current = loadGeneration;
    setThreadSearchQuery('');
    setThreadSearchOpen(false);
    setActionSheetOpen(false);
    setGroupManageOpen(false);
    setComposerEmojiOpen(false);
    setComposerMoreOpen(false);
    setEditingMessage(null);
    setReplyToMessageUlid('');
    replyToMessageUlidRef.current = '';
    setEncryptedAttachmentRefs([]);
    encryptedAttachmentRefsRef.current = [];
    setThreadRootMessageUlid('');
    setMessageActionUlid('');
    setForwardMessageSource(null);
    setForwardPendingDestinationId('');
    conversationSettingsAttemptRef.current += 1;
    conversationSettingsPendingRef.current = false;
    setConversationSettingsState(IDLE_CONVERSATION_SETTINGS_FEEDBACK);
    setLocalActionError('');
    setAttachmentDrafts((drafts) => {
      if (!pendingAttachmentSubmissionRef.current) {
        void discardStagedAttachments(authSession, drafts).catch((discardError) => {
          setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(discardError)}`);
        });
      }
      drafts.forEach((item) => revokeObjectUrl(item.previewUrl));
      return [];
    });
    pendingAttachmentSubmissionRef.current = null;
    setPendingAttachmentSubmission(null);
    setDraft('');
    draftValueRef.current = '';

    if (!authSession || !activeConversationId) return;
    const stationPeerId = authSession.stationPeerId;
    const actorPtid = authSession.actorRef.ptid;
    void draftWriteQueueRef.current
      .then(() => draftPort.load(
        stationPeerId,
        actorPtid,
        MobileDraftSurfaceKind.CHAT_COMPOSER,
        activeConversationId,
      ))
      .then((envelope) => {
        const restored = envelope ? readChatDraftEnvelope(envelope) : null;
        if (
          draftLoadGenerationRef.current !== loadGeneration
          || draftValueRef.current
          || replyToMessageUlidRef.current
          || encryptedAttachmentRefsRef.current.length > 0
          || !restored
        ) {
          return;
        }
        draftValueRef.current = restored.text;
        replyToMessageUlidRef.current = restored.replyToMessageId;
        encryptedAttachmentRefsRef.current = restored.encryptedAttachmentRefs;
        setDraft(restored.text);
        setReplyToMessageUlid(restored.replyToMessageId);
        setEncryptedAttachmentRefs([...restored.encryptedAttachmentRefs]);
      })
      .catch((draftError) => {
        if (draftLoadGenerationRef.current !== loadGeneration) return;
        setLocalActionError(
          `${t('mobile.recovery.draftRestore.title')}: ${formatChatOperationError(draftError)}`,
        );
      });
  }, [
    activeConversationId,
    activeSessionUlid,
    authSession,
    draftPort,
    t,
  ]);

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
    attachmentDrafts.forEach((item) => revokeObjectUrl(item.previewUrl));
    setAttachmentDrafts([]);
    if (draftValueRef.current === pendingAttachmentSubmission.submittedText) {
      draftValueRef.current = '';
      replyToMessageUlidRef.current = '';
      encryptedAttachmentRefsRef.current = [];
      setDraft('');
      setReplyToMessageUlid('');
      setEncryptedAttachmentRefs([]);
      enqueueDraftPersistence(activeConversationId, {
        text: '',
        replyToMessageId: '',
        encryptedAttachmentRefs: [],
      });
    }
    pendingAttachmentSubmissionRef.current = null;
    setPendingAttachmentSubmission(null);
  }, [
    activeConversationId,
    attachmentDrafts,
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

  // --- Sender typing feedback ---
  const publishTypingState = useCallback(async (
    conversationId: string,
    typing: boolean,
    retry: boolean = false,
  ) => {
    if (!conversationId) return;
    const request = {
      attempt: typingAttemptRef.current + 1,
      conversationId,
      typing,
    };
    typingAttemptRef.current = request.attempt;
    if (typingConversationRef.current === conversationId) {
      setSenderTypingFeedback(beginSenderTypingFeedback(request, retry));
    }

    const result = await dispatchSenderTypingRequest(request, sendTypingState);
    if (typingConversationRef.current !== conversationId) return;
    setSenderTypingFeedback((current) => (
      settleSenderTypingFeedback(current, result)
    ));
  }, [sendTypingState]);

  const emitTypingState = useCallback((
    typing: boolean,
    retry: boolean = false,
  ) => publishTypingState(activeConversationId, typing, retry), [
    activeConversationId,
    publishTypingState,
  ]);

  useEffect(() => {
    typingConversationRef.current = activeConversationId;
    typingAttemptRef.current += 1;
    setSenderTypingFeedback(IDLE_SENDER_TYPING_FEEDBACK);
    return () => {
      if (typingIdleTimerRef.current) { window.clearTimeout(typingIdleTimerRef.current); typingIdleTimerRef.current = null; }
      if (lastTypingPulseRef.current > 0 && typingConversationRef.current) {
        const request = {
          attempt: typingAttemptRef.current + 1,
          conversationId: typingConversationRef.current,
          typing: false,
        };
        typingAttemptRef.current = request.attempt;
        void dispatchSenderTypingRequest(request, sendTypingState);
      }
      lastTypingPulseRef.current = 0;
      typingConversationRef.current = '';
    };
  }, [activeConversationId, sendTypingState]);

  const retryTypingState = useCallback(() => {
    if (
      senderTypingFeedback.phase !== 'failed'
      || senderTypingFeedback.request.conversationId !== activeConversationId
    ) {
      return;
    }
    void publishTypingState(
      senderTypingFeedback.request.conversationId,
      senderTypingFeedback.request.typing,
      true,
    );
  }, [activeConversationId, publishTypingState, senderTypingFeedback]);

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

  const clearAttachmentDrafts = useCallback(() => {
    pendingAttachmentSubmissionRef.current = null;
    setPendingAttachmentSubmission(null);
    setAttachmentDrafts((drafts) => {
      drafts.forEach((item) => revokeObjectUrl(item.previewUrl));
      return [];
    });
  }, []);

  const clearComposerDraftAfterEdit = useCallback(() => {
    draftValueRef.current = '';
    replyToMessageUlidRef.current = '';
    encryptedAttachmentRefsRef.current = [];
    setEditingMessage(null);
    setDraft('');
    setReplyToMessageUlid('');
    setEncryptedAttachmentRefs([]);
    enqueueDraftPersistence(activeConversationId, {
      text: '',
      replyToMessageId: '',
      encryptedAttachmentRefs: [],
    });
  }, [activeConversationId, enqueueDraftPersistence]);

  const applySendOutcome = useCallback((
    conversationId: string,
    submittedText: string,
    attachments: MessagingAttachmentStageProjection[],
    outcome: MessagingSubmitCommandResult,
    context: ChatMessageSendContext,
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
    encryptedAttachmentRefsRef.current = outcome.attachmentIds;
    setEncryptedAttachmentRefs(outcome.attachmentIds);
    setAttachmentDrafts((drafts) => (
      markChatAttachmentDraftsSubmitted(drafts)
    ));
    enqueueDraftPersistence(conversationId, {
      text: submittedText,
      replyToMessageId: context.replyToMessageId ?? '',
      encryptedAttachmentRefs: outcome.attachmentIds,
    });
    pendingAttachmentSubmissionRef.current = submission;
    setPendingAttachmentSubmission(submission);
  }, [enqueueDraftPersistence]);

  const submitMessage = useCallback(async () => {
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
    await emitTypingState(false);

    const activeKind = activeGroupConversation ? 'group' : 'friend';
    if (editingMessage?.kind === activeKind) {
      await dispatchEditMessage(activeConversationId, editingMessage.ulid, draft);
      clearComposerDraftAfterEdit();
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
      );
    }
  }, [activeConversation, activeConversationId, activeGroupConversation, applySendOutcome, attachmentDrafts, attachmentStagingFailed, attachmentUploading, clearComposerDraftAfterEdit, draft, editingMessage, emitTypingState, encryptedAttachmentRefs.length, friendshipStatus, replyToMessageUlid, t, threadRootMessageUlid]);

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
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
      revokeObjectUrl(removed.previewUrl);
      setAttachmentDrafts((drafts) => drafts.filter((item) => item.id !== id));
      if (encryptedAttachmentRefsRef.current.length > 0) {
        updateEncryptedAttachmentRefs([]);
      }
    } catch (discardError) {
      setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(discardError)}`);
    }
  };

  const openMobileFilePicker = () => {
    if (editingMessage || attachmentUploading || pendingAttachmentSubmission) return;
    setComposerMoreOpen(false);
    fileInputRef.current?.click();
  };

  const stageAttachmentDraft = async (
    item: MobileChatAttachmentDraft,
    uploadConversationKey: string,
  ) => {
    if (!authSession) return;
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
        ...messagingAccountFromSession(authSession),
        file: item.file,
        voiceNote: item.voiceNote,
      });
      if (uploadConversationKey !== activeConversationKeyRef.current) {
        await discardStagedAttachments(authSession, [{
          ...item,
          attachment,
          status: 'ready',
        }]);
        setAttachmentDrafts((drafts) => drafts.filter(
          (candidate) => candidate.id !== item.id,
        ));
        revokeObjectUrl(item.previewUrl);
        return;
      }
      setAttachmentDrafts((drafts) => patchChatAttachmentDraft(
        drafts,
        item.id,
        { status: 'ready', attachment },
      ));
    } catch (uploadError) {
      setAttachmentDrafts((drafts) => patchChatAttachmentDraft(
        drafts,
        item.id,
        { status: 'failed', attachment: undefined },
      ));
      setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(uploadError)}`);
    }
  };

  const retryAttachmentDraft = async (id: string) => {
    if (pendingAttachmentSubmission || attachmentUploading) return;
    const retry = attachmentDrafts.find((item) => item.id === id);
    if (!retry || retry.status !== 'failed') return;
    if (encryptedAttachmentRefsRef.current.length > 0) {
      updateEncryptedAttachmentRefs([]);
    }
    await stageAttachmentDraft(retry, activeConversationKey);
  };

  const handleMobileFilesSelected = async (files: FileList | null) => {
    if (!files?.length || !authSession) return;
    const conversationId = activeGroupUlid || activeSessionUlid || '';
    const uploadConversationKey = activeConversationKey;
    if (!conversationId) return;
    setLocalActionError('');
    try {
      const selected = Array.from(files).map((file) => ({
        id: globalThis.crypto.randomUUID(),
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
        id: globalThis.crypto.randomUUID(),
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
    setComposerMoreOpen(false);
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
      Modal.success({
        title: t('mobile.chat.clearHistorySuccessTitle'),
        content: (
          <span
            data-chat-conversation-clear-result="succeeded"
            data-chat-storage-released-bytes={releasedBytes.toString()}
          >
            {t('mobile.chat.clearHistorySuccessBody', {
              bytes: formatReleasedBytes(releasedBytes),
            })}
          </span>
        ),
      });
    } catch (error) {
      setLocalActionError(formatChatOperationError(error));
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
    setThreadSearchOpen(false);
    setThreadSearchQuery('');
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
    setLocalActionError('');
    setForwardPendingDestinationId(destination.conversationId);
    try {
      await dispatchForwardMessage(
        authSession,
        destination.kind,
        forwardMessageSource.conversationId,
        forwardMessageSource.messageId,
        destination.conversationId,
      );
      setForwardMessageSource(null);
    } catch (operationError) {
      setLocalActionError(
        `${t('mobile.chat.operationForwardFailed')}: ${formatChatOperationError(operationError)}`,
      );
    } finally {
      setForwardPendingDestinationId('');
    }
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
    const stationName = stationHostFromUrl(authSession?.stationUrl);
    const conversationSubtitle = peerTyping
      ? t('mobile.chat.typing')
      : activeGroupConversation
        ? t('mobile.group.memberCount', {
            count: activeGroupConversation.projection.memberPtids.length,
          })
        : t('mobile.chat.peerAtStation', { station: stationName });

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

    const submittedSearch = historySearch.query === threadSearchQuery.trim() && historySearch.query !== '';
    const threadSearchResults = submittedSearch
      ? (historySearch.page?.messages ?? [])
      : history.searchResults;

    return (
      <ChatThreadPageContent
        activeInputPanel={chatBottomOcclusion.activePanel}
        keyboardOverlapHeight={chatBottomOcclusion.keyboardOverlapHeight}
        style={chatThreadStyle}
        tabBarVisible={chatBottomOcclusion.tabBarVisible}
      >
        <header className={`page-header chat-thread-header ${threadSearchOpen ? 'searching' : ''}`}>
          <button className="header-action" type="button" onClick={() => {
            if (threadRootMessageUlid) {
              setThreadRootMessageUlid('');
              updateReplyContext('');
              setMessageActionUlid('');
              return;
            }
            onBack();
          }} aria-label={t('common.action.back')}>
            <ArrowLeft size={20} />
          </button>
          {threadSearchOpen ? (
            <>
              <Input.Search className="chat-header-search" value={threadSearchQuery} onChange={(e) => { setThreadSearchQuery(e.target.value); historySearch.clear(); }} prefix={<Search size={16} />} placeholder={t('mobile.chat.searchMessagesPlaceholder')} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} allowClear loading={historySearch.loading} onSearch={historySearch.search} />
              <button className="header-action" type="button" onClick={() => { setThreadSearchOpen(false); setThreadSearchQuery(''); historySearch.clear(); }} aria-label={t('common.action.cancel')}><X size={18} /></button>
            </>
          ) : (
            <>
              <div className="header-title-stack">
                <h1 className="header-title compact">{headerTitle}</h1>
                <Text type="secondary">{subtitle}</Text>
              </div>
              {!threadRootMessageUlid ? (
                <div className="chat-header-actions">
                  {activeConversation && !activePeerBlocked ? (
                    <>
                      <button
                        className="header-action"
                        type="button"
                        onClick={() => {
                          void runChatOperation(
                            () => mobileCallManager.startOutgoingCall(
                              activeConversation.peerPtid,
                              'audio',
                            ),
                            'mobile.call.operationFailed',
                          );
                        }}
                        aria-label={t('mobile.call.startAudio')}
                      >
                        <Phone size={19} />
                      </button>
                      <button
                        className="header-action"
                        type="button"
                        onClick={() => {
                          void runChatOperation(
                            () => mobileCallManager.startOutgoingCall(
                              activeConversation.peerPtid,
                              'video',
                            ),
                            'mobile.call.operationFailed',
                          );
                        }}
                        aria-label={t('mobile.call.startVideo')}
                      >
                        <Video size={20} />
                      </button>
                    </>
                  ) : null}
                  <button className="header-action" type="button" onClick={() => setActionSheetOpen(true)} aria-label={t('mobile.chat.moreActions')}><MoreHorizontal size={20} /></button>
                </div>
              ) : null}
            </>
          )}
        </header>

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
            onSearch={() => { setThreadSearchOpen(true); setActionSheetOpen(false); }}
            onToggleMute={() => { void updateChatActionState(activeKey, { muted: !actionState.muted }); }}
            onToggleSticky={() => { void updateChatActionState(activeKey, { sticky: !actionState.sticky }); }}
            onToggleAlert={() => { void updateChatActionState(activeKey, { alertEnabled: !actionState.alertEnabled }); }}
            onSelectBackground={(bg) => { void updateChatActionState(activeKey, { background: bg }); }}
            onClearHistory={() => {
              Modal.confirm({
                title: t('mobile.chat.clearHistoryConfirmTitle'), content: t('mobile.chat.clearHistoryConfirmBody'),
                okText: t('mobile.chat.quickClearHistory'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
                onOk: clearConversationData,
              });
            }}
            isFriendThread={Boolean(activeConversation)}
            onManageGroup={activeGroupConversation ? () => {
              setGroupManageOpen(true);
              setActionSheetOpen(false);
            } : undefined}
            peerBlocked={activePeerBlocked}
            onBlockPeer={() => {
              if (!activeConversation) return;
              Modal.confirm({
                title: t('mobile.contacts.blockConfirmTitle'), content: t('mobile.contacts.blockConfirmBody'),
                okText: t('mobile.contacts.block'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
                onOk: async () => { await dispatchBlockUser(activeConversation.peerPtid); setActionSheetOpen(false); },
              });
            }}
            onUnblockPeer={() => {
              if (!activeConversation) return;
              Modal.confirm({
                title: t('mobile.contacts.unblockConfirmTitle'), content: t('mobile.contacts.unblockConfirmBody'),
                okText: t('mobile.contacts.unblock'), cancelText: t('common.action.cancel'),
                onOk: async () => { await dispatchUnblockUser(activeConversation.peerPtid); },
              });
            }}
          />

          <MessageActionSheet
            message={selectedActionMessage}
            currentUserPtid={currentUserPtid}
            canEdit={selectedActionCanEdit}
            commandBusy={isChatMessageCommandBusy(selectedActionCommandOutcome)}
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
                messageId: selectedActionMessage.ulid,
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
              if (!selectedActionMessage) return;
              clearAttachmentDrafts();
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
              Modal.confirm({
                title: t('mobile.chat.deleteForMeConfirmTitle'),
                content: t('mobile.chat.deleteForMeConfirmBody'),
                okText: t('mobile.chat.deleteForMe'),
                cancelText: t('common.action.cancel'),
                okButtonProps: { danger: true },
                onOk: () => runChatOperation(
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
              Modal.confirm({
                title: t('mobile.chat.moderateConfirmTitle'),
                content: t('mobile.chat.moderateConfirmBody'),
                okText: t('mobile.chat.moderate'),
                cancelText: t('common.action.cancel'),
                okButtonProps: { danger: true },
                onOk: () => runChatOperation(
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
            onClose={() => {
              if (!forwardPendingDestinationId) setForwardMessageSource(null);
            }}
            onSelect={(destination) => {
              void forwardSelectedMessage(destination);
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

        {threadSearchQuery.trim() ? (
          <section className="message-search-panel">
            {submittedSearch && historySearch.loading ? <Spin /> : submittedSearch && historySearch.error ? (
              <MobileNotice tone="error">
                {t('mobile.chat.searchFailed')}
                <Button icon={<RotateCcw size={14} />} onClick={historySearch.retry}>{t('common.action.retry')}</Button>
              </MobileNotice>
            ) : threadSearchResults.length > 0 ? (
              <BoundedList surfaceKey={`search:${activeConversationKey}:${threadSearchQuery}:${historySearch.index}`} items={threadSearchResults as SocialMessage[]} itemKey={messageKey}>
              {(rows) => rows.map((msg) => (
                <button className="message-search-result" data-scroll-anchor-id={msg.ulid} type="button" key={msg.ulid} onClick={() => {
                  setThreadSearchOpen(false);
                  setThreadSearchQuery('');
                  historySearch.clear();
                  void scrollToMessage(msg.ulid);
                }}>
                  <Text ellipsis>{messageContentForSearch(msg, t)}</Text>
                  <Text type="secondary">{formatRelativeTime(messageTimestampMillis(msg), t)}</Text>
                </button>
              ))}</BoundedList>
            ) : <Text type="secondary">{t('mobile.chat.noMessageResults')}</Text>}
            {submittedSearch && !historySearch.loading ? (
              <div className="bounded-list-controls">
                {historySearch.index > 0 ? <Button onClick={historySearch.previous}>{t('mobile.list.previous')}</Button> : null}
                {historySearch.page?.nextCursor ? <Button onClick={historySearch.next}>{t('mobile.list.next')}</Button> : null}
              </div>
            ) : null}
          </section>
        ) : null}

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
              <Text type="secondary">{t('mobile.chat.blockedComposer')}</Text>
            </div>
          </footer>
        ) : (
          <footer className="message-composer">
            <div
              className="message-composer-input-panels"
              ref={chatBottomOcclusion.inputPanelRef}
            >
              {composerEmojiOpen ? (
                <div className="message-composer-panel emoji-panel">
                  {MOBILE_COMPOSER_EMOJIS.map((emoji) => (
                    <button key={emoji} type="button" className="composer-emoji-button" aria-label={t('mobile.chat.composerEmoji')} onClick={() => { handleDraftChange(`${draftValueRef.current}${emoji}`); setComposerEmojiOpen(false); }}>{emoji}</button>
                  ))}
                </div>
              ) : null}
              {composerMoreOpen ? (
                <div className="message-composer-panel more-panel">
                  <ComposerToolButton icon={<FolderOpen size={16} />} label={t('mobile.chat.composerFile')} onClick={openMobileFilePicker} disabled={attachmentUploading || Boolean(editingMessage) || Boolean(pendingAttachmentSubmission)} />
                  <ComposerToolButton icon={<Scissors size={16} />} label={t('mobile.chat.composerScreenshot')} onClick={() => { setLocalActionError(t('mobile.chat.composerUnavailable')); setComposerMoreOpen(false); }} />
                  <ComposerToolButton icon={<Mic size={16} />} label={t('mobile.chat.composerVoice')} onClick={startVoiceRecording} disabled={attachmentUploading || Boolean(editingMessage) || Boolean(pendingAttachmentSubmission)} />
                </div>
              ) : null}
              {voiceRecorder.recording ? (
                <div className="message-composer-panel voice-recording-panel">
                  <span className="voice-recording-status">
                    <span className="voice-recording-dot" />
                    <Text>{t('chat.social.composer.recording', { seconds: voiceRecorder.recordingSeconds })}</Text>
                  </span>
                  <span className="voice-recording-actions">
                    <Button size="small" icon={<X size={13} />} onClick={() => voiceRecorder.stopRecording(true)}>
                      {t('chat.social.composer.cancelRecord')}
                    </Button>
                    <Button size="small" type="primary" icon={<Square size={13} />} onClick={() => voiceRecorder.stopRecording(false)}>
                      {t('chat.social.composer.finishRecord')}
                    </Button>
                  </span>
                </div>
              ) : null}
              {attachmentDrafts.length > 0 || encryptedAttachmentRefs.length > 0 ? (
                <div className="message-composer-panel attachment-draft-panel">
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
                  {pendingAttachmentSubmission ? <Text type="secondary">{t('chat.social.messageArea.attachmentStateDownloading')}</Text> : null}
                  {attachmentDrafts.length === 0 && encryptedAttachmentRefs.length > 0
                    ? <Text type="secondary">{t('mobile.chat.retryAttachmentUnavailable')}</Text>
                    : null}
                </div>
              ) : null}
            </div>
            <div
              className="message-composer-surface"
              ref={chatBottomOcclusion.composerRef}
            >
              {editingMessage ? (
                <div className="message-editing-banner">
                  <Text type="secondary" ellipsis>{t('mobile.chat.editing')}</Text>
                  <button type="button" className="message-action-button light" onClick={() => { setEditingMessage(null); handleDraftChange(''); }} aria-label={t('common.action.cancel')}><X size={13} /></button>
                </div>
              ) : null}
              {!editingMessage && replyToMessageUlid ? (
                <div className="message-editing-banner message-reply-context">
                  <CornerUpLeft size={14} />
                  <Text type="secondary" ellipsis>
                    {t('mobile.chat.replyingTo', {
                      message: replyTargetMessage
                        ? messageContentForSearch(replyTargetMessage, t)
                        : t('mobile.chat.noPreview'),
                    })}
                  </Text>
                  <button type="button" className="message-action-button light" onClick={() => updateReplyContext('')} aria-label={t('common.action.cancel')}><X size={13} /></button>
                </div>
              ) : null}
              <SenderTypingFeedback
                feedback={senderTypingFeedback}
                onRetry={retryTypingState}
              />
              <input ref={fileInputRef} className="visually-hidden-file-input" type="file" multiple onChange={(e) => { void handleMobileFilesSelected(e.target.files); }} />
              <div className="message-composer-row">
                {MOBILE_THREAD_COMPOSER_CAPABILITIES.emoji ? (
                  <button type="button" className={`message-composer-tool ${composerEmojiOpen ? 'active' : ''}`} aria-label={t('mobile.chat.composerEmoji')} onClick={() => { composerInputRef.current?.blur(); setComposerEmojiOpen((o) => !o); setComposerMoreOpen(false); }} disabled={voiceRecorder.recording || Boolean(pendingAttachmentSubmission)}><Smile size={18} /></button>
                ) : null}
                <Input ref={composerInputRef} className="message-composer-input" value={draft} onChange={(e) => handleDraftChange(e.target.value)}
                  onFocus={() => { setComposerEmojiOpen(false); setComposerMoreOpen(false); }}
                  onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; lastCompositionEndRef.current = Date.now(); }}
                  onKeyDown={handleComposerKeyDown} placeholder={t(threadRootMessageUlid ? 'mobile.chat.threadReplyPlaceholder' : 'mobile.chat.messagePlaceholder')} disabled={voiceRecorder.recording || Boolean(pendingAttachmentSubmission)} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
                <button type="button" className={`message-composer-tool ${composerMoreOpen ? 'active' : ''}`} aria-label={t('mobile.chat.composerMore')} onClick={() => { composerInputRef.current?.blur(); setComposerMoreOpen((o) => !o); setComposerEmojiOpen(false); }} disabled={voiceRecorder.recording || Boolean(editingMessage) || Boolean(pendingAttachmentSubmission)}><Plus size={18} /></button>
                <Button className="message-send-button" type="primary" icon={<Send size={16} />}
                  disabled={voiceRecorder.recording || !canSubmitChatComposerDraft({ text: draft, attachmentCount: readyChatAttachmentStages(attachmentDrafts).length, capabilities: MOBILE_THREAD_COMPOSER_CAPABILITIES }) || attachmentUploading || attachmentStagingFailed || encryptedAttachmentRefs.length > 0 || Boolean(pendingAttachmentSubmission)}
                  loading={attachmentUploading || Boolean(pendingAttachmentSubmission)}
                  onClick={() => void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed')} />
              </div>
            </div>
          </footer>
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
        setConversationQuery(nextQuery);
        saveRouteQuery('tab:chat', nextQuery);
      }}
      onDismissLocalError={() => setLocalActionError('')}
      onDismissSocialError={clearSocialError}
      onDismissGroupError={() => undefined}
      onOpenConversation={openConversation}
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
          <Flag size={11} />
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
          <MoreHorizontal size={13} />
        </button>
      ) : null}
    </span>
  );
}

function MobileMessageAttachments({ attachments, isOwn, session }: {
  attachments: Array<SocialMessageAttachment>; isOwn: boolean; session: MobileAuthSession | null;
}) {
  return (
    <div className={`mobile-message-attachments ${isOwn ? 'own' : 'peer'}`}>
      {attachments.map((attachment, index) => (
        <MobileMessageAttachmentItem key={`${attachment.cid || attachment.filename}-${index}`} attachment={attachment} session={session} />
      ))}
    </div>
  );
}

function MobileMessageAttachmentItem({ attachment, session }: { attachment: SocialMessageAttachment; session: MobileAuthSession | null }) {
  const { t } = useMobileI18n();
  const [sourceUrl, setSourceUrl] = useState('');
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'pending' | 'failed' | 'ready'>('idle');
  const kind = chatMediaKindForAttachment(attachment);
  const filename = attachment.filename || t('mobile.chat.attachmentUnnamed');
  const sizeLabel = formatChatAttachmentSize(Number(attachment.size ?? 0));

  const loadAttachment = useCallback(async (openWhenReady: boolean) => {
    if (!session || !attachment.cid) return;
    setLoadState('loading');
    try {
      const result = await messagingOpenAttachment({
        ...messagingAccountFromSession(session),
        attachmentId: attachment.cid,
      });
      if (result.state === 'pending') {
        setLoadState('pending');
        return;
      }
      const url = convertFileSrc(result.localPath);
      setSourceUrl(url);
      setLoadState('ready');
      if (openWhenReady && kind !== 'audio') window.open(url, '_blank');
    } catch {
      setLoadState('failed');
    }
  }, [attachment.cid, kind, session]);

  useEffect(() => {
    if (!['image', 'audio'].includes(kind) || !session || !attachment.cid) return undefined;
    void loadAttachment(false);
    return undefined;
  }, [attachment.cid, attachmentAvailabilityState(attachment), kind, loadAttachment, session]);

  const openAttachment = () => {
    if (sourceUrl) {
      window.open(sourceUrl, '_blank');
      return;
    }
    void loadAttachment(true);
  };
  const stateLabel = loadState === 'loading' || loadState === 'pending'
    ? t('chat.social.messageArea.attachmentStateDownloading')
    : loadState === 'failed'
      ? t('chat.social.messageArea.attachmentDownloadFailed')
      : formatVoiceDuration(attachment.voiceNote?.durationMs) || sizeLabel || attachment.mimeType;

  return (
    <MessageAttachmentPresentation
      attachmentId={attachment.cid}
      kind={kind}
      filename={filename}
      stateLabel={stateLabel}
      sourceUrl={sourceUrl}
      voiceDurationLabel={formatVoiceDuration(attachment.voiceNote?.durationMs)}
      disabled={!session || !attachment.cid || loadState === 'loading'}
      onOpen={openAttachment}
    />
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

function revokeObjectUrl(url: string) { if (url) URL.revokeObjectURL(url); }

function formatVoiceDuration(durationMs: number | undefined): string {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return '';
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
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

function attachmentAvailabilityState(
  attachment: SocialMessageAttachment,
): 'remote' | 'local' | undefined {
  return (attachment as { availabilityState?: 'remote' | 'local' }).availabilityState;
}
