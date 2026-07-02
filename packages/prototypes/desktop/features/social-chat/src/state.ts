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
  const [activeId, setActiveId] = useState<string | null>('conv-1');
  const [showDetail, setShowDetail] = useState(false);

  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const messages = activeId ? MESSAGES[activeId] ?? [] : [];
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
    renameGroup,
    removeGroupMember,
    toggleMemberMute,
    setMemberRole,
    transferOwnership,
  };
}
