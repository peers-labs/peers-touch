import { useEffect, useMemo } from 'react';

import {
  resolveFederationStationName,
  useFederationStore,
} from '../../store/federation';
import { useSessionStore } from '../../store/session';
import { useSocialChatStore } from '../../store/socialChat';
import {
  actorDisplayName,
  resolveActorIdentity,
} from '../../store/socialProfileProjection';

export interface ActorIdentityOptions {
  nickname?: string;
  fallbackName?: string;
  fallbackAvatar?: string;
  requireCanonicalProfile?: boolean;
}

export function useActorIdentity(
  actorPtid: string,
  options: ActorIdentityOptions = {},
) {
  const currentUserPtid = useSocialChatStore((state) => state.currentUserPtid);
  const sessionActorPtid = useSessionStore(
    (state) => state.currentUser?.actorPtid ?? null,
  );
  const effectiveCurrentUserPtid = currentUserPtid || sessionActorPtid;
  const currentUserProfile = useSocialChatStore((state) => state.currentUserProfile);
  const peerProfile = useSocialChatStore((state) => state.peerProfiles[actorPtid]);
  const sessions = useSocialChatStore((state) => state.sessions);
  const request = useSocialChatStore((state) => state.friendRequests.find(
    (item) => item.senderPtid === actorPtid || item.receiverPtid === actorPtid,
  ));
  const loadPeerProfile = useSocialChatStore((state) => state.loadPeerProfile);
  const federationSelf = useFederationStore((state) => state.self);
  const actorStationEntries = useFederationStore(
    (state) => state.actorStationEntries,
  );

  useEffect(() => {
    if (
      actorPtid
      && actorPtid !== effectiveCurrentUserPtid
      && peerProfile === undefined
    ) {
      void loadPeerProfile(actorPtid);
    }
  }, [actorPtid, effectiveCurrentUserPtid, loadPeerProfile, peerProfile]);

  return useMemo(() => {
    const sender = request?.senderPtid === actorPtid;
    const identity = resolveActorIdentity({
      ptid: actorPtid,
      currentUserPtid: effectiveCurrentUserPtid,
      currentUserProfile,
      peerProfiles: { [actorPtid]: peerProfile ?? null },
      sessions,
      nickname: options.nickname,
      fallbackName: options.fallbackName
        || (sender ? request?.senderDisplayName : request?.receiverDisplayName),
      fallbackAvatar: options.fallbackAvatar
        || (sender ? request?.senderAvatar : request?.receiverAvatar),
    });
    const canonicalDisplayName = actorDisplayName(
      identity.isSelf
        ? currentUserProfile?.displayName
        : peerProfile?.display_name,
    );
    const canonicalAvatar = (
      identity.isSelf
        ? currentUserProfile?.avatar
        : peerProfile?.avatar
    )?.trim() || '';
    const homeStationPeerId = (
      identity.isSelf
        ? federationSelf?.home_station_peer_id
        : peerProfile?.home_station_peer_id
    )?.trim() || '';
    return {
      ...identity,
      displayName: options.requireCanonicalProfile
        ? canonicalDisplayName
        : identity.displayName,
      avatarUrl: options.requireCanonicalProfile
        ? canonicalAvatar
        : identity.avatarUrl,
      homeStationPeerId,
      homeStationName: resolveFederationStationName({
        actorPtid,
        stationPeerId: homeStationPeerId,
        actorStationEntries,
      }),
    };
  }, [
    actorPtid,
    actorStationEntries,
    currentUserProfile,
    effectiveCurrentUserPtid,
    federationSelf,
    options.fallbackAvatar,
    options.fallbackName,
    options.nickname,
    options.requireCanonicalProfile,
    peerProfile,
    request,
    sessions,
  ]);
}
