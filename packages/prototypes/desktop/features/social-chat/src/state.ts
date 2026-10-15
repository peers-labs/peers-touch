import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CONVERSATIONS,
  CURRENT_USER,
  CHAT_JOURNEY_LOCALE,
  GROUP_MEMBERS,
  MESSAGES,
  type MockConversation,
  type MockGroupMember,
  type MockGroupRole,
  type FederatedFriendMeta,
} from './mock';
import {
  CHAT_JOURNEY,
  CHAT_JOURNEY_MESSAGE_ID,
} from '../../../../shared/chat-journey';

export interface ChatState {
  conversations: MockConversation[];
  activeId: string | null;
  showDetail: boolean;
}

export function useChatState() {
  const retryTimers = useRef<Set<number>>(new Set());
  const [conversations, setConversations] = useState(CONVERSATIONS);
  const [groupMembers, setGroupMembers] = useState(GROUP_MEMBERS);
  const [messagesByConversation, setMessagesByConversation] = useState(MESSAGES);
  const [activeId, setActiveId] = useState<string | null>('conv-1');
  const [showDetail, setShowDetail] = useState(false);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeId ? messagesByConversation[activeId] ?? [] : [];
  const activeGroupMembers = activeId ? groupMembers[activeId] ?? [] : [];

  useEffect(() => () => {
    retryTimers.current.forEach((timer) => window.clearTimeout(timer));
    retryTimers.current.clear();
  }, []);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const toggleDetail = useCallback(() => {
    setShowDetail((v) => !v);
  }, []);

  const togglePin = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c)),
    );
  }, []);

  const toggleMute = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, muted: !c.muted } : c)),
    );
  }, []);

  const markAsRead = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
    );
  }, []);

  const hideConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }, [activeId]);

  const clearConversationData = useCallback((id: string) => {
    setMessagesByConversation((prev) => ({ ...prev, [id]: [] }));
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, lastMessage: 'No messages yet', unread: 0 } : c)),
    );
  }, []);

  const setConversationBackgroundImage = useCallback((id: string, file: File) => {
    const previewUrl = URL.createObjectURL(file);
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== id) return conversation;
        if (conversation.backgroundImage?.startsWith('blob:')) {
          URL.revokeObjectURL(conversation.backgroundImage);
        }
        return { ...conversation, backgroundImage: previewUrl };
      }),
    );
  }, []);

  const sendMessage = useCallback((id: string, content: string, replyTo?: string) => {
    const text = content.trim();
    if (!text) return;
    const nextMessage = {
      id: `draft-${Date.now()}`,
      senderId: CURRENT_USER.id,
      content: text,
      replyTo,
      timestamp: Date.now(),
      type: 'text' as const,
      status: 'sent' as const,
    };
    setMessagesByConversation((prev) => ({
      ...prev,
      [id]: [...(prev[id] ?? []), nextMessage],
    }));
    setConversations((prev) => prev.map((c) => (c.id === id ? {
      ...c,
      lastMessage: text,
      lastMessageTime: nextMessage.timestamp,
      unread: 0,
    } : c)));
  }, []);

  const sendAttachment = useCallback((id: string, file: File) => {
    const isImage = file.type.startsWith('image/');
    const objectUrl = URL.createObjectURL(file);
    const sizeLabel = file.size < 1024
      ? `${file.size} B`
      : file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    const nextMessage = {
      id: `attach-${Date.now()}`,
      senderId: CURRENT_USER.id,
      content: '',
      timestamp: Date.now(),
      type: (isImage ? 'image' : 'file') as 'image' | 'file',
      status: 'sent' as const,
      attachmentName: file.name,
      attachmentMeta: sizeLabel,
      attachmentUrl: objectUrl,
    };
    setMessagesByConversation((prev) => ({
      ...prev,
      [id]: [...(prev[id] ?? []), nextMessage],
    }));
    setConversations((prev) => prev.map((c) => (c.id === id ? {
      ...c,
      lastMessage: isImage ? `[Image] ${file.name}` : `[File] ${file.name}`,
      lastMessageTime: nextMessage.timestamp,
      unread: 0,
    } : c)));
  }, []);

  const editMessage = useCallback((conversationId: string, messageId: string, content: string) => {
    const text = content.trim();
    if (!text) return;
    // Editing preserves the original send timestamp/order; only the body and
    // the edited marker change (mirrors the Station envelope edit semantics).
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).map((message) => (
        message.id === messageId
          ? { ...message, content: text, edited: true }
          : message
      )),
    }));
  }, []);

  const retryMessage = useCallback((id: string, messageId: string) => {
    const isJourney = messageId === CHAT_JOURNEY_MESSAGE_ID;

    // Generic retries only flip the delivery status. The CHAT-CRAFT-J01
    // scenario additionally reconciles m4 and appends the peer follow-up;
    // that journey copy must never leak into an ordinary conversation.
    const transitionStatus = (status: 'sending' | 'delivered') => (prev: typeof MESSAGES) => {
      const current = prev[id] ?? [];
      // The row can disappear while the retry is in flight (Clear history).
      if (!current.some((message) => message.id === messageId)) return prev;
      return {
        ...prev,
        [id]: current.map((message) => (
          message.id === messageId ? { ...message, status } : message
        )),
      };
    };

    setMessagesByConversation(transitionStatus('sending'));

    const timer = window.setTimeout(() => {
      retryTimers.current.delete(timer);
      setMessagesByConversation((prev) => {
        const current = prev[id] ?? [];
        if (!current.some((message) => message.id === messageId)) return prev;
        const messages = current.map((message) => {
          if (message.id === messageId) {
            return { ...message, status: 'delivered' as const };
          }
          if (isJourney && message.id === 'm4') {
            return {
              ...message,
              content: CHAT_JOURNEY_LOCALE === 'zh'
                ? '对方已确认收到该消息。'
                : 'Delivered and confirmed.',
            };
          }
          return message;
        });
        if (!isJourney || messages.some((message) => message.id === 'release-hold-ack')) {
          return { ...prev, [id]: messages };
        }
        return {
          ...prev,
          [id]: [
            ...messages,
            {
              id: 'release-hold-ack',
              senderId: 'user-1',
              content: CHAT_JOURNEY.messages.followup[CHAT_JOURNEY_LOCALE],
              timestamp: Date.now(),
              type: 'text' as const,
            },
          ],
        };
      });
      // Only the scripted journey updates the session preview with the
      // follow-up copy; a generic retry leaves the last-message preview alone.
      if (isJourney) {
        setConversations((prev) => prev.map((conversation) => (
          conversation.id === id
            ? {
                ...conversation,
                lastMessage: CHAT_JOURNEY.messages.followup[CHAT_JOURNEY_LOCALE],
                lastMessageTime: Date.now(),
                unread: 0,
              }
            : conversation
        )));
      }
    }, 900);
    retryTimers.current.add(timer);
  }, []);

  const sendVoiceMessage = useCallback((id: string, durationSeconds: number) => {
    const nextMessage = {
      id: `voice-${Date.now()}`,
      senderId: CURRENT_USER.id,
      content: '',
      timestamp: Date.now(),
      type: 'voice' as const,
      status: 'sent' as const,
      durationSeconds: Math.max(1, Math.round(durationSeconds)),
      transferState: 'ready' as const,
    };
    setMessagesByConversation((prev) => ({
      ...prev,
      [id]: [...(prev[id] ?? []), nextMessage],
    }));
    setConversations((prev) => prev.map((conversation) => (
      conversation.id === id
        ? {
            ...conversation,
            lastMessage: `Voice message · ${nextMessage.durationSeconds}s`,
            lastMessageTime: nextMessage.timestamp,
            unread: 0,
          }
        : conversation
    )));
  }, []);

  const addGroupMembers = useCallback((conversationId: string, userIds: string[]) => {
    if (userIds.length === 0) return;
    setGroupMembers((prev) => {
      const existing = new Set((prev[conversationId] ?? []).map((member) => member.userId));
      const added = userIds
        .filter((userId) => !existing.has(userId))
        .map((userId) => ({ userId, role: 'member' as const, muted: false, joinedAt: Date.now() }));
      return { ...prev, [conversationId]: [...(prev[conversationId] ?? []), ...added] };
    });
    setConversations((prevConversations) => prevConversations.map((conversation) => {
      if (conversation.id !== conversationId) return conversation;
      const existing = (groupMembers[conversationId] ?? []).length;
      const merged = new Set([
        ...(groupMembers[conversationId] ?? []).map((member) => member.userId),
        ...userIds,
      ]);
      return { ...conversation, memberCount: merged.size || existing };
    }));
  }, [groupMembers]);

  const renameGroup = useCallback((id: string, name: string) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
  }, []);

  const removeGroupMember = useCallback((conversationId: string, userId: string) => {
    setGroupMembers((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).filter((member) => member.userId !== userId),
    }));
    setConversations((prev) =>
      prev.map((c) => (
        c.id === conversationId
          ? { ...c, memberCount: Math.max((c.memberCount ?? 1) - 1, 0) }
          : c
      )),
    );
  }, []);

  const toggleMemberMute = useCallback((conversationId: string, userId: string) => {
    setGroupMembers((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).map((member) =>
        member.userId === userId ? { ...member, muted: !member.muted } : member,
      ),
    }));
  }, []);

  const setMemberRole = useCallback((conversationId: string, userId: string, role: MockGroupRole) => {
    setGroupMembers((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).map((member) =>
        member.userId === userId ? { ...member, role } : member,
      ),
    }));
  }, []);

  const transferOwnership = useCallback((conversationId: string, nextOwnerId: string) => {
    setGroupMembers((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).map((member): MockGroupMember => {
        if (member.userId === CURRENT_USER.id) return { ...member, role: 'admin' };
        if (member.userId === nextOwnerId) return { ...member, role: 'owner', muted: false };
        return member;
      }),
    }));
  }, []);

  const createFriendConversation = useCallback((
    name: string,
    peerId: string,
    federatedMeta?: FederatedFriendMeta,
  ) => {
    const displayName = name.trim() || peerId.trim() || 'New Friend';
    const id = `friend-${Date.now()}`;
    const next: MockConversation = {
      id,
      type: 'friend',
      name: displayName,
      avatar: '',
      lastMessage: 'Friend session created. Say hello when ready.',
      lastMessageTime: Date.now(),
      unread: 0,
      muted: false,
      pinned: false,
      online: false,
      trustLabel: 'Pending verification',
      trustTone: 'attention',
      detailHint: '',
      // Structural identity key: lets the session-search dropdown dedupe this
      // contact instead of opening another identical friend session.
      peerPtid: peerId.trim() || undefined,
      // Federation provenance supplied by the caller (contact book / search).
      // Drives the single cross-station deviation cue; addresses stay in detail.
      federated: federatedMeta?.federated || undefined,
      station: federatedMeta?.station,
      handle: federatedMeta?.handle,
      background: 'Default',
    };
    setConversations((prev) => [next, ...prev]);
    setMessagesByConversation((prev) => ({
      ...prev,
      [id]: [{
        id: `system-${Date.now()}`,
        senderId: 'system',
        content: 'Chat started. Say hello.',
        timestamp: Date.now(),
        type: 'system',
      }],
    }));
    setActiveId(id);
    setShowDetail(false);
  }, []);

  const createGroupConversation = useCallback((name: string, invitees: string[]) => {
    const groupName = name.trim() || 'New Group';
    const id = `group-${Date.now()}`;
    const invited = invitees.map((value) => value.trim()).filter(Boolean);
    const next: MockConversation = {
      id,
      type: 'group',
      name: groupName,
      avatar: '',
      lastMessage: invited.length > 0 ? `Invited ${invited.length} member${invited.length > 1 ? 's' : ''}` : 'Group created',
      lastMessageTime: Date.now(),
      unread: 0,
      muted: false,
      pinned: false,
      memberCount: 1 + invited.length,
      trustLabel: 'Owner controls available',
      trustTone: 'verified',
      detailHint: '',
      myNickname: CURRENT_USER.name,
      background: 'Default',
    };
    setConversations((prev) => [next, ...prev]);
    setGroupMembers((prev) => ({
      ...prev,
      [id]: [{ userId: CURRENT_USER.id, role: 'owner', muted: false, joinedAt: Date.now() }],
    }));
    setMessagesByConversation((prev) => ({
      ...prev,
      [id]: [{
        id: `system-${Date.now()}`,
        senderId: 'system',
        content: invited.length > 0
          ? `Group created · ${invited.length} member${invited.length > 1 ? 's' : ''} invited.`
          : 'Group created. Invite members from group details.',
        timestamp: Date.now(),
        type: 'system',
      }],
    }));
    setActiveId(id);
    setShowDetail(false);
  }, []);

  // Sort: pinned first, then by time
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastMessageTime - a.lastMessageTime;
  });

  return {
    conversations: sortedConversations,
    activeId,
    activeConversation,
    messages,
    messagesByConversation,
    currentUserId: CURRENT_USER.id,
    groupMembers: activeGroupMembers,
    groupMembersByConversation: groupMembers,
    showDetail,
    selectConversation,
    toggleDetail,
    togglePin,
    toggleMute,
    markAsRead,
    hideConversation,
    deleteConversation,
    clearConversationData,
    setConversationBackgroundImage,
    sendMessage,
    sendAttachment,
    editMessage,
    retryMessage,
    sendVoiceMessage,
    renameGroup,
    removeGroupMember,
    addGroupMembers,
    toggleMemberMute,
    setMemberRole,
    transferOwnership,
    createFriendConversation,
    createGroupConversation,
  };
}
