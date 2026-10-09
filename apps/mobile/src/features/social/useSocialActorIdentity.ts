import { useEffect, useMemo } from 'react';

import { useSocialStore } from './socialStore';
import type { PeerProfile } from './socialTypes';

export interface SocialActorIdentityFallback {
  readonly actorPtid: string;
  readonly avatar?: string | null;
  readonly displayName?: string;
  readonly username?: string;
}

export interface SocialActorIdentity {
  readonly actorPtid: string;
  readonly avatar: string;
  readonly displayName: string;
}

type CanonicalActorProfile = Pick<
  PeerProfile,
  'acct' | 'avatar' | 'displayName' | 'username'
>;

export function resolveSocialActorIdentity(
  fallback: SocialActorIdentityFallback,
  canonicalProfile?: CanonicalActorProfile | null,
): SocialActorIdentity {
  const actorPtid = fallback.actorPtid?.trim() ?? '';
  return {
    actorPtid,
    avatar: canonicalProfile?.avatar || fallback.avatar || '',
    displayName:
      canonicalProfile?.displayName ||
      canonicalProfile?.username ||
      canonicalProfile?.acct ||
      fallback.displayName ||
      fallback.username ||
      actorPtid,
  };
}

export function useSocialActorIdentity(
  fallback: SocialActorIdentityFallback,
): SocialActorIdentity {
  const actorPtid = fallback.actorPtid?.trim() ?? '';
  const currentUserPtid = useSocialStore((state) => state.currentUserPtid);
  const currentUserProfile = useSocialStore(
    (state) => state.currentUserProfile,
  );
  const peerProfile = useSocialStore(
    (state) => state.peerProfiles[actorPtid] ?? null,
  );
  const loadCurrentUserProfile = useSocialStore(
    (state) => state.loadCurrentUserProfile,
  );
  const loadPeerProfile = useSocialStore((state) => state.loadPeerProfile);
  const canonicalProfile =
    actorPtid && actorPtid === currentUserPtid
      ? currentUserProfile
      : peerProfile;
  const needsCanonicalProfile =
    !fallback.avatar ||
    !fallback.displayName ||
    fallback.displayName.includes('@');

  useEffect(() => {
    if (!actorPtid || !needsCanonicalProfile) return;
    if (actorPtid === currentUserPtid) {
      if (!currentUserProfile) void loadCurrentUserProfile();
      return;
    }
    if (!peerProfile) void loadPeerProfile(actorPtid);
  }, [
    actorPtid,
    currentUserProfile,
    currentUserPtid,
    loadCurrentUserProfile,
    loadPeerProfile,
    needsCanonicalProfile,
    peerProfile,
  ]);

  return useMemo(
    () => resolveSocialActorIdentity(fallback, canonicalProfile),
    [canonicalProfile, fallback],
  );
}
