/**
 * ChatPage.tsx — Pure renderer for the chat tab.
 *
 * W6A contract: this page renders narrow selectors and dispatches typed
 * commands only.  It owns no data-fetching side effects, no business
 * logic, and no direct store mutations.  All visible text uses i18n.
 *
 * Virtualization: conversation and message lists use bounded windowing
 * to preserve scroll anchors and keep DOM node count stable.
 */

import { Component, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Badge, Button, Empty, Input, List, Modal, Spin, Switch, Tag, Typography } from 'antd';
import { convertFileSrc } from '@tauri-apps/api/core';
import { ArrowLeft, Ban, Bell, BellOff, Check, CheckCheck, FolderOpen, Image, Mic, MoreHorizontal, Paperclip, Pencil, Pin, Plus, RotateCcw, Scissors, Search, Send, Smile, Trash2, Users, VolumeX, X } from 'lucide-react';
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
import { MobileAvatar } from '../components/MobileAvatar';
import { MobileNotice } from '../components/MobileNotice';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import { CHAT_BACKGROUND_OPTIONS, type ChatBackgroundId } from '../features/social/socialApiTypes';
import {
  chatActionKey,
  defaultChatActionState,
  loadChatActionStates,
  saveChatActionStates,
  type ChatActionState,
} from '../features/chat/chatActionState';
import {
  dispatchSendMessage,
  dispatchEditMessage,
  dispatchRecallMessage,
  dispatchBlockUser,
  dispatchUnblockUser,
  dispatchGroupSendMessage,
  dispatchGroupEditMessage,
  dispatchGroupRecallMessage,
  dispatchGroupUpdate,
  dispatchGroupInviteMembers,
  dispatchGroupLeave,
  dispatchGroupRemoveMember,
  dispatchGroupUpdateMember,
  dispatchGroupTransferOwnership,
  dispatchGroupDissolve,
  friendPatchFromActionPatch,
  groupPatchFromActionPatch,
} from '../features/chat/chatCommands';
import {
  useConversationListProjection,
  conversationTitle,
  conversationAvatar,
  conversationPreview,
  formatRelativeTime,
  stationHostFromUrl,
  friendSettingsToActionState,
  groupSettingsToActionState,
  messageTimestampMillis,
  friendMessageDisplayText,
  groupMessageDisplayText,
  chatMessageAttachments,
  isOwnChatMessage,
  localThreadSearchResults,
  conversationPreferenceState,
  type MobileConversation,
} from '../features/chat/chatSelectors';
import { getMobileGroupMemberControlState } from '../features/group/groupPermissions';
import { useGroupStore } from '../features/group/groupStore';
import { projectGroupMessageDisplay, type GroupMessageDisplay } from '../features/group/groupProjection';
import { GroupRole, type GroupMember, type GroupMessage, type GroupMessageAttachment } from '../gen/proto/domain/chat/group_chat_pb';
import { FriendMessageStatus } from '../gen/proto/domain/chat/friend_chat_pb';
import { formatSocialError, useSocialStore } from '../features/social/socialStore';
import { SocialApiError, readableErrorMessage, type FriendChatMessage, type FriendMessageAttachment, type PeerProfile } from '../features/social/socialTypes';
import type { GroupGatewaySettings as GroupSettings } from '../services/gateways';
import {
  messagingDiscardAttachmentStage,
  messagingOpenAttachment,
  messagingStageAttachment,
  type MessagingAccountInput,
  type MessagingAttachmentStageProjection,
  type MessagingSubmitCommandResult,
} from '../services/mobileCommands';

const { Text } = Typography;
const TYPING_TRUE_INTERVAL_MS = 3000;
const TYPING_FALSE_DELAY_MS = 4000;
const EMPTY_MESSAGES: FriendChatMessage[] = [];
const EMPTY_GROUP_MESSAGES: GroupMessage[] = [];
const EMPTY_GROUP_MEMBERS: GroupMember[] = [];
const MOBILE_THREAD_COMPOSER_CAPABILITIES = CHAT_COMPOSER_CAPABILITIES_MOBILE_THREAD;
const MOBILE_THREAD_VISUAL_VARS = chatVisualCssVars(chatVisualLayoutForSurface('mobile-thread')) as CSSProperties;
const MOBILE_COMPOSER_EMOJIS = ['😀', '😊', '😂', '😍', '👍', '🙏', '🎉', '🔥', '❤️', '✨', '😭', '🤔'] as const;
/** Maximum messages to render before windowing trims the top. */
const MESSAGE_WINDOW_SIZE = 200;
/** Maximum conversation items before windowing trims. */
const CONVERSATION_WINDOW_SIZE = 100;

type EditingMessage = {
  kind: 'friend' | 'group';
  ulid: string;
  content: string;
};

type MobileChatAttachmentDraft = {
  id: string;
  attachment: MessagingAttachmentStageProjection;
  previewUrl: string;
};

type PendingAttachmentSubmission = {
  conversationId: string;
  messageId: string;
  attachmentIds: string[];
};

// ---------------------------------------------------------------------------
// ChatPage — pure renderer with mount guard for zustand initialization burst
// ---------------------------------------------------------------------------

// useShallow reduces subscription count from 29+ to ~11, but the initial store
// initialization burst (reconcile, profile load, presence) can still trigger
// useSyncExternalStore torn-read detection. ChatMountGuard catches the first
// few render-loop errors and retries; by retry 2-3 the stores have stabilized.
class ChatMountGuard extends Component<{ children: ReactNode }, { hasError: boolean; retryCount: number }> {
  state = { hasError: false, retryCount: 0 };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() {
    if (this.state.retryCount < 5) {
      const delay = Math.min(1000, (this.state.retryCount + 1) * 300);
      setTimeout(() => this.setState((s) => ({ hasError: false, retryCount: s.retryCount + 1 })), delay);
    }
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

interface ChatPageProps {
  readonly activeDetail: MobileChatDetailRoute | null;
  readonly onOpenConversation: (route: MobileChatDetailRoute) => void;
  readonly onBack: () => void;
}

export function ChatPage(props: ChatPageProps) {
  return <ChatMountGuard><ChatPageInner {...props} /></ChatMountGuard>;
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
  const [conversationQuery, setConversationQuery] = useState('');
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [composerMoreOpen, setComposerMoreOpen] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<MobileChatAttachmentDraft[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [pendingAttachmentSubmission, setPendingAttachmentSubmission] = useState<PendingAttachmentSubmission | null>(null);
  const [chatActionStates, setChatActionStates] = useState<Record<string, ChatActionState>>({});
  const [highlightedMessageUlid, setHighlightedMessageUlid] = useState('');
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState('');
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);
  const [localActionError, setLocalActionError] = useState('');

  // --- Narrow store selectors (batched via useShallow to prevent torn-read cascades) ---
  const {
    selectGroup,
    clearError: clearGroupError,
    updateMySettings: updateGroupSettings,
    groupSettingsByUlid,
    groupLoading,
    groupError,
  } = useGroupStore(useShallow((s) => ({
    selectGroup: s.selectGroup,
    clearError: s.clearError,
    updateMySettings: s.updateMySettings,
    groupSettingsByUlid: s.settings,
    groupLoading: s.loading,
    groupError: s.error,
  })));
  const {
    currentUserPtid,
    loading,
    error,
    currentUserProfile,
    friendshipStatus,
    friendConversationSettings,
    selectSession,
    sendTypingState,
    clearError: clearSocialError,
    updateConversationSettings: updateFriendConversationSettings,
    loadCurrentUserProfile,
    loadPeerProfile,
    loadFriendshipStatus,
  } = useSocialStore(useShallow((s) => ({
    currentUserPtid: s.currentUserPtid,
    loading: s.loading,
    error: s.error,
    currentUserProfile: s.currentUserProfile,
    friendshipStatus: s.friendshipStatus,
    friendConversationSettings: s.conversationSettings,
    selectSession: s.selectSession,
    sendTypingState: s.sendTypingState,
    clearError: s.clearError,
    updateConversationSettings: s.updateConversationSettings,
    loadCurrentUserProfile: s.loadCurrentUserProfile,
    loadPeerProfile: s.loadPeerProfile,
    loadFriendshipStatus: s.loadFriendshipStatus,
  })));
  const activeConversationId = activeGroupUlid || activeSessionUlid || '';
  const authSession = useAuthStore((s) => s.session);
  const messages = useSocialStore((s) => (activeSessionUlid ? s.messages[activeSessionUlid] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const peerProfiles = useSocialStore.getState().peerProfiles;
  const typingPeers = useSocialStore((s) => {
    const id = activeGroupUlid || activeSessionUlid || '';
    return id ? s.typingPeers[id] ?? {} : {};
  });
  const groupMessages = useGroupStore((s) => (activeGroupUlid ? s.messages[activeGroupUlid] ?? EMPTY_GROUP_MESSAGES : EMPTY_GROUP_MESSAGES));
  const groupMembers = useGroupStore((s) => (activeGroupUlid ? s.members[activeGroupUlid] ?? EMPTY_GROUP_MEMBERS : EMPTY_GROUP_MEMBERS));
  const groupSettings = activeGroupUlid ? groupSettingsByUlid[activeGroupUlid] : undefined;
  const groupSending = useGroupStore((s) => (activeGroupUlid ? Boolean(s.sendingGroups[activeGroupUlid]) : false));

  // --- Conversation list projection (single call to reduce store subscriptions) ---
  const { surfaceItems: allSurfaceItems, all: baseConversations } = useConversationListProjection(
    conversationQuery,
    chatActionStates,
    friendConversationSettings,
    groupSettingsByUlid,
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

  const activeConversation = conversations.find((c) => c.session.ulid === activeSessionUlid);
  const activeGroupConversation = groupConversations.find((c) => c.group.ulid === activeGroupUlid);
  const activeConversationKey = activeGroupUlid ? `group:${activeGroupUlid}` : activeSessionUlid ? `friend:${activeSessionUlid}` : '';
  const activeConversationKeyRef = useRef('');
  const pendingAttachmentSubmissionRef = useRef<PendingAttachmentSubmission | null>(null);
  activeConversationKeyRef.current = activeConversationKey;

  const peerTyping = activeConversation
    ? Boolean(typingPeers[activeConversation.peerPtid]?.typing)
    : Object.entries(typingPeers).some(([ptid, entry]) => ptid !== currentUserPtid && entry.typing);

  const groupMemberByPtid = useMemo(
    () => new Map(groupMembers.map((m) => [m.ptid, m])),
    [groupMembers],
  );
  const groupMemberPtids = useMemo(() => new Set(groupMembers.map((m) => m.ptid).filter(Boolean)), [groupMembers]);
  const groupInviteCandidates = useMemo(
    () => conversations.filter((c) =>
      c.peerPtid && !groupMemberPtids.has(c.peerPtid) && !friendshipStatus[c.peerPtid]?.blocked,
    ),
    [conversations, friendshipStatus, groupMemberPtids],
  );
  const myGroupMember = groupMembers.find((m) => m.ptid === currentUserPtid);
  const myGroupRole = activeGroupConversation?.group.ownerPtid === currentUserPtid
    ? GroupRole.OWNER
    : Number(myGroupMember?.role ?? 0);
  const canManageGroupMembers = myGroupRole >= GroupRole.ADMIN;

  // --- Refs ---
  const composingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCompositionEndRef = useRef(0);
  const lastTypingPulseRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingConversationRef = useRef('');

  // --- Side effects: reset on conversation change ---
  useEffect(() => {
    setThreadSearchQuery('');
    setThreadSearchOpen(false);
    setActionSheetOpen(false);
    setComposerEmojiOpen(false);
    setComposerMoreOpen(false);
    setEditingMessage(null);
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
  }, [activeGroupUlid, activeSessionUlid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (
      !pendingAttachmentSubmission
      || pendingAttachmentSubmission.conversationId !== activeConversationId
    ) {
      return;
    }
    const projectedMessages = activeGroupUlid
      ? groupMessages
      : activeSessionUlid
        ? messages
        : [];
    const projected = projectedMessages.find((message) => message.ulid === pendingAttachmentSubmission.messageId);
    if (!projected || !isQueuedAttachmentProjection(projected, pendingAttachmentSubmission.attachmentIds)) return;
    attachmentDrafts.forEach((item) => revokeObjectUrl(item.previewUrl));
    setAttachmentDrafts([]);
    setDraft('');
    pendingAttachmentSubmissionRef.current = null;
    setPendingAttachmentSubmission(null);
  }, [activeConversationId, activeGroupUlid, activeSessionUlid, attachmentDrafts, groupMessages, messages, pendingAttachmentSubmission]);

  useEffect(() => {
    if (!authSession) { setChatActionStates({}); return; }
    let active = true;
    void loadChatActionStates(authSession).then((states) => { if (active) setChatActionStates(states); });
    return () => { active = false; };
  }, [authSession]);

  useEffect(() => { void loadCurrentUserProfile(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const requestedProfilesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ptids = new Set<string>();
    if (activeConversation?.peerPtid) ptids.add(activeConversation.peerPtid);
    groupMembers.forEach((m) => { if (m.ptid && m.ptid !== currentUserPtid) ptids.add(m.ptid); });
    chatMessageSenderPtids(activeGroupConversation ? groupMessages : messages, currentUserPtid).forEach((ptid) => ptids.add(ptid));
    const known = useSocialStore.getState().peerProfiles;
    ptids.forEach((ptid) => {
      if (ptid && !(ptid in known) && !requestedProfilesRef.current.has(ptid)) {
        requestedProfilesRef.current.add(ptid);
        void loadPeerProfile(ptid);
      }
    });
  }, [activeConversation?.peerPtid, activeGroupConversation, currentUserPtid, groupMembers, groupMessages, loadPeerProfile, messages]);

  useEffect(() => {
    if (activeConversation?.peerPtid) void loadFriendshipStatus(activeConversation.peerPtid).catch(() => undefined);
  }, [activeConversation?.peerPtid, loadFriendshipStatus]);

  useEffect(() => {
    if (!activeGroupConversation) return;
    setGroupNameDraft(activeGroupConversation.group.name);
    setGroupDescriptionDraft(activeGroupConversation.group.description);
  }, [activeGroupConversation]);

  // --- Typing indicator emission ---
  const emitTypingState = useCallback(async (typing: boolean) => {
    if (!activeConversationId) return;
    await sendTypingState(activeConversationId, typing);
  }, [activeConversationId, sendTypingState]);

  useEffect(() => {
    typingConversationRef.current = activeConversationId;
    return () => {
      if (typingIdleTimerRef.current) { window.clearTimeout(typingIdleTimerRef.current); typingIdleTimerRef.current = null; }
      if (lastTypingPulseRef.current > 0 && typingConversationRef.current) {
        void sendTypingState(typingConversationRef.current, false);
      }
      lastTypingPulseRef.current = 0;
    };
  }, [activeConversationId, sendTypingState]);

  // --- Command dispatch wrappers ---
  const runChatOperation = useCallback(async (operation: () => Promise<void>, failureKey: string) => {
    setLocalActionError('');
    try { await operation(); } catch (operationError) {
      setLocalActionError(`${t(failureKey)}: ${formatChatOperationError(operationError)}`);
    }
  }, [t]);

  const handleDraftChange = useCallback((value: string) => {
    setDraft(value);
    if (!activeConversationId) return;
    const now = Date.now();
    if (value.trim() && now - lastTypingPulseRef.current > TYPING_TRUE_INTERVAL_MS) {
      lastTypingPulseRef.current = now;
      void emitTypingState(true);
    }
    if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = window.setTimeout(() => { void emitTypingState(false); }, TYPING_FALSE_DELAY_MS);
  }, [activeConversationId, emitTypingState]);

  const clearAttachmentDrafts = useCallback(() => {
    pendingAttachmentSubmissionRef.current = null;
    setPendingAttachmentSubmission(null);
    setAttachmentDrafts((drafts) => {
      drafts.forEach((item) => revokeObjectUrl(item.previewUrl));
      return [];
    });
  }, []);

  const applySendOutcome = useCallback((
    conversationId: string,
    attachments: MessagingAttachmentStageProjection[],
    outcome: MessagingSubmitCommandResult,
  ) => {
    const disposition = classifySendOutcome(outcome, attachments.length);
    if (disposition === 'queued') {
      setDraft('');
      clearAttachmentDrafts();
      return;
    }
    const submission = {
      conversationId,
      messageId: outcome.messageId!,
      attachmentIds: outcome.attachmentIds,
    };
    pendingAttachmentSubmissionRef.current = submission;
    setPendingAttachmentSubmission(submission);
  }, [clearAttachmentDrafts]);

  const submitMessage = useCallback(async () => {
    if (!canSubmitChatComposerDraft({ text: draft, attachmentCount: attachmentDrafts.length, capabilities: MOBILE_THREAD_COMPOSER_CAPABILITIES })) return;
    const readyAttachments = attachmentDrafts.map((item) => item.attachment);

    if (activeGroupConversation && activeGroupUlid) {
      if (editingMessage?.kind === 'group') {
        await dispatchGroupEditMessage(activeGroupUlid, editingMessage.ulid, draft);
        setEditingMessage(null);
        setDraft('');
        return;
      }
      const outcome = await dispatchGroupSendMessage(activeGroupUlid, draft, readyAttachments);
      applySendOutcome(activeGroupUlid, readyAttachments, outcome);
      return;
    }

    if (!activeConversation) return;
    if (friendshipStatus[activeConversation.peerPtid]?.blocked) throw new Error(t('mobile.chat.blockedComposer'));
    await emitTypingState(false);

    if (editingMessage?.kind === 'friend') {
      await dispatchEditMessage(activeConversation.session.ulid, editingMessage.ulid, draft);
      setEditingMessage(null); setDraft('');
      return;
    }
    const outcome = await dispatchSendMessage(activeConversation.session.ulid, draft, readyAttachments);
    if (outcome) applySendOutcome(activeConversation.session.ulid, readyAttachments, outcome);
  }, [activeConversation, activeGroupConversation, activeGroupUlid, applySendOutcome, attachmentDrafts, draft, editingMessage, emitTypingState, friendshipStatus, t]);

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
      await discardStagedAttachments(authSession, [removed]);
      revokeObjectUrl(removed.previewUrl);
      setAttachmentDrafts((drafts) => drafts.filter((item) => item.id !== id));
    } catch (discardError) {
      setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(discardError)}`);
    }
  };

  const openMobileFilePicker = () => {
    if (editingMessage || attachmentUploading || pendingAttachmentSubmission) return;
    setComposerMoreOpen(false);
    fileInputRef.current?.click();
  };

  const handleMobileFilesSelected = async (files: FileList | null) => {
    if (!files?.length || !authSession) return;
    const conversationId = activeGroupUlid || activeSessionUlid || '';
    const uploadConversationKey = activeConversationKey;
    if (!conversationId) return;
    setAttachmentUploading(true);
    setLocalActionError('');
    const uploadedDrafts: MobileChatAttachmentDraft[] = [];
    try {
      for (const file of Array.from(files)) {
        const attachment = await messagingStageAttachment({
          ...messagingAccountFromSession(authSession),
          file,
        });
        const previewUrl = URL.createObjectURL(file);
        uploadedDrafts.push({ id: attachment.stageId, attachment, previewUrl });
      }
      if (uploadConversationKey !== activeConversationKeyRef.current) {
        await discardStagedAttachments(authSession, uploadedDrafts);
        uploadedDrafts.forEach((item) => revokeObjectUrl(item.previewUrl));
        return;
      }
      setAttachmentDrafts((current) => [...current, ...uploadedDrafts]);
    } catch (uploadError) {
      let visibleError: unknown = uploadError;
      try {
        await discardStagedAttachments(authSession, uploadedDrafts);
      } catch (discardError) {
        visibleError = discardError;
      }
      uploadedDrafts.forEach((item) => revokeObjectUrl(item.previewUrl));
      setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(visibleError)}`);
    } finally {
      setAttachmentUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const openConversation = (conversation: MobileConversation) => {
    if (conversation.kind === 'friend') {
      const sessionUlid = conversation.conversation.session.ulid;
      onOpenConversation({
        routeId: 'detail:chat-conversation',
        sessionUlid,
      });
      void selectGroup(null);
      void selectSession(sessionUlid);
    } else {
      const groupUlid = conversation.conversation.group.ulid;
      onOpenConversation({
        routeId: 'detail:group-conversation',
        groupUlid,
      });
      void selectSession(null);
      void selectGroup(groupUlid);
    }
  };

  const updateChatActionState = async (key: string, patch: Partial<ChatActionState>) => {
    if (activeConversation) {
      await updateFriendConversationSettings(activeConversation.session.ulid, friendPatchFromActionPatch(patch));
    } else if (activeGroupUlid) {
      await updateGroupSettings(activeGroupUlid, groupPatchFromActionPatch(patch));
    }
    const next = { ...chatActionStates, [key]: { ...(chatActionStates[key] ?? defaultChatActionState()), ...patch } };
    setChatActionStates(next);
    if (!authSession) throw new Error('mobile.auth.missingIdentityScope');
    await saveChatActionStates(authSession, next);
  };

  const scrollToMessage = (messageUlid: string) => {
    setHighlightedMessageUlid(messageUlid);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-message-ulid="${messageUlid}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setHighlightedMessageUlid(''), 1800);
    });
  };

  // -----------------------------------------------------------------------
  // Thread view (active conversation)
  // -----------------------------------------------------------------------
  if (activeConversation || activeGroupConversation) {
    const isGroupThread = Boolean(activeGroupConversation);
    const title = activeGroupConversation?.group.name || activeConversation?.peerName || '';
    const activeKey = chatActionKey(isGroupThread ? 'group' : 'friend', activeGroupUlid || activeSessionUlid || '');
    const actionState = isGroupThread
      ? groupSettingsToActionState(groupSettings, chatActionStates[activeKey])
      : friendSettingsToActionState(activeSessionUlid ? friendConversationSettings[activeSessionUlid] : undefined, chatActionStates[activeKey]);
    const ownAvatar = currentUserProfile?.avatar || '';
    const ownName = authSession?.actorRef.acct || currentUserPtid || '';
    const peerProfile = activeConversation ? peerProfiles[activeConversation.peerPtid] : null;
    const activePeerBlocked = activeConversation ? Boolean(friendshipStatus[activeConversation.peerPtid]?.blocked) : false;
    const peerMessageAvatar = activeGroupConversation ? '' : (peerProfile?.avatar || activeConversation?.peerAvatar);
    const stationName = stationHostFromUrl(authSession?.stationUrl);
    const subtitle = activeGroupConversation
      ? peerTyping ? t('mobile.chat.typing') : t('mobile.group.memberCount', { count: activeGroupConversation.group.memberCount })
      : peerTyping ? t('mobile.chat.typing') : t('mobile.chat.peerAtStation', { station: stationName });

    const rawThreadMessages: Array<FriendChatMessage | GroupMessage> = activeGroupConversation ? groupMessages : messages;
    const threadMessages = useMemo(() => {
      const filtered = rawThreadMessages.filter((m) => messageTimestampMillis(m, isGroupThread) > (actionState.clearedAt || 0));
      // Windowed: keep only the last MESSAGE_WINDOW_SIZE messages to bound DOM nodes
      return filtered.length > MESSAGE_WINDOW_SIZE ? filtered.slice(-MESSAGE_WINDOW_SIZE) : filtered;
    }, [rawThreadMessages, isGroupThread, actionState.clearedAt]);

    const threadSearchResults = localThreadSearchResults(threadMessages, threadSearchQuery, isGroupThread);

    return (
      <div className="page-container chat-thread-page" style={MOBILE_THREAD_VISUAL_VARS}>
        <header className={`page-header chat-thread-header ${threadSearchOpen ? 'searching' : ''}`}>
          <button className="header-action" type="button" onClick={() => { onBack(); void selectSession(null); void selectGroup(null); }} aria-label={t('common.action.back')}>
            <ArrowLeft size={20} />
          </button>
          {threadSearchOpen ? (
            <>
              <Input.Search className="chat-header-search" value={threadSearchQuery} onChange={(e) => setThreadSearchQuery(e.target.value)} prefix={<Search size={16} />} placeholder={t('mobile.chat.searchMessagesPlaceholder')} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} allowClear onSearch={setThreadSearchQuery} />
              <button className="header-action" type="button" onClick={() => { setThreadSearchOpen(false); setThreadSearchQuery(''); }} aria-label={t('common.action.cancel')}><X size={18} /></button>
            </>
          ) : (
            <>
              <div className="header-title-stack">
                <h1 className="header-title compact">{title}</h1>
                <Text type="secondary">{subtitle}</Text>
              </div>
              <button className="header-action" type="button" onClick={() => setActionSheetOpen(true)} aria-label={t('mobile.chat.moreActions')}><MoreHorizontal size={20} /></button>
            </>
          )}
        </header>

        <ChatActionSheet
          open={actionSheetOpen} state={actionState} onClose={() => setActionSheetOpen(false)}
          onSearch={() => { setThreadSearchOpen(true); setActionSheetOpen(false); }}
          onToggleMute={() => { void updateChatActionState(activeKey, { muted: !actionState.muted }); }}
          onToggleSticky={() => { void updateChatActionState(activeKey, { sticky: !actionState.sticky }); }}
          onToggleAlert={() => { void updateChatActionState(activeKey, { alertEnabled: !actionState.alertEnabled }); }}
          onSelectBackground={(bg) => { void updateChatActionState(activeKey, { background: bg }); }}
          onClearHistory={() => {
            Modal.confirm({
              title: t('mobile.chat.clearHistoryConfirmTitle'), content: t('mobile.chat.clearHistoryConfirmBody'),
              okText: t('mobile.chat.quickClearHistory'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
              onOk: () => { void updateChatActionState(activeKey, { clearedAt: Date.now() }); },
            });
          }}
          onRestoreHistory={() => { void updateChatActionState(activeKey, { clearedAt: 0 }); }}
          isFriendThread={Boolean(activeConversation)}
          onManageGroup={activeGroupConversation ? () => { setGroupManageOpen(true); setActionSheetOpen(false); } : undefined}
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

        {localActionError ? <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice> : null}

        {threadSearchQuery.trim() ? (
          <section className="message-search-panel">
            {threadSearchResults.length > 0 ? (
              threadSearchResults.map((msg) => (
                <button className="message-search-result" type="button" key={msg.ulid} onClick={() => scrollToMessage(msg.ulid)}>
                  <Text ellipsis>{messageContentForSearch(msg, isGroupThread, t)}</Text>
                  <Text type="secondary">{formatRelativeTime(messageTimestampMillis(msg, isGroupThread), t)}</Text>
                </button>
              ))
            ) : <Text type="secondary">{t('mobile.chat.noMessageResults')}</Text>}
          </section>
        ) : null}

        <section className={`message-list chat-background-${actionState.background}`}>
          {threadMessages.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.emptyThread')} />
          ) : (
            threadMessages.map((msg) => {
              const mine = isOwnChatMessage(msg, currentUserPtid);
              const recalled = isRecalledChatMessage(msg);
              const groupDisplay = isGroupThread ? projectGroupMessageDisplay(msg as GroupMessage) : null;
              const content = groupDisplay ? groupMessageDisplayText(groupDisplay, t) : friendMessageDisplayText(msg as FriendChatMessage, t);
              const attachments = chatMessageAttachments(msg);
              const hasAttachmentOnlyPreview = attachments.length > 0 && content === t('mobile.chat.noPreview');
              const canEditMsg = canEditChatMessage({ own: mine, recalled, encrypted: groupDisplay?.kind === 'encrypted', content: msg.content });

              return (
                <div
                  key={msg.ulid}
                  data-message-ulid={msg.ulid}
                  data-message-state={(msg as FriendChatMessage & { messagingState?: string }).messagingState ?? ''}
                  className={`message-bubble-row ${mine ? 'mine' : 'peer'} ${highlightedMessageUlid === msg.ulid ? 'highlighted' : ''}`}
                >
                  {!mine ? <MessageAvatar src={messageAvatarUrl(msg, peerProfiles, peerMessageAvatar)} fallback={messageSenderFallback(msg, groupMemberByPtid, activeConversation?.peerName || title)} /> : null}
                  <div className="message-bubble">
                    {!hasAttachmentOnlyPreview ? (
                      <Text className="message-text">
                        {content}
                        <span className="message-meta">
                          {msg.editedAt && !recalled ? <span>{t('mobile.chat.edited')}</span> : null}
                          <span>{formatRelativeTime(messageTimestampMillis(msg, isGroupThread), t)}</span>
                          {mine && !recalled && !isGroupThread && 'status' in msg ? <MessageStatusIcon status={msg.status} /> : null}
                        </span>
                      </Text>
                    ) : null}
                    {!recalled && attachments.length > 0 ? <MobileMessageAttachments attachments={attachments} isOwn={mine} session={authSession} /> : null}
                    {hasAttachmentOnlyPreview ? (
                      <span className="message-meta attachment-only-meta">
                        <span>{formatRelativeTime(messageTimestampMillis(msg, isGroupThread), t)}</span>
                        {mine && !isGroupThread && 'status' in msg ? <MessageStatusIcon status={msg.status} /> : null}
                      </span>
                    ) : null}
                    {mine && !recalled ? (
                      <span className="message-actions">
                        {canEditMsg ? (
                          <button type="button" className="message-action-button" aria-label={t('mobile.chat.edit')} onClick={(e) => { e.stopPropagation(); clearAttachmentDrafts(); setEditingMessage({ kind: isGroupThread ? 'group' : 'friend', ulid: msg.ulid, content: msg.content }); setDraft(msg.content); }}>
                            <Pencil size={13} />
                          </button>
                        ) : null}
                        <button type="button" className="message-action-button" aria-label={t('mobile.chat.recall')} onClick={(e) => {
                          e.stopPropagation();
                          void runChatOperation(
                            () => isGroupThread ? dispatchGroupRecallMessage(activeGroupUlid!, msg.ulid) : dispatchRecallMessage(activeSessionUlid!, msg.ulid),
                            'mobile.chat.operationRecallFailed',
                          );
                        }}><RotateCcw size={13} /></button>
                      </span>
                    ) : null}
                  </div>
                  {mine ? <MessageAvatar src={ownAvatar} fallback={ownName.slice(0, 1).toUpperCase()} /> : null}
                </div>
              );
            })
          )}
        </section>

        {!isGroupThread && activePeerBlocked ? (
          <footer className="message-composer readonly"><Text type="secondary">{t('mobile.chat.blockedComposer')}</Text></footer>
        ) : (
          <footer className="message-composer">
            {editingMessage ? (
              <div className="message-editing-banner">
                <Text type="secondary" ellipsis>{t('mobile.chat.editing')}</Text>
                <button type="button" className="message-action-button light" onClick={() => { setEditingMessage(null); setDraft(''); }} aria-label={t('common.action.cancel')}><X size={13} /></button>
              </div>
            ) : null}
            {composerEmojiOpen ? (
              <div className="message-composer-panel emoji-panel">
                {MOBILE_COMPOSER_EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" className="composer-emoji-button" aria-label={t('mobile.chat.composerEmoji')} onClick={() => { setDraft((d) => `${d}${emoji}`); setComposerEmojiOpen(false); }}>{emoji}</button>
                ))}
              </div>
            ) : null}
            {composerMoreOpen ? (
              <div className="message-composer-panel more-panel">
                <ComposerToolButton icon={<FolderOpen size={16} />} label={t('mobile.chat.composerFile')} onClick={openMobileFilePicker} disabled={attachmentUploading || Boolean(editingMessage) || Boolean(pendingAttachmentSubmission)} />
                <ComposerToolButton icon={<Scissors size={16} />} label={t('mobile.chat.composerScreenshot')} onClick={() => { setLocalActionError(t('mobile.chat.composerUnavailable')); setComposerMoreOpen(false); }} />
                <ComposerToolButton icon={<Mic size={16} />} label={t('mobile.chat.composerVoice')} onClick={() => { setLocalActionError(t('mobile.chat.composerUnavailable')); setComposerMoreOpen(false); }} />
              </div>
            ) : null}
            {attachmentDrafts.length > 0 || attachmentUploading ? (
              <div className="message-composer-panel attachment-draft-panel">
                {attachmentDrafts.map((item) => <AttachmentDraftChip key={item.id} draft={item} disabled={Boolean(pendingAttachmentSubmission)} onRemove={() => { void removeAttachmentDraft(item.id); }} />)}
                {attachmentUploading ? <Spin size="small" /> : null}
                {pendingAttachmentSubmission ? <Text type="secondary">{t('chat.social.messageArea.attachmentStateDownloading')}</Text> : null}
              </div>
            ) : null}
            <input ref={fileInputRef} className="visually-hidden-file-input" type="file" multiple onChange={(e) => { void handleMobileFilesSelected(e.target.files); }} />
            {MOBILE_THREAD_COMPOSER_CAPABILITIES.emoji ? (
              <button type="button" className={`message-composer-tool ${composerEmojiOpen ? 'active' : ''}`} aria-label={t('mobile.chat.composerEmoji')} onClick={() => { setComposerEmojiOpen((o) => !o); setComposerMoreOpen(false); }} disabled={groupSending || Boolean(pendingAttachmentSubmission)}><Smile size={18} /></button>
            ) : null}
            <Input className="message-composer-input" value={draft} onChange={(e) => handleDraftChange(e.target.value)}
              onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; lastCompositionEndRef.current = Date.now(); }}
              onKeyDown={handleComposerKeyDown} placeholder={t('mobile.chat.messagePlaceholder')} disabled={groupSending || Boolean(pendingAttachmentSubmission)} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} />
            <button type="button" className={`message-composer-tool ${composerMoreOpen ? 'active' : ''}`} aria-label={t('mobile.chat.composerMore')} onClick={() => { setComposerMoreOpen((o) => !o); setComposerEmojiOpen(false); }} disabled={groupSending || Boolean(editingMessage) || Boolean(pendingAttachmentSubmission)}><Plus size={18} /></button>
            <Button className="message-send-button" type="primary" icon={<Send size={16} />}
              disabled={!canSubmitChatComposerDraft({ text: draft, attachmentCount: attachmentDrafts.length, capabilities: MOBILE_THREAD_COMPOSER_CAPABILITIES }) || groupSending || attachmentUploading || Boolean(pendingAttachmentSubmission)}
              loading={groupSending || attachmentUploading || Boolean(pendingAttachmentSubmission)}
              onClick={() => void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed')} />
          </footer>
        )}

        {activeGroupConversation ? (
          <GroupManagementModal
            open={groupManageOpen}
            onClose={() => setGroupManageOpen(false)}
            group={activeGroupConversation}
            members={groupMembers}
            myRole={myGroupRole}
            canManage={canManageGroupMembers}
            groupNameDraft={groupNameDraft}
            setGroupNameDraft={setGroupNameDraft}
            groupDescriptionDraft={groupDescriptionDraft}
            setGroupDescriptionDraft={setGroupDescriptionDraft}
            groupSettings={groupSettings}
            inviteCandidates={groupInviteCandidates}
            peerProfiles={peerProfiles}
            currentUserPtid={currentUserPtid}
            activeGroupUlid={activeGroupUlid!}
          />
        ) : null}
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Conversation list view
  // -----------------------------------------------------------------------
  // Windowed: bound the conversation list to CONVERSATION_WINDOW_SIZE items
  const windowedItems = filteredConversationSurfaceItems.length > CONVERSATION_WINDOW_SIZE
    ? filteredConversationSurfaceItems.slice(0, CONVERSATION_WINDOW_SIZE)
    : filteredConversationSurfaceItems;

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="header-title">{t('mobile.chat.title')}</h1>
        <button type="button" className="header-action" aria-label={t('mobile.chat.moreActions')}>
          <Pencil size={20} />
        </button>
      </header>

      <div className="chat-search-bar">
        <Input value={conversationQuery} onChange={(e) => setConversationQuery(e.target.value)} prefix={<Search size={16} color="#9ca0ab" />} placeholder={t('mobile.chat.searchPlaceholder')} allowClear />
      </div>

      {localActionError ? <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice> : null}
      {error ? <MobileNotice onClose={clearSocialError}>{formatSocialError(error)}</MobileNotice> : null}
      {groupError ? <MobileNotice onClose={clearGroupError}>{formatSocialError(groupError)}</MobileNotice> : null}

      <section className="social-list-panel">
        <Spin spinning={(loading || groupLoading) && windowedItems.length === 0}>
          {windowedItems.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={
              allSurfaceItems.length > 0 ? t('mobile.chat.noSearchResults') : (
                <div className="empty-copy">
                  <Text strong>{t('mobile.chat.emptyTitle')}</Text>
                  <Text type="secondary">{t('mobile.chat.emptySubtitle')}</Text>
                </div>
              )
            } />
          ) : (
            <List dataSource={windowedItems} renderItem={(item) => {
              const conv = item.conversation as MobileConversation;
              const { preference: preferenceState, updatedAt, visibleUnread } = item;
              return (
                <List.Item
                  className="conversation-item"
                  data-conversation-id={conv.kind === 'friend' ? conv.conversation.session.ulid : conv.conversation.group.ulid}
                  data-conversation-kind={conv.kind}
                  onClick={() => openConversation(conv)}
                >
                  <List.Item.Meta
                    avatar={
                      <span className="conversation-avatar-frame">
                        <MobileAvatar src={conversationAvatar(conv)}>{conversationTitle(conv).slice(0, 1)}</MobileAvatar>
                        {conv.kind === 'friend' && conv.conversation.peerOnline ? <span className="conversation-online-dot" aria-hidden="true" /> : null}
                      </span>
                    }
                    title={
                      <span className="conversation-title-row">
                        {preferenceState?.sticky ? <Pin size={12} className="conversation-state-icon" /> : null}
                        <Text strong>{conversationTitle(conv)}</Text>
                        {conv.kind === 'group' ? <Users size={12} className="conversation-state-icon" /> : null}
                        {preferenceState?.muted ? <BellOff size={12} className="conversation-state-icon" /> : null}
                      </span>
                    }
                    description={<span className="conversation-preview">{conversationPreview(conv, t)}</span>}
                  />
                  <div className="conversation-meta">
                    <Text type="secondary" className="conversation-time">{formatRelativeTime(updatedAt, t)}</Text>
                    {visibleUnread > 0 ? <Badge count={visibleUnread} className="conversation-badge" /> : null}
                  </div>
                </List.Item>
              );
            }} />
          )}
        </Spin>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — pure renderers, no store access
// ---------------------------------------------------------------------------

function MessageStatusIcon({ status }: { status: number }) {
  if (status >= FriendMessageStatus.READ) return <CheckCheck size={13} className="message-status-icon read" />;
  if (status >= FriendMessageStatus.DELIVERED) return <CheckCheck size={13} className="message-status-icon" />;
  return <Check size={13} className="message-status-icon" />;
}

function MessageAvatar({ src, fallback }: { src: string; fallback: string }) {
  return <MobileAvatar className="message-avatar" src={src}>{(fallback || '?').slice(0, 1).toUpperCase()}</MobileAvatar>;
}

function ChatActionSheet({
  open, state, onClose, onSearch, onToggleMute, onToggleSticky, onToggleAlert, onSelectBackground,
  onClearHistory, onRestoreHistory, isFriendThread, onManageGroup, peerBlocked, onBlockPeer, onUnblockPeer,
}: {
  open: boolean; state: ChatActionState; onClose: () => void; onSearch: () => void;
  onToggleMute: () => void; onToggleSticky: () => void; onToggleAlert: () => void;
  onSelectBackground: (background: ChatBackgroundId) => void; onClearHistory: () => void;
  onRestoreHistory: () => void; isFriendThread: boolean; onManageGroup?: () => void;
  peerBlocked: boolean; onBlockPeer: () => void; onUnblockPeer: () => void;
}) {
  const { t } = useMobileI18n();
  if (!open) return null;

  return (
    <div className="chat-action-sheet-shell">
      <button className="chat-action-sheet-backdrop" type="button" aria-label={t('common.action.close')} onClick={onClose} />
      <aside className="chat-action-sheet" role="dialog" aria-modal="true" aria-labelledby="chat-action-sheet-title">
        <div className="chat-action-sheet-handle" aria-hidden="true" />
        <div className="chat-action-sheet-header">
          <Text strong id="chat-action-sheet-title">{t('mobile.chat.moreActions')}</Text>
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="chat-action-list">
          <div className="chat-action-group">
            <ChatActionButton icon={<Search size={18} />} title={t('mobile.chat.quickSearch')} onClick={onSearch} />
            <ChatActionButton icon={<VolumeX size={18} />} title={t('mobile.chat.quickMute')} active={state.muted} onClick={onToggleMute} />
            <ChatActionButton icon={<Pin size={18} />} title={t('mobile.chat.quickSticky')} active={state.sticky} onClick={onToggleSticky} />
            <ChatActionButton icon={<Bell size={18} />} title={t('mobile.chat.quickAlert')} active={state.alertEnabled} onClick={onToggleAlert} />
          </div>
          <div className="chat-background-section">
            <Text type="secondary" className="chat-background-title">{t('mobile.chat.quickBackground')}</Text>
            <div className="chat-background-grid">
              {CHAT_BACKGROUND_OPTIONS.map((option) => (
                <button key={option} className={`chat-background-choice chat-background-${option} ${state.background === option ? 'active' : ''}`} type="button" onClick={() => onSelectBackground(option)}>
                  <Image size={14} /><span>{t(`mobile.chat.background.${option}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="chat-action-group">
            {state.clearedAt ? <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.chat.quickRestoreHistory')} onClick={onRestoreHistory} /> : null}
            {onManageGroup ? <ChatActionButton icon={<Users size={18} />} title={t('mobile.group.members')} onClick={onManageGroup} /> : null}
          </div>
          <div className="chat-action-group danger">
            <ChatActionButton icon={<Trash2 size={18} />} title={t('mobile.chat.quickClearHistory')} danger onClick={onClearHistory} />
            {isFriendThread ? (
              peerBlocked
                ? <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.contacts.unblock')} onClick={onUnblockPeer} />
                : <ChatActionButton icon={<Ban size={18} />} title={t('mobile.contacts.block')} danger onClick={onBlockPeer} />
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function ChatActionButton({ icon, title, active, danger, onClick }: { icon: ReactNode; title: string; active?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button className={`chat-action-button ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} type="button" onClick={onClick}>
      <span className="chat-action-icon">{icon}</span><span>{title}</span>
    </button>
  );
}

function ComposerToolButton({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="composer-tool-option" type="button" onClick={onClick} disabled={disabled}>
      <span className="composer-tool-option-icon">{icon}</span><span>{label}</span>
    </button>
  );
}

function AttachmentDraftChip({ draft, disabled, onRemove }: {
  draft: MobileChatAttachmentDraft;
  disabled: boolean;
  onRemove: () => void;
}) {
  const { t } = useMobileI18n();
  const kind = chatMediaKindForAttachment(draft.attachment);
  return (
    <div className="attachment-draft-chip">
      {kind === 'image' ? <img src={draft.previewUrl} alt={draft.attachment.filename} /> : <Paperclip size={15} />}
      <span>{draft.attachment.filename}</span>
      <button type="button" onClick={onRemove} aria-label={t('common.action.delete')} disabled={disabled}><X size={12} /></button>
    </div>
  );
}

function MobileMessageAttachments({ attachments, isOwn, session }: {
  attachments: Array<FriendMessageAttachment | GroupMessageAttachment>; isOwn: boolean; session: MobileAuthSession | null;
}) {
  return (
    <div className={`mobile-message-attachments ${isOwn ? 'own' : 'peer'}`}>
      {attachments.map((attachment, index) => (
        <MobileMessageAttachmentItem key={`${attachment.cid || attachment.filename}-${index}`} attachment={attachment} session={session} />
      ))}
    </div>
  );
}

function MobileMessageAttachmentItem({ attachment, session }: { attachment: FriendMessageAttachment | GroupMessageAttachment; session: MobileAuthSession | null }) {
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
      if (openWhenReady) window.open(url, '_blank');
    } catch {
      setLoadState('failed');
    }
  }, [attachment.cid, session]);

  useEffect(() => {
    if (kind !== 'image' || !session || !attachment.cid) return undefined;
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
      : sizeLabel || attachment.mimeType;

  if (kind === 'image' && sourceUrl) {
    return <button type="button" className="mobile-attachment-image" data-attachment-id={attachment.cid} onClick={openAttachment}><img src={sourceUrl} alt={filename} /></button>;
  }
  return (
    <button type="button" className="mobile-attachment-card" data-attachment-id={attachment.cid} onClick={openAttachment} disabled={!session || !attachment.cid || loadState === 'loading'}>
      <Paperclip size={16} />
      <span className="mobile-attachment-info"><span>{filename}</span><small>{stateLabel}</small></span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// GroupManagementModal — extracted sub-component
// ---------------------------------------------------------------------------

function GroupManagementModal({
  open, onClose, group, members, myRole, canManage, groupNameDraft, setGroupNameDraft,
  groupDescriptionDraft, setGroupDescriptionDraft, groupSettings, inviteCandidates,
  peerProfiles, currentUserPtid, activeGroupUlid,
}: {
  open: boolean; onClose: () => void;
  group: { group: { name: string; memberCount: number; muted?: boolean; ownerPtid: string } };
  members: GroupMember[]; myRole: number; canManage: boolean;
  groupNameDraft: string; setGroupNameDraft: (v: string) => void;
  groupDescriptionDraft: string; setGroupDescriptionDraft: (v: string) => void;
  groupSettings: GroupSettings | undefined;
  inviteCandidates: Array<{ peerPtid: string; peerAvatar: string; peerName: string }>;
  peerProfiles: Record<string, PeerProfile | null>;
  currentUserPtid: string | null; activeGroupUlid: string;
}) {
  const { t } = useMobileI18n();
  const updateGroupSettings = useGroupStore((s) => s.updateMySettings);

  const runOp = async (operation: () => Promise<void>, failureKey: string) => {
    try { await operation(); } catch { /* error surfaced via store */ }
  };

  return (
    <Modal title={t('mobile.group.members')} open={open} onCancel={onClose} footer={null} destroyOnClose>
      <div className="group-management-panel">
        <SectionTitle title={t('mobile.group.profile')} count={group.group.memberCount} />
        <Input value={groupNameDraft} onChange={(e) => setGroupNameDraft(e.target.value)} placeholder={t('mobile.group.namePlaceholder')} disabled={!canManage} />
        <Input.TextArea value={groupDescriptionDraft} onChange={(e) => setGroupDescriptionDraft(e.target.value)} placeholder={t('mobile.group.descriptionPlaceholder')} autoSize={{ minRows: 2, maxRows: 4 }} disabled={!canManage} />
        {canManage ? (
          <Button type="primary" onClick={() => runOp(() => dispatchGroupUpdate(activeGroupUlid, { name: groupNameDraft.trim(), description: groupDescriptionDraft.trim() }), 'mobile.group.operationUpdateFailed')} disabled={!groupNameDraft.trim()}>
            {t('common.action.save')}
          </Button>
        ) : null}

        <div className="group-setting-row"><Text>{t('mobile.group.muted')}</Text><Switch checked={Boolean(group.group.muted)} onChange={(v) => runOp(() => dispatchGroupUpdate(activeGroupUlid, { muted: v }), 'mobile.group.operationUpdateFailed')} disabled={!canManage} /></div>
        <div className="group-setting-row"><Text>{t('mobile.group.myMuted')}</Text><Switch checked={Boolean(groupSettings?.isMuted)} onChange={(v) => updateGroupSettings(activeGroupUlid, { isMuted: v })} /></div>
        <div className="group-setting-row"><Text>{t('mobile.group.pinned')}</Text><Switch checked={Boolean(groupSettings?.isPinned)} onChange={(v) => updateGroupSettings(activeGroupUlid, { isPinned: v })} /></div>
        <div className="group-setting-row"><Text>{t('mobile.group.showMemberNickname')}</Text><Switch checked={Boolean(groupSettings?.showMemberNickname)} onChange={(v) => updateGroupSettings(activeGroupUlid, { showMemberNickname: v })} /></div>

        <SectionTitle title={t('mobile.group.members')} count={members.length} />
        {members.length > 0 ? (
          <List dataSource={members} renderItem={(member) => {
            const profile = peerProfiles[member.ptid];
            const memberName = member.nickname || profile?.displayName || profile?.username || member.ptid;
            const memberRole = Number(member.role ?? GroupRole.MEMBER);
            const controls = getMobileGroupMemberControlState({ canManageGroupMembers: canManage, isSelf: member.ptid === currentUserPtid, myGroupRole: myRole, targetRole: memberRole });
            return (
              <List.Item actions={[
                controls.canPromoteOrDemote ? <Button key="role" size="small" onClick={() => runOp(() => dispatchGroupUpdateMember(activeGroupUlid, member.ptid, { role: memberRole === GroupRole.ADMIN ? GroupRole.MEMBER : GroupRole.ADMIN }), 'mobile.group.operationUpdateMemberFailed')}>{memberRole === GroupRole.ADMIN ? t('mobile.group.demoteAdmin') : t('mobile.group.promoteAdmin')}</Button> : null,
                controls.canTransferOwnership ? <Button key="transfer" size="small" onClick={() => {
                  Modal.confirm({
                    title: t('mobile.group.transferOwnerConfirmTitle'),
                    content: t('mobile.group.transferOwnerConfirmBody', { name: memberName }),
                    okText: t('mobile.group.transferOwner'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
                    onOk: () => runOp(() => dispatchGroupTransferOwnership(activeGroupUlid, member.ptid), 'mobile.group.operationTransferOwnerFailed'),
                  });
                }}>{t('mobile.group.transferOwner')}</Button> : null,
                controls.canMute ? <Button key="mute" size="small" onClick={() => runOp(() => dispatchGroupUpdateMember(activeGroupUlid, member.ptid, { muted: !member.muted }), 'mobile.group.operationUpdateMemberFailed')}>{member.muted ? t('mobile.group.unmuteMember') : t('mobile.group.muteMember')}</Button> : null,
                controls.canRemove ? <Button key="remove" size="small" danger onClick={() => runOp(() => dispatchGroupRemoveMember(activeGroupUlid, member.ptid), 'mobile.group.operationRemoveFailed')}>{t('mobile.group.removeMember')}</Button> : null,
              ].filter(Boolean)}>
                <List.Item.Meta avatar={<MobileAvatar src={profile?.avatar}>{memberName.slice(0, 1)}</MobileAvatar>} title={<Text strong>{memberName}</Text>} description={<Text type="secondary" copyable>{member.ptid}</Text>} />
                <Tag>{groupRoleLabel(memberRole, t)}</Tag>
                {member.muted ? <Tag color="warning">{t('mobile.group.memberMuted')}</Tag> : null}
              </List.Item>
            );
          }} />
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noMembers')} />}

        <SectionTitle title={t('mobile.group.inviteFriends')} count={inviteCandidates.length} />
        {inviteCandidates.length > 0 ? (
          <List dataSource={inviteCandidates} renderItem={(candidate) => (
            <List.Item actions={[
              <Button key="invite" size="small" type="primary" onClick={() => runOp(() => dispatchGroupInviteMembers(activeGroupUlid, [candidate.peerPtid]), 'mobile.group.operationInviteFailed')}>{t('mobile.group.invite')}</Button>,
            ]}>
              <List.Item.Meta avatar={<MobileAvatar src={candidate.peerAvatar}>{candidate.peerName.slice(0, 1)}</MobileAvatar>} title={<Text strong>{candidate.peerName}</Text>} description={<Text type="secondary" copyable>{candidate.peerPtid}</Text>} />
            </List.Item>
          )} />
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noInviteCandidates')} />}

        <Button danger block onClick={() => {
          if (myRole === GroupRole.OWNER) {
            Modal.confirm({
              title: t('mobile.group.dissolveGroupConfirmTitle'), content: t('mobile.group.dissolveGroupConfirmBody'),
              okText: t('mobile.group.dissolveGroup'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
              onOk: () => runOp(async () => { await dispatchGroupDissolve(activeGroupUlid); onClose(); }, 'mobile.group.operationDissolveFailed'),
            });
          } else {
            Modal.confirm({
              title: t('mobile.group.leaveGroupConfirmTitle'), content: t('mobile.group.leaveGroupConfirmBody'),
              okText: t('mobile.group.leaveGroup'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
              onOk: () => runOp(async () => { await dispatchGroupLeave(activeGroupUlid); onClose(); }, 'mobile.group.operationLeaveFailed'),
            });
          }
        }}>
          {myRole === GroupRole.OWNER ? t('mobile.group.dissolveGroup') : t('mobile.group.leaveGroup')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pure utility functions (no hooks, no store access)
// ---------------------------------------------------------------------------

function groupRoleLabel(role: number, t: (key: string) => string): string {
  if (role >= GroupRole.OWNER) return t('mobile.group.roleOwner');
  if (role >= GroupRole.ADMIN) return t('mobile.group.roleAdmin');
  return t('mobile.group.roleMember');
}

function messageSenderFallback(message: FriendChatMessage | GroupMessage, groupMemberByPtid: Map<string, GroupMember>, peerName: string): string {
  const member = groupMemberByPtid.get(message.senderPtid);
  return (member?.nickname || peerName || message.senderPtid || '').slice(0, 1).toUpperCase();
}

function chatMessageSenderPtids(messages: Array<FriendChatMessage | GroupMessage>, currentUserPtid: string | null): string[] {
  return Array.from(new Set(messages.map((m) => m.senderPtid).filter((ptid) => Boolean(ptid && ptid !== currentUserPtid))));
}

function messageAvatarUrl(message: FriendChatMessage | GroupMessage, peerProfiles: Record<string, PeerProfile | null>, fallbackAvatar: string | undefined): string {
  return peerProfiles[message.senderPtid]?.avatar || fallbackAvatar || '';
}

function messageContentForSearch(message: FriendChatMessage | GroupMessage, isGroupThread: boolean, t: (key: string) => string): string {
  return isGroupThread ? groupMessageDisplayText(projectGroupMessageDisplay(message as GroupMessage), t) : friendMessageDisplayText(message as FriendChatMessage, t);
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return <div className="social-section-title"><Text strong>{title}</Text><Text type="secondary">{count}</Text></div>;
}

function formatChatOperationError(error: unknown): string {
  if (error instanceof SocialApiError) return formatSocialError(error);
  return readableErrorMessage(error, 'operation_failed');
}

function revokeObjectUrl(url: string) { if (url) URL.revokeObjectURL(url); }

function classifySendOutcome(
  outcome: MessagingSubmitCommandResult,
  expectedAttachmentCount: number,
): 'queued' | 'deferred' {
  if (outcome.attachmentIds.length !== expectedAttachmentCount) {
    throw new Error('mobile.messaging.attachmentCountMismatch');
  }
  if (outcome.state === 'pending' && outcome.commandId) return 'queued';
  if (expectedAttachmentCount > 0 && outcome.state === 'draft' && outcome.messageId) {
    return 'deferred';
  }
  throw new Error('mobile.messaging.sendOutcomeInvalid');
}

function isQueuedAttachmentProjection(
  message: FriendChatMessage | GroupMessage,
  expectedAttachmentIds: string[],
): boolean {
  const state = (message as { messagingState?: string }).messagingState;
  if (!state || !['prepared', 'submitted', 'accepted', 'delivered', 'read', 'committed'].includes(state)) {
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
  await Promise.all(drafts.map((draft) => messagingDiscardAttachmentStage({
    ...account,
    stageId: draft.attachment.stageId,
  })));
}

function attachmentAvailabilityState(
  attachment: FriendMessageAttachment | GroupMessageAttachment,
): 'remote' | 'local' | undefined {
  return (attachment as { availabilityState?: 'remote' | 'local' }).availabilityState;
}
