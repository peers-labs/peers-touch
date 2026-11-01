import { useMemo } from 'react';
import { useActiveRelationshipsSlice, useActiveSocialChatSlice } from '../useActiveMomentsStore';
import { actorDisplayName } from '../../../store/socialProfileProjection';
import type { SocialMentionCandidate } from './socialMentionModel';

// Social @-mention candidate projection.
//
// Deliberately independent from the Agent mention store: candidates
// are human actors only, sourced from existing friend/relationship
// projections and the actors already visible inside the moment thread.
// Identity is PTID-bound; display names are presentation only.
export function useSocialMentionCandidates(
  threadActorPtids: readonly string[],
  viewerPtid?: string,
): SocialMentionCandidate[] {
  const { mutualFriends, followersByActor, currentUserPtid } =
    useActiveRelationshipsSlice((s) => ({
      mutualFriends: s.mutualFriends,
      followersByActor: s.followersByActor,
      currentUserPtid: s.mutualFriendsActorPtid,
    }));
  const { socialCurrentUserPtid, peerProfiles } = useActiveSocialChatSlice((s) => ({
    socialCurrentUserPtid: s.currentUserPtid,
    peerProfiles: s.peerProfiles,
  }));
  const viewer = viewerPtid ?? socialCurrentUserPtid ?? currentUserPtid ?? '';

  return useMemo(() => {
    const followers = viewer
      ? followersByActor[viewer]?.items ?? []
      : [];
    const byPtid = new Map<string, SocialMentionCandidate>();

    const add = (
      actorPtid: string | undefined,
      displayName: string | undefined,
      username?: string,
      label?: string,
    ) => {
      const ptid = actorPtid?.trim();
      if (!ptid || ptid === viewer) return;
      const name = actorDisplayName(displayName) || actorDisplayName(username) || ptid;
      const existing = byPtid.get(ptid);
      if (existing) {
        if (!existing.label && label) {
          byPtid.set(ptid, { ...existing, label });
        }
        return;
      }
      byPtid.set(ptid, {
        actorPtid: ptid,
        displayName: name,
        username,
        label,
      });
    };

    for (const friend of mutualFriends) {
      add(friend.actorPtid, friend.displayName, friend.username);
    }
    for (const follower of followers) {
      add(follower.actorPtid, follower.displayName, follower.username);
    }
    // Peer profiles resolve display names for actors visible through
    // federation / the thread even when no relationship row exists.
    for (const actorPtid of threadActorPtids) {
      const profile = peerProfiles[actorPtid];
      add(
        actorPtid,
        profile?.display_name,
        profile?.username,
      );
    }
    // Fall back to raw PTIDs for thread authors whose profile has not
    // hydrated yet; the Station still resolves the mention.
    for (const actorPtid of threadActorPtids) {
      add(actorPtid, undefined);
    }

    return [...byPtid.values()].sort((left, right) => {
      const leftName = left.displayName || left.actorPtid;
      const rightName = right.displayName || right.actorPtid;
      return leftName.localeCompare(rightName);
    });
  }, [
    followersByActor,
    mutualFriends,
    peerProfiles,
    threadActorPtids,
    viewer,
  ]);
}
