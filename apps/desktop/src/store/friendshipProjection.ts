import type {
  Follower,
  Following,
} from '../gen/proto/domain/social/relationship_pb';
import type { DesktopIMConversationProjection } from './socialProjection';
import type { FriendRequestData } from './socialNormalizers';

export interface MutualFriendProjection {
  actorPtid: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  federatedHandle: string;
  homeStationDomain: string;
}

export interface ChatFriendContactProjection extends MutualFriendProjection {
  conversationId?: string;
  federationId: string;
}

export function singleFederationId(
  federations: readonly { federationId: string }[],
): string {
  const ids = Array.from(new Set(
    federations
      .map((federation) => federation.federationId.trim())
      .filter(Boolean),
  ));
  return ids.length === 1 ? ids[0] : '';
}

export function projectMutualFriends(
  followers: readonly Follower[],
  following: readonly Following[],
): MutualFriendProjection[] {
  const followersByPtid = new Map(
    followers
      .filter((follower) => follower.actorPtid)
      .map((follower) => [follower.actorPtid, follower] as const),
  );

  return following
    .filter((candidate) => candidate.actorPtid && followersByPtid.has(candidate.actorPtid))
    .map((candidate) => {
      const follower = followersByPtid.get(candidate.actorPtid);
      return {
        actorPtid: candidate.actorPtid,
        username: candidate.username || follower?.username || '',
        displayName: candidate.displayName || follower?.displayName || '',
        avatarUrl: candidate.avatarUrl || follower?.avatarUrl || '',
        federatedHandle: candidate.federatedHandle || follower?.federatedHandle || '',
        homeStationDomain: candidate.homeStationDomain || follower?.homeStationDomain || '',
      };
    })
    .sort((left, right) => left.actorPtid.localeCompare(right.actorPtid));
}

export function projectChatFriendContacts(
  mutualFriends: readonly MutualFriendProjection[],
  conversations: readonly DesktopIMConversationProjection[],
  friendRequests: readonly FriendRequestData[],
  currentUserPtid: string,
  defaultFederationId: string,
): ChatFriendContactProjection[] {
  const conversationsByPeer = new Map(
    conversations
      .filter((conversation) => conversation.kind === 'friend' && conversation.peerPtid)
      .map((conversation) => [conversation.peerPtid as string, conversation] as const),
  );
  const federationByPeer = new Map<string, string>();

  for (const request of friendRequests) {
    if (request.status !== 2) continue;
    const peerPtid = request.senderPtid === currentUserPtid
      ? request.receiverPtid
      : request.receiverPtid === currentUserPtid
        ? request.senderPtid
        : '';
    if (peerPtid && request.federationId) {
      federationByPeer.set(peerPtid, request.federationId);
    }
  }

  return mutualFriends.map((friend) => {
    const conversation = conversationsByPeer.get(friend.actorPtid);
    return {
      ...friend,
      ...(conversation ? { conversationId: conversation.id } : {}),
      displayName: friend.displayName || friend.username || conversation?.title || '',
      avatarUrl: friend.avatarUrl || conversation?.avatar || '',
      federationId: conversation?.federationId
        || federationByPeer.get(friend.actorPtid)
        || defaultFederationId,
    };
  });
}
