/**
 * Pure relationship classification for profile surfaces.
 *
 * Friendship truth is the Station social edge (mutual follow) plus an
 * accepted friend request; Direct conversation history never defines
 * friendship (see chat-native-friendship-projection acceptance). The
 * classifier is framework-free so every profile surface (self popover,
 * contact detail, message-avatar card, chat detail) derives the same
 * primary action.
 */
import type { Relationship } from '../../gen/proto/domain/social/relationship_pb';
import type { FriendRequestData } from '../../store/socialNormalizers';

export type ProfileRelationshipKind =
  | 'self'
  | 'friend'
  /** Outgoing request waiting for the peer. */
  | 'requested'
  /** Incoming request waiting for the current user. */
  | 'incoming-request'
  /** Rejected or no edge; the peer can be added. */
  | 'stranger';

export interface ClassifyProfileRelationshipInput {
  actorPtid: string;
  currentUserPtid?: string | null;
  /** Cached viewer→peer social edge, when loaded. */
  relationship?: Relationship | null;
  /** Latest friend request between the two actors, when present. */
  friendRequest?: FriendRequestData | null;
}

export function classifyProfileRelationship({
  actorPtid,
  currentUserPtid,
  relationship,
  friendRequest,
}: ClassifyProfileRelationshipInput): ProfileRelationshipKind {
  if (currentUserPtid && actorPtid === currentUserPtid) return 'self';
  if (relationship?.following && relationship.followedBy) return 'friend';
  if (friendRequest?.status === 2) return 'friend';
  if (friendRequest?.status === 1) {
    return friendRequest.receiverPtid === currentUserPtid
      ? 'incoming-request'
      : 'requested';
  }
  return 'stranger';
}

/** Latest request between the current user and a peer, or null. */
export function findFriendRequest(
  requests: readonly FriendRequestData[],
  currentUserPtid: string | null | undefined,
  peerPtid: string,
): FriendRequestData | null {
  if (!currentUserPtid || !peerPtid) return null;
  let latest: FriendRequestData | null = null;
  for (const request of requests) {
    const involvesPeer = (
      request.senderPtid === currentUserPtid && request.receiverPtid === peerPtid
    ) || (
      request.senderPtid === peerPtid && request.receiverPtid === currentUserPtid
    );
    if (!involvesPeer) continue;
    if (!latest || request.createdAt > latest.createdAt) latest = request;
  }
  return latest;
}
