import { useState, useCallback } from 'react';
import {
  CONVERSATIONS,
  CURRENT_USER,
  GROUP_MEMBERS,
  MESSAGES,
  type MockConversation,
  type MockGroupMember,
  type MockGroupRole,
} from './mock';

export interface ChatState {
  conversations: MockConversation[];
  activeId: string | null;
  showDetail: boolean;
}

export function useChatState() {
  const [conversations, setConversations] = useState(CONVERSATIONS);
  const [groupMembers, setGroupMembers] = useState(GROUP_MEMBERS);
  const [messagesByConversation, setMessagesByConversation] = useState(MESSAGES);
  const [activeId, setActiveId] = useState<string | null>('conv-1');
  const [showDetail, setShowDetail] = useState(false);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeId ? messagesByConversation[activeId] ?? [] : [];
  const activeGroupMembers = activeId ? groupMembers[activeId] ?? [] : [];

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

  const clearConversationHistory = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, historyClearedAt: Date.now() } : c)),
    );
  }, []);

  const restoreConversationHistory = useCallback((id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, historyClearedAt: undefined } : c)),
    );
  }, []);

  const sendMessage = useCallback((id: string, content: string) => {
    const text = content.trim();
    if (!text) return;
    const nextMessage = {
      id: `draft-${Date.now()}`,
      senderId: CURRENT_USER.id,
      content: text,
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

  const createFriendConversation = useCallback((name: string, peerId: string) => {
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
      detailHint: `Maps to Friend create/list flow · peer: ${peerId.trim() || 'station/user id pending'}`,
      background: 'Default',
    };
    setConversations((prev) => [next, ...prev]);
    setMessagesByConversation((prev) => ({
      ...prev,
      [id]: [{
        id: `system-${Date.now()}`,
        senderId: 'system',
        content: 'Friend chat session is ready. Production maps this to /friend-chat/create before messaging.',
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
      detailHint: 'Maps to Group create, then invite selected members.',
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
          ? `Group created. Invites queued for ${invited.join(', ')}.`
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
    currentUserId: CURRENT_USER.id,
    groupMembers: activeGroupMembers,
    showDetail,
    selectConversation,
    toggleDetail,
    togglePin,
    toggleMute,
    markAsRead,
    hideConversation,
    deleteConversation,
    clearConversationHistory,
    restoreConversationHistory,
    sendMessage,
    renameGroup,
    removeGroupMember,
    toggleMemberMute,
    setMemberRole,
    transferOwnership,
    createFriendConversation,
    createGroupConversation,
  };
}
