import { visibleChatUnread } from '../chat/chatActionState';
import type { SocialState } from './socialStore';

/** Scalar selectors keep the navigation shell independent of domain collections. */
export function selectChatNavigationBadge(state: SocialState): number {
  if (!state.currentUserPtid) return 0;
  const unread = (conversationId: string, count: number) => visibleChatUnread(count, {
    muted: Boolean(state.conversationSettings[conversationId]?.isMuted),
    alertEnabled: state.conversationSettings[conversationId]?.alertEnabled !== false,
  });
  return state.sessions.reduce((total, session) => total + unread(
    session.ulid,
    session.participantAPtid === state.currentUserPtid
      ? session.unreadCountA
      : session.unreadCountB,
  ), 0) + state.messagingConversations.reduce((total, conversation) => (
    conversation.kind === 2 && conversation.active
      ? total + unread(
          conversation.conversationId,
          state.conversationSummaries[conversation.conversationId]?.unreadCount ?? 0,
        )
      : total
  ), 0);
}

export function selectContactsNavigationBadge(state: SocialState): number {
  if (!state.currentUserPtid) return 0;
  return state.friendRequests.reduce((total, request) => total + Number(
    request.status === 1
    && request.receiverPtid === state.currentUserPtid
    && request.senderPtid !== state.currentUserPtid,
  ), 0);
}
