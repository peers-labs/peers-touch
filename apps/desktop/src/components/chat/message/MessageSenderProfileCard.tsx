import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSocialChatStore } from '../../../store/socialChat';
import { useFederationStore } from '../../../store/federation';
import { resolveFederationStationName } from '../../../store/federation';
import {
  actorDisplayName,
  canonicalProfileAvatar,
} from '../../../store/socialProfileProjection';
import { PublicProfileCard, type PublicProfileModel } from '../../profile/PublicProfileCard';

/**
 * Rich sender card shown when a chat message avatar is clicked.
 *
 * Replaces the previous name + raw PTID popover. The row already knows the
 * lightweight in-projection name/avatar; the rich public profile (handle,
 * station, bio, technical IDs) is hydrated lazily through the shared
 * peer-profile cache, which dedupes in-flight requests and is reused by
 * Contacts/Details surfaces.
 *
 * The component mounts only while its popover is open, so the per-actor
 * store subscriptions never cost anything for the virtualized timeline.
 */
export function MessageSenderProfileCard({
  senderPtid,
  fallbackName,
  fallbackAvatar,
}: {
  senderPtid: string;
  fallbackName: string;
  fallbackAvatar?: string;
}) {
  const { t } = useTranslation('chat');
  const loadPeerProfile = useSocialChatStore((state) => state.loadPeerProfile);
  const peerProfile = useSocialChatStore((state) => state.peerProfiles[senderPtid]);
  const actorStationEntries = useFederationStore((state) => state.actorStationEntries);

  useEffect(() => {
    if (senderPtid) {
      void loadPeerProfile(senderPtid);
    }
  }, [loadPeerProfile, senderPtid]);

  const stationName = resolveFederationStationName({
    actorPtid: senderPtid,
    actorStationEntries,
  });

  const profile = useMemo<PublicProfileModel>(() => {
    const displayName = actorDisplayName(
      peerProfile?.display_name?.trim() || fallbackName,
      t('chat.social.detail.unknownMember'),
    );
    const actorPtidLabel = t('chat.social.identity.details.actorPtid');
    const stationPeerIdLabel = t('chat.social.identity.details.stationPeerId');
    const technicalDetails = [
      {
        id: 'actor-ptid',
        label: actorPtidLabel,
        value: peerProfile?.id?.trim() || senderPtid,
        copyLabel: t('chat.social.identity.details.copy', { label: actorPtidLabel }),
        copiedLabel: t('chat.social.identity.details.copied', { label: actorPtidLabel }),
        copyFailedLabel: t('chat.social.identity.details.copyFailed', { label: actorPtidLabel }),
      },
    ];
    if (peerProfile?.home_station_peer_id?.trim()) {
      technicalDetails.push({
        id: 'station-peer-id',
        label: stationPeerIdLabel,
        value: peerProfile.home_station_peer_id.trim(),
        copyLabel: t('chat.social.identity.details.copy', { label: stationPeerIdLabel }),
        copiedLabel: t('chat.social.identity.details.copied', { label: stationPeerIdLabel }),
        copyFailedLabel: t('chat.social.identity.details.copyFailed', { label: stationPeerIdLabel }),
      });
    }
    return {
      displayName,
      avatar: (peerProfile ? canonicalProfileAvatar(peerProfile) : '') || fallbackAvatar || '',
      username: peerProfile?.username?.trim() || undefined,
      bio: peerProfile?.note?.trim() || undefined,
      did: peerProfile?.id?.trim() || senderPtid,
      identityMetadata: stationName
        ? [t('chat.social.identity.station', { station: stationName })]
        : undefined,
      technicalDetails,
      technicalDetailsLabel: t('chat.social.identity.details.title'),
    };
  }, [fallbackAvatar, fallbackName, peerProfile, senderPtid, stationName, t]);

  return <PublicProfileCard compact profile={profile} />;
}
