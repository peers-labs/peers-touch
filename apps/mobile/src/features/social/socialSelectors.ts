import type { SocialState } from './socialStore';
import {
  outgoingRequests,
  pendingInboundRequests,
  selectConversations,
  unreadNotificationCount,
  unreadNotifications,
} from './socialStore';

export const selectSocialConversations = (state: SocialState) => selectConversations(state);

export const selectPendingInboundFriendRequests = (state: SocialState) => pendingInboundRequests(state);

export const selectOutgoingFriendRequests = (state: SocialState) => outgoingRequests(state);

export const selectUnreadSocialNotifications = (state: SocialState) => unreadNotifications(state);

export const selectUnreadSocialNotificationCount = (state: SocialState) => unreadNotificationCount(state);
