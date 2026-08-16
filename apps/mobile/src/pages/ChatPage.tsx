import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Badge, Button, Empty, Input, List, Modal, Popconfirm, Spin, Switch, Tag, Typography } from 'antd';
import { ArrowLeft, Ban, Bell, Check, CheckCheck, FolderOpen, Image, Mic, MoreHorizontal, Paperclip, Pencil, Pin, Plus, RotateCcw, Scissors, Search, Send, Smile, Trash2, Users, VolumeX, X } from 'lucide-react';
import {
  CHAT_COMPOSER_CAPABILITIES_MOBILE_THREAD,
  buildChatConversationSurfaceItems,
  canSubmitChatComposerDraft,
  canEditChatMessage,
  chatMessageDisplayKind,
  chatMessageSenderDids,
  chatMediaKindForAttachment,
  chatMessageTypeForAttachments,
  chatVisualCssVars,
  chatVisualLayoutForSurface,
  filterChatMessagesAfterClearedAt,
  filterChatMessagesBySearchText,
  formatChatAttachmentSize,
  isOwnChatMessage,
  isRecalledChatMessage,
  shouldSendComposerEnter,
  type ChatConversationPreferenceLike,
} from '@peers-touch/client-chat-core';
import { decryptClientMediaBlob, type ClientMediaEncryptionDescriptor } from '@peers-touch/client-media-security';

import { useMobileI18n } from '../app/mobileI18n';
import logo from '../assets/logo.png';
import { MobileAvatar } from '../components/MobileAvatar';
import { MobileNotice } from '../components/MobileNotice';
import type { MobileAuthSession } from '../features/auth/authSession';
import { useAuthStore } from '../features/auth/authStore';
import type { ChatAttachmentInput } from '../features/social/socialApi';
import { uploadMobileChatAttachment } from '../features/social/socialApi';
import {
  chatActionKey,
  defaultChatActionState,
  loadChatActionStates,
  saveChatActionStates,
  type ChatActionState,
} from '../features/chat/chatActionState';
import { timestampMillis as groupTimestampMillis } from '../features/group/groupNormalizers';
import { getMobileGroupMemberControlState } from '../features/group/groupPermissions';
import { useGroupStore } from '../features/group/groupStore';
import type { GroupSettings } from '../features/group/groupApi';
import {
  projectGroupConversations,
  projectGroupMessageDisplay,
  type GroupConversation,
  type GroupMessageDisplay,
} from '../features/group/groupProjection';
import { GroupRole, type GroupMember, type GroupMessage, type GroupMessageAttachment } from '../gen/proto/domain/chat/group_chat_pb';
import { FriendMessageStatus } from '../gen/proto/domain/chat/friend_chat_pb';
import {
  formatSocialError,
  useSocialStore,
} from '../features/social/socialStore';
import { timestampMillis } from '../features/social/socialNormalizers';
import { projectConversations } from '../features/social/socialProjection';
import { SocialApiError, readableErrorMessage, type FriendChatMessage, type FriendMessageAttachment, type PeerProfile, type SocialConversation, type TypingEntry } from '../features/social/socialTypes';
import {
  CHAT_BACKGROUND_OPTIONS,
  type ChatBackgroundId,
  type FriendConversationSettings,
  type UpdateFriendConversationSettingsInput,
} from '../features/social/socialApi';

const { Text } = Typography;
const TYPING_TRUE_INTERVAL_MS = 3000;
const TYPING_FALSE_DELAY_MS = 4000;
const EMPTY_MESSAGES: FriendChatMessage[] = [];
const EMPTY_GROUP_MESSAGES: GroupMessage[] = [];
const EMPTY_GROUP_MEMBERS: GroupMember[] = [];
const EMPTY_TYPING_PEERS: Record<string, TypingEntry> = {};
const MOBILE_THREAD_COMPOSER_CAPABILITIES = CHAT_COMPOSER_CAPABILITIES_MOBILE_THREAD;
const MOBILE_THREAD_VISUAL_VARS = chatVisualCssVars(chatVisualLayoutForSurface('mobile-thread')) as CSSProperties;
const MOBILE_COMPOSER_EMOJIS = ['😀', '😊', '😂', '😍', '👍', '🙏', '🎉', '🔥', '❤️', '✨', '😭', '🤔'] as const;

type MobileConversation =
  | { kind: 'friend'; key: string; conversation: SocialConversation }
  | { kind: 'group'; key: string; conversation: GroupConversation };

type EditingMessage = {
  kind: 'friend' | 'group';
  ulid: string;
  content: string;
};

type MobileChatAttachmentDraft = {
  id: string;
  attachment: ChatAttachmentInput;
  previewUrl: string;
};

export function ChatPage() {
  const { t } = useMobileI18n();
  const [draft, setDraft] = useState('');
  const [conversationQuery, setConversationQuery] = useState('');
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [composerEmojiOpen, setComposerEmojiOpen] = useState(false);
  const [composerMoreOpen, setComposerMoreOpen] = useState(false);
  const [attachmentDrafts, setAttachmentDrafts] = useState<MobileChatAttachmentDraft[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [chatActionStates, setChatActionStates] = useState<Record<string, ChatActionState>>({});
  const [highlightedMessageUlid, setHighlightedMessageUlid] = useState('');
  const [groupManageOpen, setGroupManageOpen] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupDescriptionDraft, setGroupDescriptionDraft] = useState('');
  const [editingMessage, setEditingMessage] = useState<EditingMessage | null>(null);
  const [localActionError, setLocalActionError] = useState('');
  const activeSessionUlid = useSocialStore((state) => state.activeSessionUlid);
  const activeGroupUlid = useGroupStore((state) => state.activeGroupUlid);
  const activeConversationId = activeGroupUlid || activeSessionUlid || '';
  const authSession = useAuthStore((state) => state.session);
  const messages = useSocialStore((state) => (activeSessionUlid ? state.messages[activeSessionUlid] ?? EMPTY_MESSAGES : EMPTY_MESSAGES));
  const currentUserDid = useSocialStore((state) => state.currentUserDid);
  const typingPeers = useSocialStore((state) => (activeConversationId ? state.typingPeers[activeConversationId] ?? EMPTY_TYPING_PEERS : EMPTY_TYPING_PEERS));
  const loading = useSocialStore((state) => state.loading);
  const error = useSocialStore((state) => state.error);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const currentUserProfile = useSocialStore((state) => state.currentUserProfile);
  const loadCurrentUserProfile = useSocialStore((state) => state.loadCurrentUserProfile);
  const loadPeerProfile = useSocialStore((state) => state.loadPeerProfile);
  const loadFriendshipStatus = useSocialStore((state) => state.loadFriendshipStatus);
  const blockUser = useSocialStore((state) => state.blockUser);
  const unblockUser = useSocialStore((state) => state.unblockUser);
  const friendshipStatus = useSocialStore((state) => state.friendshipStatus);
  const selectSession = useSocialStore((state) => state.selectSession);
  const sendMessage = useSocialStore((state) => state.sendMessage);
  const editMessage = useSocialStore((state) => state.editMessage);
  const recallMessage = useSocialStore((state) => state.recallMessage);
  const deleteMessage = useSocialStore((state) => state.deleteMessage);
  const sendTypingState = useSocialStore((state) => state.sendTypingState);
  const clearSocialError = useSocialStore((state) => state.clearError);
  const friendConversationSettings = useSocialStore((state) => state.conversationSettings);
  const updateFriendConversationSettings = useSocialStore((state) => state.updateConversationSettings);
  const groupMessages = useGroupStore((state) => (activeGroupUlid ? state.messages[activeGroupUlid] ?? EMPTY_GROUP_MESSAGES : EMPTY_GROUP_MESSAGES));
  const groupMembers = useGroupStore((state) => (activeGroupUlid ? state.members[activeGroupUlid] ?? EMPTY_GROUP_MEMBERS : EMPTY_GROUP_MEMBERS));
  const groupSettingsByUlid = useGroupStore((state) => state.settings);
  const groupSettings = activeGroupUlid ? groupSettingsByUlid[activeGroupUlid] : undefined;
  const groupLoading = useGroupStore((state) => state.loading);
  const groupError = useGroupStore((state) => state.error);
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const updateGroup = useGroupStore((state) => state.updateGroup);
  const updateGroupSettings = useGroupStore((state) => state.updateMySettings);
  const inviteGroupMembers = useGroupStore((state) => state.inviteMembers);
  const leaveGroup = useGroupStore((state) => state.leaveGroup);
  const removeGroupMember = useGroupStore((state) => state.removeMember);
  const updateGroupMember = useGroupStore((state) => state.updateMember);
  const transferGroupOwnership = useGroupStore((state) => state.transferOwnership);
  const dissolveGroup = useGroupStore((state) => state.dissolveGroup);
  const groupEncryptionReady = useGroupStore((state) => (activeGroupUlid ? Boolean(state.encryptionReady[activeGroupUlid]) : false));
  const groupSending = useGroupStore((state) => (activeGroupUlid ? Boolean(state.sendingGroups[activeGroupUlid]) : false));
  const sendGroupMessage = useGroupStore((state) => state.sendEncryptedMessage);
  const editGroupMessage = useGroupStore((state) => state.editEncryptedMessage);
  const recallGroupMessage = useGroupStore((state) => state.recallMessage);
  const deleteGroupMessage = useGroupStore((state) => state.deleteMessage);
  const clearGroupError = useGroupStore((state) => state.clearError);
  const composingRef = useRef(false);
  const activeConversationKeyRef = useRef('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastCompositionEndRef = useRef(0);
  const lastTypingPulseRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);
  const typingConversationRef = useRef('');
  const sessions = useSocialStore((state) => state.sessions);
  const sessionMessages = useSocialStore((state) => state.messages);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const groups = useGroupStore((state) => state.groups);
  const groupMessagesByUlid = useGroupStore((state) => state.messages);
  const groupUnreadCounts = useGroupStore((state) => state.unreadCounts);
  const conversations = useMemo(
    () => projectConversations({ sessions, messages: sessionMessages, currentUserDid, peerOnline }),
    [currentUserDid, peerOnline, sessionMessages, sessions],
  );
  const groupConversations = useMemo(
    () => projectGroupConversations({ groups, messages: groupMessagesByUlid, unreadCounts: groupUnreadCounts }),
    [groupMessagesByUlid, groupUnreadCounts, groups],
  );
  const baseConversations = useMemo<MobileConversation[]>(
    () => [
      ...conversations.map((conversation) => ({ kind: 'friend' as const, key: `friend:${conversation.session.ulid}`, conversation })),
      ...groupConversations.map((conversation) => ({ kind: 'group' as const, key: `group:${conversation.group.ulid}`, conversation })),
    ],
    [conversations, groupConversations],
  );
  const conversationSurfaceItems = useMemo(
    () => buildChatConversationSurfaceItems({
      conversations: baseConversations,
      resolvePreference: (conversation) =>
        conversationPreferenceState(conversation, chatActionStates, friendConversationSettings, groupSettingsByUlid),
      resolveSearchText: conversationSearchText,
      resolveUnread: conversationUnread,
      resolveUpdatedAt: conversationUpdatedAt,
    }),
    [baseConversations, chatActionStates, friendConversationSettings, groupSettingsByUlid],
  );
  const filteredConversationSurfaceItems = useMemo(
    () => buildChatConversationSurfaceItems({
      conversations: baseConversations,
      query: conversationQuery,
      resolvePreference: (conversation) =>
        conversationPreferenceState(conversation, chatActionStates, friendConversationSettings, groupSettingsByUlid),
      resolveSearchText: conversationSearchText,
      resolveUnread: conversationUnread,
      resolveUpdatedAt: conversationUpdatedAt,
    }),
    [baseConversations, chatActionStates, conversationQuery, friendConversationSettings, groupSettingsByUlid],
  );

  const activeConversation = conversations.find((conversation) => conversation.session.ulid === activeSessionUlid);
  const activeGroupConversation = groupConversations.find((conversation) => conversation.group.ulid === activeGroupUlid);
  const activeConversationKey = activeGroupUlid ? `group:${activeGroupUlid}` : activeSessionUlid ? `friend:${activeSessionUlid}` : '';
  activeConversationKeyRef.current = activeConversationKey;
  const peerTyping = activeConversation
    ? Boolean(typingPeers[activeConversation.peerDid]?.typing)
    : Object.entries(typingPeers).some(([ptid, entry]) => ptid !== currentUserDid && entry.typing);
  const groupMemberDids = useMemo(() => new Set(groupMembers.map((member) => member.ptid).filter(Boolean)), [groupMembers]);
  const groupMemberByDid = useMemo(
    () => new Map(groupMembers.map((member) => [member.ptid, member])),
    [groupMembers],
  );
  const groupInviteCandidates = useMemo(
    () => conversations.filter((conversation) =>
      conversation.peerDid &&
      !groupMemberDids.has(conversation.peerDid) &&
      !friendshipStatus[conversation.peerDid]?.blocked,
    ),
    [conversations, friendshipStatus, groupMemberDids],
  );
  const myGroupMember = groupMembers.find((member) => member.ptid === currentUserDid);
  const myGroupRole = activeGroupConversation?.group.ownerDid === currentUserDid
    ? GroupRole.OWNER
    : Number(myGroupMember?.role ?? 0);
  const canManageGroupMembers = myGroupRole >= GroupRole.ADMIN;

  useEffect(() => {
    setThreadSearchQuery('');
    setThreadSearchOpen(false);
    setActionSheetOpen(false);
    setComposerEmojiOpen(false);
    setComposerMoreOpen(false);
    setEditingMessage(null);
    setLocalActionError('');
    setAttachmentDrafts((drafts) => {
      drafts.forEach((item) => revokeObjectUrl(item.previewUrl));
      return [];
    });
    setDraft('');
  }, [activeGroupUlid, activeSessionUlid]);

  useEffect(() => {
    let active = true;
    void loadChatActionStates(currentUserDid).then((states) => {
      if (active) setChatActionStates(states);
    });
    return () => {
      active = false;
    };
  }, [currentUserDid]);

  useEffect(() => {
    void loadCurrentUserProfile();
  }, [loadCurrentUserProfile]);

  useEffect(() => {
    const dids = new Set<string>();
    if (activeConversation?.peerDid) dids.add(activeConversation.peerDid);
    groupMembers.forEach((member) => {
      if (member.ptid && member.ptid !== currentUserDid) dids.add(member.ptid);
    });
    chatMessageSenderDids(activeGroupConversation ? groupMessages : messages, currentUserDid).forEach((did) => dids.add(did));
    dids.forEach((did) => {
      if (did && !(did in peerProfiles)) void loadPeerProfile(did);
    });
  }, [activeConversation?.peerDid, activeGroupConversation, currentUserDid, groupMembers, groupMessages, loadPeerProfile, messages, peerProfiles]);

  useEffect(() => {
    if (activeConversation?.peerDid) {
      void loadFriendshipStatus(activeConversation.peerDid).catch(() => undefined);
    }
  }, [activeConversation?.peerDid, loadFriendshipStatus]);

  useEffect(() => {
    if (!activeGroupConversation) return;
    setGroupNameDraft(activeGroupConversation.group.name);
    setGroupDescriptionDraft(activeGroupConversation.group.description);
  }, [activeGroupConversation]);

  const emitTypingState = async (typing: boolean) => {
    if (!activeConversationId) return;
    await sendTypingState(activeConversationId, typing);
  };

  useEffect(() => {
    typingConversationRef.current = activeConversationId;
    return () => {
      if (typingIdleTimerRef.current) {
        window.clearTimeout(typingIdleTimerRef.current);
        typingIdleTimerRef.current = null;
      }
      if (lastTypingPulseRef.current > 0 && typingConversationRef.current) {
        void sendTypingState(typingConversationRef.current, false);
      }
      lastTypingPulseRef.current = 0;
    };
  }, [activeConversationId, sendTypingState]);

  const handleDraftChange = (value: string) => {
    setDraft(value);
    if (!activeConversationId) return;
    const now = Date.now();
    if (value.trim() && now - lastTypingPulseRef.current > TYPING_TRUE_INTERVAL_MS) {
      lastTypingPulseRef.current = now;
      emitTypingState(true);
    }
    if (typingIdleTimerRef.current) window.clearTimeout(typingIdleTimerRef.current);
    typingIdleTimerRef.current = window.setTimeout(() => {
      emitTypingState(false);
    }, TYPING_FALSE_DELAY_MS);
  };

  const runChatOperation = async (operation: () => Promise<void>, failureKey: string) => {
    setLocalActionError('');
    try {
      await operation();
    } catch (operationError) {
      setLocalActionError(`${t(failureKey)}: ${formatChatOperationError(operationError)}`);
    }
  };

  const submitMessage = async () => {
    if (!canSubmitChatComposerDraft({ text: draft, attachmentCount: attachmentDrafts.length, capabilities: MOBILE_THREAD_COMPOSER_CAPABILITIES })) return;

    const readyAttachments = attachmentDrafts.map((item) => item.attachment);
    const messageType = chatMessageTypeForAttachments(readyAttachments) ?? 1;

    if (activeGroupConversation && activeGroupUlid) {
      if (editingMessage?.kind === 'group') {
        const edited = await editGroupMessage(activeGroupUlid, editingMessage.ulid, draft);
        if (edited) {
          setEditingMessage(null);
          setDraft('');
        } else {
          throw new Error(t('mobile.group.composerPending'));
        }
        return;
      }

      const sent = await sendGroupMessage(activeGroupUlid, draft, readyAttachments, messageType);
      if (sent) {
        setDraft('');
        clearAttachmentDrafts();
      } else {
        throw new Error(t('mobile.group.composerPending'));
      }
      return;
    }

    if (!activeConversation) return;
    if (friendshipStatus[activeConversation.peerDid]?.blocked) {
      throw new Error(t('mobile.chat.blockedComposer'));
    }
    await emitTypingState(false);

    if (editingMessage?.kind === 'friend') {
      await editMessage(activeConversation.session.ulid, editingMessage.ulid, draft);
      setEditingMessage(null);
      setDraft('');
      return;
    }

    await sendMessage(activeConversation.session.ulid, draft, readyAttachments, messageType);
    setDraft('');
    clearAttachmentDrafts();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const native = event.nativeEvent;
    if (!shouldSendComposerEnter({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: composingRef.current,
      nativeIsComposing: native.isComposing,
      keyCode: native.keyCode,
      lastCompositionEndAt: lastCompositionEndRef.current,
    })) {
      return;
    }
    event.preventDefault();
    void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed');
  };

  const startEditMessage = (kind: 'friend' | 'group', message: FriendChatMessage | GroupMessage) => {
    clearAttachmentDrafts();
    setEditingMessage({ kind, ulid: message.ulid, content: message.content });
    setDraft(message.content);
  };

  const cancelEditMessage = () => {
    setEditingMessage(null);
    setDraft('');
  };

  const clearAttachmentDrafts = () => {
    setAttachmentDrafts((drafts) => {
      drafts.forEach((item) => revokeObjectUrl(item.previewUrl));
      return [];
    });
  };

  const removeAttachmentDraft = (id: string) => {
    setAttachmentDrafts((drafts) => {
      const removed = drafts.find((item) => item.id === id);
      if (removed) revokeObjectUrl(removed.previewUrl);
      return drafts.filter((item) => item.id !== id);
    });
  };

  const openMobileFilePicker = () => {
    if (editingMessage || attachmentUploading) return;
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
        const attachment = await uploadMobileChatAttachment(authSession, file, conversationId);
        const previewUrl = URL.createObjectURL(file);
        uploadedDrafts.push({
          id: `${attachment.cid || attachment.filename}:${Date.now()}:${uploadedDrafts.length}`,
          attachment,
          previewUrl,
        });
      }
      if (uploadConversationKey !== activeConversationKeyRef.current) {
        uploadedDrafts.forEach((item) => revokeObjectUrl(item.previewUrl));
        return;
      }
      setAttachmentDrafts((current) => [...current, ...uploadedDrafts]);
    } catch (uploadError) {
      uploadedDrafts.forEach((item) => revokeObjectUrl(item.previewUrl));
      setLocalActionError(`${t('mobile.chat.attachmentUploadFailed')}: ${formatChatOperationError(uploadError)}`);
    } finally {
      setAttachmentUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const insertComposerEmoji = (emoji: string) => {
    setDraft((current) => `${current}${emoji}`);
    setComposerEmojiOpen(false);
  };

  const notifyMobileComposerToolBoundary = () => {
    setLocalActionError(t('mobile.chat.composerUnavailable'));
    setComposerMoreOpen(false);
  };

  const recallOwnMessage = async (message: FriendChatMessage) => {
    if (!activeConversation) return;
    await recallMessage(activeConversation.session.ulid, message.ulid);
  };

  const recallOwnGroupMessage = async (message: GroupMessage) => {
    if (!activeGroupUlid) return;
    await recallGroupMessage(activeGroupUlid, message.ulid);
  };

  const deleteOwnMessage = async (message: FriendChatMessage) => {
    if (!activeConversation) return;
    await deleteMessage(activeConversation.session.ulid, message.ulid);
  };

  const deleteOwnGroupMessage = async (message: GroupMessage) => {
    if (!activeGroupUlid) return;
    await deleteGroupMessage(activeGroupUlid, message.ulid);
  };

  const inviteFriendToGroup = async (peerDid: string) => {
    if (!activeGroupUlid) return;
    await inviteGroupMembers(activeGroupUlid, [peerDid]);
  };

  const removeMemberFromGroup = async (actorDid: string) => {
    if (!activeGroupUlid) return;
    await removeGroupMember(activeGroupUlid, actorDid);
  };

  const updateMemberInGroup = async (actorDid: string, input: { role?: number; muted?: boolean }) => {
    if (!activeGroupUlid) return;
    await updateGroupMember(activeGroupUlid, actorDid, input);
  };

  const confirmTransferGroupOwnership = (member: GroupMember) => {
    if (!activeGroupUlid || !member.ptid) return;
    const groupUlid = activeGroupUlid;
    const profile = peerProfiles[member.ptid];
    const memberName = member.nickname || profile?.displayName || profile?.username || member.ptid;
    Modal.confirm({
      title: t('mobile.group.transferOwnerConfirmTitle'),
      content: t('mobile.group.transferOwnerConfirmBody', { name: memberName }),
      okText: t('mobile.group.transferOwner'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: () => runChatOperation(
        () => transferGroupOwnership(groupUlid, member.ptid),
        'mobile.group.operationTransferOwnerFailed',
      ),
    });
  };

  const leaveActiveGroup = async () => {
    if (!activeGroupUlid) return;
    await leaveGroup(activeGroupUlid);
    setGroupManageOpen(false);
  };

  const confirmLeaveActiveGroup = () => {
    if (!activeGroupUlid) return;
    Modal.confirm({
      title: t('mobile.group.leaveGroupConfirmTitle'),
      content: t('mobile.group.leaveGroupConfirmBody'),
      okText: t('mobile.group.leaveGroup'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: () => runChatOperation(leaveActiveGroup, 'mobile.group.operationLeaveFailed'),
    });
  };

  const confirmDissolveActiveGroup = () => {
    if (!activeGroupUlid) return;
    const groupUlid = activeGroupUlid;
    Modal.confirm({
      title: t('mobile.group.dissolveGroupConfirmTitle'),
      content: t('mobile.group.dissolveGroupConfirmBody'),
      okText: t('mobile.group.dissolveGroup'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: () => runChatOperation(async () => {
        await dissolveGroup(groupUlid);
        setGroupManageOpen(false);
      }, 'mobile.group.operationDissolveFailed'),
    });
  };

  const saveGroupProfile = async () => {
    if (!activeGroupUlid) return;
    await updateGroup(activeGroupUlid, {
      name: groupNameDraft.trim(),
      description: groupDescriptionDraft.trim(),
    });
  };

  const toggleGroupMuted = async (muted: boolean) => {
    if (!activeGroupUlid) return;
    await updateGroup(activeGroupUlid, { muted });
  };

  const toggleMyGroupSetting = async (key: 'isMuted' | 'isPinned' | 'showMemberNickname', value: boolean) => {
    if (!activeGroupUlid) return;
    await updateGroupSettings(activeGroupUlid, { [key]: value });
  };

  const confirmBlockActivePeer = () => {
    if (!activeConversation) return;
    Modal.confirm({
      title: t('mobile.contacts.blockConfirmTitle'),
      content: t('mobile.contacts.blockConfirmBody'),
      okText: t('mobile.contacts.block'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await blockUser(activeConversation.peerDid);
        setActionSheetOpen(false);
      },
    });
  };

  const confirmUnblockActivePeer = () => {
    if (!activeConversation) return;
    Modal.confirm({
      title: t('mobile.contacts.unblockConfirmTitle'),
      content: t('mobile.contacts.unblockConfirmBody'),
      okText: t('mobile.contacts.unblock'),
      cancelText: t('common.action.cancel'),
      onOk: async () => {
        await unblockUser(activeConversation.peerDid);
      },
    });
  };

  const openConversation = async (conversation: MobileConversation) => {
    if (conversation.kind === 'friend') {
      await selectGroup(null);
      await selectSession(conversation.conversation.session.ulid);
      return;
    }

    await selectSession(null);
    await selectGroup(conversation.conversation.group.ulid);
  };

  const updateChatActionState = async (key: string, patch: Partial<ChatActionState>) => {
    if (activeConversation) {
      await updateFriendConversationSettings(activeConversation.session.ulid, friendPatchFromActionPatch(patch));
    } else if (activeGroupUlid) {
      await updateGroupSettings(activeGroupUlid, groupPatchFromActionPatch(patch));
    }
    const next = {
      ...chatActionStates,
      [key]: {
        ...(chatActionStates[key] ?? defaultChatActionState()),
        ...patch,
      },
    };
    setChatActionStates(next);
    await saveChatActionStates(currentUserDid, next);
  };

  const scrollToMessage = (messageUlid: string) => {
    setHighlightedMessageUlid(messageUlid);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-message-ulid="${messageUlid}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => setHighlightedMessageUlid(''), 1800);
    });
  };

  if (activeConversation || activeGroupConversation) {
    const isGroupThread = Boolean(activeGroupConversation);
    const title = activeGroupConversation?.group.name || activeConversation?.peerName || '';
    const activeKey = chatActionKey(isGroupThread ? 'group' : 'friend', activeGroupUlid || activeSessionUlid || '');
    const actionState = isGroupThread
      ? groupSettingsToActionState(groupSettings, chatActionStates[activeKey])
      : friendSettingsToActionState(activeSessionUlid ? friendConversationSettings[activeSessionUlid] : undefined, chatActionStates[activeKey]);
    const ownAvatar = currentUserProfile?.avatar || '';
    const ownName = authSession?.actor?.displayName || authSession?.actor?.display_name || authSession?.actor?.username || currentUserDid || '';
    const peerProfile = activeConversation ? peerProfiles[activeConversation.peerDid] : null;
    const activePeerBlocked = activeConversation ? Boolean(friendshipStatus[activeConversation.peerDid]?.blocked) : false;
    const peerMessageAvatar = activeGroupConversation ? '' : (peerProfile?.avatar || activeConversation?.peerAvatar);
    const stationName = stationHostFromUrl(authSession?.stationUrl);
    const subtitle = activeGroupConversation
      ? peerTyping
        ? t('mobile.chat.typing')
        : t('mobile.group.memberCount', { count: activeGroupConversation.group.memberCount })
      : peerTyping
        ? t('mobile.chat.typing')
        : t('mobile.chat.peerAtStation', { station: stationName });
    const rawThreadMessages: Array<FriendChatMessage | GroupMessage> = activeGroupConversation ? groupMessages : messages;
    const threadMessages = filterChatMessagesAfterClearedAt(
      rawThreadMessages,
      actionState.clearedAt,
      (message) => messageTimestampMillis(message, isGroupThread),
    );
    const threadSearchResults = localThreadSearchResults(threadMessages, threadSearchQuery, isGroupThread);

    return (
      <div className="page-container chat-thread-page" style={MOBILE_THREAD_VISUAL_VARS}>
        <header className={`page-header chat-thread-header ${threadSearchOpen ? 'searching' : ''}`}>
          <button
            className="header-action"
            type="button"
            onClick={() => {
              void selectSession(null);
              void selectGroup(null);
            }}
            aria-label={t('common.action.back')}
          >
            <ArrowLeft size={20} />
          </button>
          {threadSearchOpen ? (
            <>
              <Input.Search
                className="chat-header-search"
                value={threadSearchQuery}
                onChange={(event) => setThreadSearchQuery(event.target.value)}
                prefix={<Search size={16} />}
                placeholder={t('mobile.chat.searchMessagesPlaceholder')}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                allowClear
                onSearch={setThreadSearchQuery}
              />
              <button
                className="header-action"
                type="button"
                onClick={() => {
                  setThreadSearchOpen(false);
                  setThreadSearchQuery('');
                }}
                aria-label={t('common.action.cancel')}
              >
                <X size={18} />
              </button>
            </>
          ) : (
            <>
              <div className="header-title-stack">
                <h1 className="header-title compact">{title}</h1>
                <Text type="secondary">{subtitle}</Text>
              </div>
              <button
                className="header-action"
                type="button"
                onClick={() => setActionSheetOpen(true)}
                aria-label={t('mobile.chat.moreActions')}
              >
                <MoreHorizontal size={20} />
              </button>
            </>
          )}
        </header>

        <ChatActionSheet
          open={actionSheetOpen}
          state={actionState}
          onClose={() => setActionSheetOpen(false)}
          onSearch={() => {
            setThreadSearchOpen(true);
            setActionSheetOpen(false);
          }}
          onToggleMute={() => { void updateChatActionState(activeKey, { muted: !actionState.muted }); }}
          onToggleSticky={() => { void updateChatActionState(activeKey, { sticky: !actionState.sticky }); }}
          onToggleAlert={() => { void updateChatActionState(activeKey, { alertEnabled: !actionState.alertEnabled }); }}
          onSelectBackground={(background) => { void updateChatActionState(activeKey, { background }); }}
          onClearHistory={() => {
            Modal.confirm({
              title: t('mobile.chat.clearHistoryConfirmTitle'),
              content: t('mobile.chat.clearHistoryConfirmBody'),
              okText: t('mobile.chat.quickClearHistory'),
              cancelText: t('common.action.cancel'),
              okButtonProps: { danger: true },
              onOk: () => { void updateChatActionState(activeKey, { clearedAt: Date.now() }); },
            });
          }}
          onRestoreHistory={() => { void updateChatActionState(activeKey, { clearedAt: 0 }); }}
          isFriendThread={Boolean(activeConversation)}
          onManageGroup={activeGroupConversation ? () => {
            setGroupManageOpen(true);
            setActionSheetOpen(false);
          } : undefined}
          peerBlocked={activePeerBlocked}
          onBlockPeer={confirmBlockActivePeer}
          onUnblockPeer={confirmUnblockActivePeer}
        />

        {localActionError ? (
          <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice>
        ) : null}

        {threadSearchQuery.trim() ? (
          <section className="message-search-panel">
            {threadSearchResults.length > 0 ? (
              threadSearchResults.map((message) => (
                <button className="message-search-result" type="button" key={message.ulid} onClick={() => scrollToMessage(message.ulid)}>
                  <Text ellipsis>{messageContentForSearch(message, isGroupThread, t)}</Text>
                  <Text type="secondary">{formatRelativeTime(messageTimestampMillis(message, isGroupThread), t)}</Text>
                </button>
              ))
            ) : (
              <Text type="secondary">{t('mobile.chat.noMessageResults')}</Text>
            )}
          </section>
        ) : null}

        <section className={`message-list chat-background-${actionState.background}`}>
          {threadMessages.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.chat.emptyThread')} />
          ) : (
            threadMessages.map((message) => {
              const mine = isOwnChatMessage(message, currentUserDid);
              const recalled = isRecalledChatMessage(message);
              const groupDisplay = isGroupThread ? projectGroupMessageDisplay(message as GroupMessage) : null;
              const content = groupDisplay
                ? groupMessageDisplayText(groupDisplay, t)
                : friendMessageDisplayText(message as FriendChatMessage, t);
              const attachments = chatMessageAttachments(message);
              const hasAttachmentOnlyPreview = attachments.length > 0 && content === t('mobile.chat.noPreview');
              const canEditMessage = canEditChatMessage({
                own: mine,
                recalled,
                encrypted: groupDisplay?.kind === 'encrypted',
                content: message.content,
              });
              return (
                <div
                  key={message.ulid}
                  data-message-ulid={message.ulid}
                  className={`message-bubble-row ${mine ? 'mine' : 'peer'} ${highlightedMessageUlid === message.ulid ? 'highlighted' : ''}`}
                >
                  {!mine ? (
                    <MessageAvatar
                      src={messageAvatarUrl(message, peerProfiles, peerMessageAvatar)}
                      fallback={messageSenderFallback(message, groupMemberByDid, activeConversation?.peerName || title)}
                    />
                  ) : null}
                  <div className="message-bubble">
                    {!hasAttachmentOnlyPreview ? (
                      <Text className="message-text">
                        {content}
                        <span className="message-meta">
                          {message.editedAt && !recalled ? <span>{t('mobile.chat.edited')}</span> : null}
                          <span>{formatRelativeTime(messageTimestampMillis(message, isGroupThread), t)}</span>
                          {mine && !recalled && !isGroupThread && 'status' in message ? (
                            <MessageStatusIcon status={message.status} />
                          ) : null}
                        </span>
                      </Text>
                    ) : null}
                    {!recalled && attachments.length > 0 ? (
                      <MobileMessageAttachments attachments={attachments} isOwn={mine} session={authSession} />
                    ) : null}
                    {hasAttachmentOnlyPreview ? (
                      <span className="message-meta attachment-only-meta">
                        <span>{formatRelativeTime(messageTimestampMillis(message, isGroupThread), t)}</span>
                        {mine && !isGroupThread && 'status' in message ? <MessageStatusIcon status={message.status} /> : null}
                      </span>
                    ) : null}
                    {mine && !recalled ? (
                      <span className="message-actions">
                        {canEditMessage ? (
                          <button
                            type="button"
                            className="message-action-button"
                            aria-label={t('mobile.chat.edit')}
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditMessage(isGroupThread ? 'group' : 'friend', message);
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="message-action-button"
                          aria-label={t('mobile.chat.recall')}
                          onClick={(event) => {
                            event.stopPropagation();
                            void runChatOperation(
                              () => isGroupThread
                                ? recallOwnGroupMessage(message as GroupMessage)
                                : recallOwnMessage(message as FriendChatMessage),
                              'mobile.chat.operationRecallFailed',
                            );
                          }}
                        >
                          <RotateCcw size={13} />
                        </button>
                        <Popconfirm
                          title={t('mobile.chat.deleteConfirm')}
                          okText={t('common.action.delete')}
                          cancelText={t('common.action.cancel')}
                          onConfirm={() => {
                            void runChatOperation(
                              () => isGroupThread
                                ? deleteOwnGroupMessage(message as GroupMessage)
                                : deleteOwnMessage(message as FriendChatMessage),
                              'mobile.chat.operationDeleteFailed',
                            );
                          }}
                        >
                          <button
                            type="button"
                            className="message-action-button"
                            aria-label={t('common.action.delete')}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Popconfirm>
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
          <footer className="message-composer readonly">
            <Text type="secondary">{t('mobile.chat.blockedComposer')}</Text>
          </footer>
        ) : isGroupThread && !groupEncryptionReady ? (
          <footer className="message-composer readonly">
            <Text type="secondary">{t('mobile.group.composerPending')}</Text>
          </footer>
        ) : (
          <footer className="message-composer">
            {editingMessage ? (
              <div className="message-editing-banner">
                <Text type="secondary" ellipsis>{t('mobile.chat.editing')}</Text>
                <button type="button" className="message-action-button light" onClick={cancelEditMessage} aria-label={t('common.action.cancel')}>
                  <X size={13} />
                </button>
              </div>
            ) : null}
            {composerEmojiOpen ? (
              <div className="message-composer-panel emoji-panel">
                {MOBILE_COMPOSER_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="composer-emoji-button"
                    aria-label={t('mobile.chat.composerEmoji')}
                    onClick={() => insertComposerEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
            {composerMoreOpen ? (
              <div className="message-composer-panel more-panel">
                <ComposerToolButton icon={<FolderOpen size={16} />} label={t('mobile.chat.composerFile')} onClick={openMobileFilePicker} disabled={attachmentUploading || Boolean(editingMessage)} />
                <ComposerToolButton icon={<Scissors size={16} />} label={t('mobile.chat.composerScreenshot')} onClick={notifyMobileComposerToolBoundary} />
                <ComposerToolButton icon={<Mic size={16} />} label={t('mobile.chat.composerVoice')} onClick={notifyMobileComposerToolBoundary} />
              </div>
            ) : null}
            {attachmentDrafts.length > 0 || attachmentUploading ? (
              <div className="message-composer-panel attachment-draft-panel">
                {attachmentDrafts.map((item) => (
                  <AttachmentDraftChip key={item.id} draft={item} onRemove={() => removeAttachmentDraft(item.id)} />
                ))}
                {attachmentUploading ? <Spin size="small" /> : null}
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              className="visually-hidden-file-input"
              type="file"
              multiple
              onChange={(event) => { void handleMobileFilesSelected(event.target.files); }}
            />
            {MOBILE_THREAD_COMPOSER_CAPABILITIES.emoji ? (
              <button
                type="button"
                className={`message-composer-tool ${composerEmojiOpen ? 'active' : ''}`}
                aria-label={t('mobile.chat.composerEmoji')}
                onClick={() => {
                  setComposerEmojiOpen((open) => !open);
                  setComposerMoreOpen(false);
                }}
                disabled={groupSending}
              >
                <Smile size={18} />
              </button>
            ) : null}
            <Input
              className="message-composer-input"
              value={draft}
              onChange={(event) => handleDraftChange(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
                lastCompositionEndRef.current = Date.now();
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder={t('mobile.chat.messagePlaceholder')}
              disabled={groupSending}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
            <button
              type="button"
              className={`message-composer-tool ${composerMoreOpen ? 'active' : ''}`}
              aria-label={t('mobile.chat.composerMore')}
              onClick={() => {
                setComposerMoreOpen((open) => !open);
                setComposerEmojiOpen(false);
              }}
              disabled={groupSending || Boolean(editingMessage)}
            >
              <Plus size={18} />
            </button>
            <Button
              className="message-send-button"
              type="primary"
              icon={<Send size={16} />}
              disabled={!canSubmitChatComposerDraft({ text: draft, attachmentCount: attachmentDrafts.length, capabilities: MOBILE_THREAD_COMPOSER_CAPABILITIES }) || groupSending || attachmentUploading}
              loading={groupSending || attachmentUploading}
              onClick={() => void runChatOperation(submitMessage, 'mobile.chat.operationSendFailed')}
            />
          </footer>
        )}

        {activeGroupConversation ? (
          <Modal
            title={t('mobile.group.members')}
            open={groupManageOpen}
            onCancel={() => setGroupManageOpen(false)}
            footer={null}
            destroyOnClose
          >
            <div className="group-management-panel">
              <SectionTitle title={t('mobile.group.profile')} count={activeGroupConversation.group.memberCount} />
              <Input
                value={groupNameDraft}
                onChange={(event) => setGroupNameDraft(event.target.value)}
                placeholder={t('mobile.group.namePlaceholder')}
                disabled={!canManageGroupMembers}
              />
              <Input.TextArea
                value={groupDescriptionDraft}
                onChange={(event) => setGroupDescriptionDraft(event.target.value)}
                placeholder={t('mobile.group.descriptionPlaceholder')}
                autoSize={{ minRows: 2, maxRows: 4 }}
                disabled={!canManageGroupMembers}
              />
              {canManageGroupMembers ? (
                <Button type="primary" onClick={saveGroupProfile} disabled={!groupNameDraft.trim()}>
                  {t('common.action.save')}
                </Button>
              ) : null}

              <div className="group-setting-row">
                <Text>{t('mobile.group.muted')}</Text>
                <Switch checked={Boolean(activeGroupConversation.group.muted)} onChange={toggleGroupMuted} disabled={!canManageGroupMembers} />
              </div>
              <div className="group-setting-row">
                <Text>{t('mobile.group.myMuted')}</Text>
                <Switch checked={Boolean(groupSettings?.isMuted)} onChange={(value) => toggleMyGroupSetting('isMuted', value)} />
              </div>
              <div className="group-setting-row">
                <Text>{t('mobile.group.pinned')}</Text>
                <Switch checked={Boolean(groupSettings?.isPinned)} onChange={(value) => toggleMyGroupSetting('isPinned', value)} />
              </div>
              <div className="group-setting-row">
                <Text>{t('mobile.group.showMemberNickname')}</Text>
                <Switch checked={Boolean(groupSettings?.showMemberNickname)} onChange={(value) => toggleMyGroupSetting('showMemberNickname', value)} />
              </div>

              <SectionTitle title={t('mobile.group.members')} count={groupMembers.length} />
              {groupMembers.length > 0 ? (
                <List
                  dataSource={groupMembers}
                  renderItem={(member) => {
                    const profile = peerProfiles[member.ptid];
                    const memberName = member.nickname || profile?.displayName || profile?.username || member.ptid;
                    const memberRole = Number(member.role ?? GroupRole.MEMBER);
                    const memberControls = getMobileGroupMemberControlState({
                      canManageGroupMembers,
                      isSelf: member.ptid === currentUserDid,
                      myGroupRole,
                      targetRole: memberRole,
                    });
                    return (
                      <List.Item
                        actions={[
                          memberControls.canPromoteOrDemote ? (
                            <Button
                              key="role"
                              size="small"
                              onClick={() => updateMemberInGroup(member.ptid, {
                                role: memberRole === GroupRole.ADMIN ? GroupRole.MEMBER : GroupRole.ADMIN,
                              })}
                            >
                              {memberRole === GroupRole.ADMIN ? t('mobile.group.demoteAdmin') : t('mobile.group.promoteAdmin')}
                            </Button>
                          ) : null,
                          memberControls.canTransferOwnership ? (
                            <Button
                              key="transfer"
                              size="small"
                              onClick={() => confirmTransferGroupOwnership(member)}
                            >
                              {t('mobile.group.transferOwner')}
                            </Button>
                          ) : null,
                          memberControls.canMute ? (
                            <Button
                              key="mute"
                              size="small"
                              onClick={() => updateMemberInGroup(member.ptid, { muted: !member.muted })}
                            >
                              {member.muted ? t('mobile.group.unmuteMember') : t('mobile.group.muteMember')}
                            </Button>
                          ) : null,
                          memberControls.canRemove ? (
                            <Button
                              key="remove"
                              size="small"
                              danger
                              onClick={() => removeMemberFromGroup(member.ptid)}
                            >
                              {t('mobile.group.removeMember')}
                            </Button>
                          ) : null,
                        ].filter(Boolean)}
                      >
                        <List.Item.Meta
                          avatar={<MobileAvatar src={profile?.avatar}>{memberName.slice(0, 1)}</MobileAvatar>}
                          title={<Text strong>{memberName}</Text>}
                          description={<Text type="secondary" copyable>{member.ptid}</Text>}
                        />
                        <Tag>{groupRoleLabel(memberRole, t)}</Tag>
                        {member.muted ? <Tag color="warning">{t('mobile.group.memberMuted')}</Tag> : null}
                      </List.Item>
                    );
                  }}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noMembers')} />
              )}

              <SectionTitle title={t('mobile.group.inviteFriends')} count={groupInviteCandidates.length} />
              {groupInviteCandidates.length > 0 ? (
                <List
                  dataSource={groupInviteCandidates}
                  renderItem={(candidate) => (
                    <List.Item
                      actions={[
                        <Button key="invite" size="small" type="primary" onClick={() => inviteFriendToGroup(candidate.peerDid)}>
                          {t('mobile.group.invite')}
                        </Button>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={<MobileAvatar src={candidate.peerAvatar}>{candidate.peerName.slice(0, 1)}</MobileAvatar>}
                        title={<Text strong>{candidate.peerName}</Text>}
                        description={<Text type="secondary" copyable>{candidate.peerDid}</Text>}
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noInviteCandidates')} />
              )}

              <Button danger block onClick={myGroupRole === GroupRole.OWNER ? confirmDissolveActiveGroup : confirmLeaveActiveGroup}>
                {myGroupRole === GroupRole.OWNER ? t('mobile.group.dissolveGroup') : t('mobile.group.leaveGroup')}
              </Button>
            </div>
          </Modal>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <img src={logo} alt="Peers Touch" className="header-logo" />
        <h1 className="header-title">{t('mobile.chat.title')}</h1>
      </header>

      <div className="chat-search-bar">
        <Input
          value={conversationQuery}
          onChange={(event) => setConversationQuery(event.target.value)}
          prefix={<Search size={16} />}
          placeholder={t('mobile.chat.searchPlaceholder')}
          allowClear
        />
      </div>

      {localActionError ? (
        <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice>
      ) : null}
      {error ? (
        <MobileNotice onClose={clearSocialError}>{formatSocialError(error)}</MobileNotice>
      ) : null}
      {groupError ? (
        <MobileNotice onClose={clearGroupError}>{formatSocialError(groupError)}</MobileNotice>
      ) : null}

      <section className="social-list-panel">
        <Spin spinning={(loading || groupLoading) && filteredConversationSurfaceItems.length === 0}>
          {filteredConversationSurfaceItems.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                conversationSurfaceItems.length > 0
                  ? t('mobile.chat.noSearchResults')
                  : (
                    <div className="empty-copy">
                      <Text strong>{t('mobile.chat.emptyTitle')}</Text>
                      <Text type="secondary">{t('mobile.chat.emptySubtitle')}</Text>
                    </div>
                  )
              }
            />
          ) : (
            <List
              dataSource={filteredConversationSurfaceItems}
              renderItem={(item) => {
                const { conversation, preference: preferenceState, updatedAt, visibleUnread } = item;
                return (
                  <List.Item className="conversation-item" onClick={() => openConversation(conversation)}>
                    <List.Item.Meta
                      avatar={
                        <span className="conversation-avatar-frame">
                          <MobileAvatar src={conversationAvatar(conversation)}>{conversationTitle(conversation).slice(0, 1)}</MobileAvatar>
                          {conversation.kind === 'friend' && conversation.conversation.peerOnline ? (
                            <span className="conversation-online-dot" aria-hidden="true" />
                          ) : null}
                        </span>
                      }
                      title={
                        <span className="conversation-title-row">
                          <Text strong>{conversationTitle(conversation)}</Text>
                          {conversation.kind === 'group' ? <Users size={13} /> : null}
                          {chatStateTags(preferenceState, t).map((tag) => (
                            <Tag key={tag} className="conversation-state-tag">{tag}</Tag>
                          ))}
                        </span>
                      }
                      description={conversationPreview(conversation, t)}
                    />
                    <div className="conversation-meta">
                      <Text type="secondary">{formatRelativeTime(updatedAt, t)}</Text>
                      {visibleUnread > 0 ? <Badge count={visibleUnread} /> : null}
                    </div>
                  </List.Item>
                );
              }}
            />
          )}
        </Spin>
      </section>
    </div>
  );
}

function MessageStatusIcon({ status }: { status: number }) {
  if (status >= FriendMessageStatus.READ) return <CheckCheck size={13} className="message-status-icon read" />;
  if (status >= FriendMessageStatus.DELIVERED) return <CheckCheck size={13} className="message-status-icon" />;
  return <Check size={13} className="message-status-icon" />;
}

function MessageAvatar({ src, fallback }: { src: string; fallback: string }) {
  return (
    <MobileAvatar className="message-avatar" src={src}>
      {(fallback || '?').slice(0, 1).toUpperCase()}
    </MobileAvatar>
  );
}

function ChatActionSheet({
  open,
  state,
  onClose,
  onSearch,
  onToggleMute,
  onToggleSticky,
  onToggleAlert,
  onSelectBackground,
  onClearHistory,
  onRestoreHistory,
  isFriendThread,
  onManageGroup,
  peerBlocked,
  onBlockPeer,
  onUnblockPeer,
}: {
  open: boolean;
  state: ChatActionState;
  onClose: () => void;
  onSearch: () => void;
  onToggleMute: () => void;
  onToggleSticky: () => void;
  onToggleAlert: () => void;
  onSelectBackground: (background: ChatBackgroundId) => void;
  onClearHistory: () => void;
  onRestoreHistory: () => void;
  isFriendThread: boolean;
  onManageGroup?: () => void;
  peerBlocked: boolean;
  onBlockPeer: () => void;
  onUnblockPeer: () => void;
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
          <button className="header-action" type="button" aria-label={t('common.action.close')} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="chat-action-list">
          <div className="chat-action-group">
            <ChatActionButton icon={<Search size={18} />} title={t('mobile.chat.quickSearch')} onClick={onSearch} />
            <ChatActionButton
              icon={<VolumeX size={18} />}
              title={t('mobile.chat.quickMute')}
              active={state.muted}
              onClick={onToggleMute}
            />
            <ChatActionButton
              icon={<Pin size={18} />}
              title={t('mobile.chat.quickSticky')}
              active={state.sticky}
              onClick={onToggleSticky}
            />
            <ChatActionButton
              icon={<Bell size={18} />}
              title={t('mobile.chat.quickAlert')}
              active={state.alertEnabled}
              onClick={onToggleAlert}
            />
          </div>
          <div className="chat-background-section">
            <Text type="secondary" className="chat-background-title">{t('mobile.chat.quickBackground')}</Text>
            <div className="chat-background-grid">
              {CHAT_BACKGROUND_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={`chat-background-choice chat-background-${option} ${state.background === option ? 'active' : ''}`}
                  type="button"
                  onClick={() => onSelectBackground(option)}
                >
                  <Image size={14} />
                  <span>{t(`mobile.chat.background.${option}`)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="chat-action-group">
            {state.clearedAt ? (
              <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.chat.quickRestoreHistory')} onClick={onRestoreHistory} />
            ) : null}
            {onManageGroup ? (
              <ChatActionButton icon={<Users size={18} />} title={t('mobile.group.members')} onClick={onManageGroup} />
            ) : null}
          </div>
          <div className="chat-action-group danger">
            <ChatActionButton icon={<Trash2 size={18} />} title={t('mobile.chat.quickClearHistory')} danger onClick={onClearHistory} />
            {isFriendThread ? (
              peerBlocked ? (
                <ChatActionButton icon={<RotateCcw size={18} />} title={t('mobile.contacts.unblock')} onClick={onUnblockPeer} />
              ) : (
                <ChatActionButton icon={<Ban size={18} />} title={t('mobile.contacts.block')} danger onClick={onBlockPeer} />
              )
            ) : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

function ChatActionButton({
  icon,
  title,
  active,
  danger,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`chat-action-button ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} type="button" onClick={onClick}>
      <span className="chat-action-icon">{icon}</span>
      <span>{title}</span>
    </button>
  );
}

function ComposerToolButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="composer-tool-option" type="button" onClick={onClick} disabled={disabled}>
      <span className="composer-tool-option-icon">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function AttachmentDraftChip({ draft, onRemove }: { draft: MobileChatAttachmentDraft; onRemove: () => void }) {
  const { t } = useMobileI18n();
  const kind = chatMediaKindForAttachment(draft.attachment);
  return (
    <div className="attachment-draft-chip">
      {kind === 'image' ? <img src={draft.previewUrl} alt={draft.attachment.filename} /> : <Paperclip size={15} />}
      <span>{draft.attachment.filename}</span>
      <button type="button" onClick={onRemove} aria-label={t('common.action.delete')}>
        <X size={12} />
      </button>
    </div>
  );
}

function MobileMessageAttachments({
  attachments,
  isOwn,
  session,
}: {
  attachments: Array<FriendMessageAttachment | GroupMessageAttachment>;
  isOwn: boolean;
  session: MobileAuthSession | null;
}) {
  return (
    <div className={`mobile-message-attachments ${isOwn ? 'own' : 'peer'}`}>
      {attachments.map((attachment, index) => (
        <MobileMessageAttachmentItem
          key={`${attachment.cid || attachment.filename}-${index}`}
          attachment={attachment}
          session={session}
        />
      ))}
    </div>
  );
}

function MobileMessageAttachmentItem({
  attachment,
  session,
}: {
  attachment: FriendMessageAttachment | GroupMessageAttachment;
  session: MobileAuthSession | null;
}) {
  const { t } = useMobileI18n();
  const [objectUrl, setObjectUrl] = useState('');
  const kind = chatMediaKindForAttachment(attachment);
  const filename = attachment.filename || t('mobile.chat.attachmentUnnamed');
  const sizeLabel = formatChatAttachmentSize(Number(attachment.size ?? 0));

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl = '';
    if (!session || !attachment.cid) {
      setObjectUrl('');
      return undefined;
    }

    void fetchAttachmentBlobUrl(session.stationUrl, session.accessToken, attachment)
      .then((url) => {
        if (cancelled) {
          revokeObjectUrl(url);
          return;
        }
        nextObjectUrl = url;
        setObjectUrl(url);
      })
      .catch(() => {
        if (!cancelled) setObjectUrl('');
      });

    return () => {
      cancelled = true;
      revokeObjectUrl(nextObjectUrl);
    };
  }, [attachment.cid, session]);

  const openAttachment = () => {
    if (objectUrl) window.open(objectUrl, '_blank');
  };

  if (kind === 'image' && objectUrl) {
    return (
      <button type="button" className="mobile-attachment-image" onClick={openAttachment}>
        <img src={objectUrl} alt={filename} />
      </button>
    );
  }

  return (
    <button type="button" className="mobile-attachment-card" onClick={openAttachment} disabled={!objectUrl}>
      <Paperclip size={16} />
      <span className="mobile-attachment-info">
        <span>{filename}</span>
        <small>{sizeLabel || attachment.mimeType}</small>
      </span>
    </button>
  );
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!value) return '';
  const delta = Date.now() - value;
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return t('common.time.justNow');
  if (minutes < 60) return t('common.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.time.hoursAgo', { count: hours });
  return new Date(value).toLocaleDateString();
}

function conversationTitle(conversation: MobileConversation): string {
  return conversation.kind === 'friend' ? conversation.conversation.peerName : conversation.conversation.group.name;
}

function conversationAvatar(conversation: MobileConversation): string {
  return conversation.kind === 'friend' ? conversation.conversation.peerAvatar : conversation.conversation.group.avatarCid;
}

function conversationUnread(conversation: MobileConversation): number {
  return conversation.kind === 'friend' ? conversation.conversation.unread : conversation.conversation.unread;
}

function conversationPreview(conversation: MobileConversation, t: (key: string) => string): string {
  if (conversation.kind === 'group') {
    const lastMessage = conversation.conversation.lastMessage;
    if (!lastMessage) return t('mobile.chat.noPreview');
    const text = groupMessageDisplayText(projectGroupMessageDisplay(lastMessage), t);
    if (text !== t('mobile.chat.noPreview')) return text;
    return chatMessageAttachments(lastMessage)[0]?.filename || t('mobile.chat.noPreview');
  }

  const lastMessage = conversation.conversation.lastMessage;
  if (lastMessage) return friendMessageDisplayText(lastMessage, t);
  return conversation.conversation.session.lastMessageUlid ? t('mobile.chat.latestMessage') : t('mobile.chat.noPreview');
}

function conversationUpdatedAt(conversation: MobileConversation): number {
  if (conversation.kind === 'friend') {
    return timestampMillis(conversation.conversation.session.lastMessageAt);
  }
  return groupTimestampMillis(conversation.conversation.lastMessage?.sentAt ?? conversation.conversation.group.updatedAt ?? conversation.conversation.group.createdAt);
}

function conversationSearchText(conversation: MobileConversation): string {
  if (conversation.kind === 'friend') {
    return `${conversation.conversation.peerName} ${conversation.conversation.peerDid} ${conversation.conversation.lastMessage?.content ?? ''} ${attachmentSearchText(conversation.conversation.lastMessage)}`;
  }
  return `${conversation.conversation.group.name} ${conversation.conversation.group.ulid} ${conversation.conversation.lastMessage?.content ?? ''} ${attachmentSearchText(conversation.conversation.lastMessage)}`;
}

function messageTimestampMillis(message: FriendChatMessage | GroupMessage, isGroupThread: boolean): number {
  if (isGroupThread) return groupTimestampMillis((message as GroupMessage).sentAt ?? (message as GroupMessage).createdAt);
  return timestampMillis((message as FriendChatMessage).sentAt ?? (message as FriendChatMessage).createdAt);
}

function friendMessageDisplayText(message: FriendChatMessage, t: (key: string) => string): string {
  const kind = chatMessageDisplayKind({ content: message.content, recalled: message.recalled });
  if (kind === 'text') return message.content;
  if (kind === 'recalled') return t('mobile.chat.recalledMessage');
  const attachment = chatMessageAttachments(message)[0];
  if (attachment) return attachment.filename || t('mobile.chat.attachmentMessage');
  return t('mobile.chat.noPreview');
}

function groupMessageDisplayText(display: GroupMessageDisplay, t: (key: string) => string): string {
  const kind = chatMessageDisplayKind({
    content: display.kind === 'text' ? display.content : '',
    recalled: display.kind === 'recalled',
    encrypted: display.kind === 'encrypted',
  });
  if (kind === 'text' && display.kind === 'text') return display.content;
  if (kind === 'recalled') return t('mobile.chat.recalledMessage');
  if (kind === 'encrypted') return t('mobile.group.encryptedMessage');
  return t('mobile.chat.noPreview');
}

function messageContentForSearch(
  message: FriendChatMessage | GroupMessage,
  isGroupThread: boolean,
  t: (key: string) => string,
): string {
  return isGroupThread
    ? groupMessageDisplayText(projectGroupMessageDisplay(message as GroupMessage), t)
    : friendMessageDisplayText(message as FriendChatMessage, t);
}

function localThreadSearchResults(
  messages: Array<FriendChatMessage | GroupMessage>,
  query: string,
  isGroupThread: boolean,
): Array<FriendChatMessage | GroupMessage> {
  return filterChatMessagesBySearchText(messages, query, (message) => (
    isGroupThread
      ? `${groupSearchableContent(projectGroupMessageDisplay(message as GroupMessage))} ${attachmentSearchText(message)}`
      : `${(message as FriendChatMessage).content} ${attachmentSearchText(message)}`
  ));
}

function chatMessageAttachments(message?: FriendChatMessage | GroupMessage): Array<FriendMessageAttachment | GroupMessageAttachment> {
  const attachments = message?.attachments;
  return Array.isArray(attachments) ? attachments : [];
}

function attachmentSearchText(message?: FriendChatMessage | GroupMessage): string {
  return chatMessageAttachments(message)
    .map((attachment) => `${attachment.filename ?? ''} ${attachment.mimeType ?? ''}`)
    .join(' ');
}

async function fetchAttachmentBlobUrl(
  stationUrl: string,
  accessToken: string,
  attachment: FriendMessageAttachment | GroupMessageAttachment,
): Promise<string> {
  const url = attachmentDownloadUrl(stationUrl, attachment.cid);
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`attachment-fetch:${response.status}`);
  const blob = await response.blob();
  const plaintext = await decryptClientMediaBlob({
    ciphertext: blob,
    descriptor: mediaEncryptionDescriptorForAttachment(attachment),
    mimeType: attachment.mimeType || 'application/octet-stream',
  });
  return URL.createObjectURL(plaintext);
}

function mediaEncryptionDescriptorForAttachment(
  attachment: FriendMessageAttachment | GroupMessageAttachment,
): Partial<ClientMediaEncryptionDescriptor> | null {
  const record = attachment as unknown as Partial<GroupMessageAttachment & FriendMessageAttachment>;
  if (record.mediaEncryption?.encrypted) {
    const descriptor = record.mediaEncryption;
    return {
      encrypted: true,
      version: Number(descriptor.version) as ClientMediaEncryptionDescriptor['version'],
      suite: descriptor.suite as ClientMediaEncryptionDescriptor['suite'],
      keyB64: descriptor.keyB64,
      nonceB64: descriptor.nonceB64,
      plaintextSha256B64: descriptor.plaintextSha256B64,
      ciphertextSha256B64: descriptor.ciphertextSha256B64,
      plaintextSize: Number(descriptor.plaintextSize ?? record.size ?? 0),
      ciphertextSize: Number(descriptor.ciphertextSize ?? record.size ?? 0),
    };
  }
  const suite = record.encryptionSuite ?? '';
  const keyB64 = record.encryptionKeyB64 ?? '';
  const nonceB64 = record.encryptionNonceB64 ?? '';
  const plaintextSha256B64 = record.plaintextSha256B64 ?? '';
  const ciphertextSha256B64 = record.ciphertextSha256B64 ?? '';
  if (!suite || !keyB64 || !nonceB64 || !plaintextSha256B64 || !ciphertextSha256B64) return null;
  return {
    encrypted: true,
    version: 1,
    suite: suite as ClientMediaEncryptionDescriptor['suite'],
    keyB64,
    nonceB64,
    plaintextSha256B64,
    ciphertextSha256B64,
    plaintextSize: Number(record.plaintextSize ?? record.size ?? 0),
    ciphertextSize: Number(record.ciphertextSize ?? record.size ?? 0),
  };
}

function attachmentDownloadUrl(stationUrl: string, cid: string): string {
  const parsed = parseOssCid(cid, stationUrl);
  const url = new URL('/sub-oss/file', parsed.origin);
  url.searchParams.set('key', parsed.key);
  return url.toString();
}

function parseOssCid(cid: string, stationUrl: string): { origin: string; key: string } {
  const trimmed = cid.trim();
  const fallbackOrigin = stationUrl.replace(/\/+$/, '');
  const trustedOrigin = new URL(fallbackOrigin).origin;
  if (!trimmed.startsWith('oss://')) return { origin: trustedOrigin, key: trimmed.replace(/^\/+/, '') };
  const rest = trimmed.slice('oss://'.length);
  const schemeIndex = rest.indexOf('://');
  if (schemeIndex >= 0) {
    const afterSchemeIndex = schemeIndex + 3;
    const slashAfterHost = rest.slice(afterSchemeIndex).indexOf('/');
    if (slashAfterHost < 0) throw new Error('attachment-cid-missing-key');
    const split = afterSchemeIndex + slashAfterHost;
    const origin = normalizeOssCidOrigin(rest.slice(0, split), trustedOrigin);
    if (origin !== trustedOrigin) throw new Error('attachment-cid-origin-not-trusted');
    return { origin: trustedOrigin, key: rest.slice(split + 1).replace(/^\/+/, '') };
  }
  const slash = rest.indexOf('/');
  if (slash < 0) throw new Error('attachment-cid-missing-key');
  const origin = rest.slice(0, slash);
  const normalizedOrigin = origin === 'self' ? trustedOrigin : normalizeOssCidOrigin(origin, trustedOrigin);
  if (normalizedOrigin !== trustedOrigin) throw new Error('attachment-cid-origin-not-trusted');
  return { origin: trustedOrigin, key: rest.slice(slash + 1).replace(/^\/+/, '') };
}

function normalizeOssCidOrigin(origin: string, fallbackOrigin: string): string {
  const normalized = origin.trim().replace(/\/+$/, '');
  if (!normalized) return fallbackOrigin;
  const fallbackProtocol = new URL(fallbackOrigin).protocol;
  return new URL(normalized.includes('://') ? normalized : `${fallbackProtocol}//${normalized}`).origin;
}

function revokeObjectUrl(url: string) {
  if (url) URL.revokeObjectURL(url);
}

function groupSearchableContent(display: GroupMessageDisplay): string {
  return display.kind === 'text' ? display.content : '';
}

function chatStateTags(
  state: ChatConversationPreferenceLike | undefined,
  t: (key: string) => string,
): string[] {
  if (!state) return [];
  const tags: string[] = [];
  if (state.sticky) tags.push(t('mobile.chat.stateSticky'));
  if (state.muted) tags.push(t('mobile.chat.stateMuted'));
  if (state.alertEnabled === false) tags.push(t('mobile.chat.stateAlertOff'));
  if (state.clearedAt) tags.push(t('mobile.chat.stateCleared'));
  return tags;
}

function conversationPreferenceState(
  conversation: MobileConversation,
  localStates: Record<string, ChatActionState>,
  friendSettings: Record<string, FriendConversationSettings>,
  groupSettings: Record<string, GroupSettings>,
): ChatActionState {
  if (conversation.kind === 'friend') {
    return friendSettingsToActionState(friendSettings[conversation.conversation.session.ulid], localStates[conversation.key]);
  }
  return groupSettingsToActionState(groupSettings[conversation.conversation.group.ulid], localStates[conversation.key]);
}

function friendSettingsToActionState(
  settings: FriendConversationSettings | undefined,
  fallback: ChatActionState | undefined,
): ChatActionState {
  if (!settings) return fallback ?? defaultChatActionState();
  return {
    muted: settings.isMuted,
    sticky: settings.isPinned,
    alertEnabled: settings.alertEnabled,
    background: settings.background,
    clearedAt: settings.clearedAt,
  };
}

function groupSettingsToActionState(
  settings: GroupSettings | undefined,
  fallback: ChatActionState | undefined,
): ChatActionState {
  if (!settings) return fallback ?? defaultChatActionState();
  return {
    muted: settings.isMuted,
    sticky: settings.isPinned,
    alertEnabled: settings.alertEnabled,
    background: settings.background,
    clearedAt: settings.clearedAt,
  };
}

function friendPatchFromActionPatch(patch: Partial<ChatActionState>): UpdateFriendConversationSettingsInput {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
    ...(patch.clearedAt !== undefined ? { clearedAt: patch.clearedAt } : {}),
  };
}

function groupPatchFromActionPatch(patch: Partial<ChatActionState>) {
  return {
    ...(patch.muted !== undefined ? { isMuted: patch.muted } : {}),
    ...(patch.sticky !== undefined ? { isPinned: patch.sticky } : {}),
    ...(patch.alertEnabled !== undefined ? { alertEnabled: patch.alertEnabled } : {}),
    ...(patch.background !== undefined ? { background: patch.background } : {}),
    ...(patch.clearedAt !== undefined ? { clearedAt: patch.clearedAt } : {}),
  };
}

function formatChatOperationError(error: unknown): string {
  if (error instanceof SocialApiError) return formatSocialError(error);
  return readableErrorMessage(error, 'operation_failed');
}

function groupRoleLabel(role: number, t: (key: string) => string): string {
  if (role >= GroupRole.OWNER) return t('mobile.group.roleOwner');
  if (role >= GroupRole.ADMIN) return t('mobile.group.roleAdmin');
  return t('mobile.group.roleMember');
}

function messageSenderFallback(
  message: FriendChatMessage | GroupMessage,
  groupMemberByDid: Map<string, GroupMember>,
  peerName: string,
): string {
  const member = groupMemberByDid.get(message.senderDid);
  return (member?.nickname || peerName || message.senderDid || '').slice(0, 1).toUpperCase();
}

function messageAvatarUrl(
  message: FriendChatMessage | GroupMessage,
  peerProfiles: Record<string, PeerProfile | null>,
  fallbackAvatar: string | undefined,
): string {
  return peerProfiles[message.senderDid]?.avatar || fallbackAvatar || '';
}

function stationHostFromUrl(stationUrl: string | undefined): string {
  if (!stationUrl) return '';
  try {
    return new URL(stationUrl).host;
  } catch {
    return stationUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="social-section-title">
      <Text strong>{title}</Text>
      <Text type="secondary">{count}</Text>
    </div>
  );
}
