/**
 * Viewer→actor relationship hook for profile surfaces.
 *
 * Loads the social edge and peer profile lazily (single-owner caches in the
 * relationships/social stores) and classifies the friendship state. Surfaces
 * that must decide whether an action row exists at all read this hook
 * instead of duplicating friendship logic.
 */
import { useEffect } from 'react';

import { useSessionStore } from '../../store/session';
import { useSocialChatStore } from '../../store/socialChat';
import { useRelationshipsStore } from '../../store/relationships';
import {
  classifyProfileRelationship,
  findFriendRequest,
  type ProfileRelationshipKind,
} from './profileRelationship';

export function useProfileRelationship(actorPtid: string): ProfileRelationshipKind | null {
  const currentUserPtid = useSessionStore((state) => state.currentUser?.actorPtid ?? null);
  const friendRequests = useSocialChatStore((state) => state.friendRequests);
  const relationship = useRelationshipsStore((state) => state.relations[actorPtid]);
  const loadRelationship = useRelationshipsStore((state) => state.loadRelationship);
  const loadPeerProfile = useSocialChatStore((state) => state.loadPeerProfile);

  useEffect(() => {
    if (actorPtid && actorPtid !== currentUserPtid) {
      void loadRelationship(actorPtid);
      void loadPeerProfile(actorPtid);
    }
  }, [actorPtid, currentUserPtid, loadPeerProfile, loadRelationship]);

  if (!actorPtid) return null;
  return classifyProfileRelationship({
    actorPtid,
    currentUserPtid,
    relationship,
    friendRequest: findFriendRequest(friendRequests, currentUserPtid, actorPtid),
  });
}
