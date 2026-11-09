import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spin as PtSpin } from '@peers-touch/ui';

import { useSocialChatStore } from '../../../store/socialChat';
import { useFederationStore, resolveFederationStationName } from '../../../store/federation';
import { useSessionStore } from '../../../store/session';
import {
  actorDisplayName,
  canonicalProfileAvatar,
} from '../../../store/socialProfileProjection';
import { api, type AccountProfile } from '../../../services/desktop_api';
import { PublicProfileCard, type PublicProfileModel } from '../../profile/PublicProfileCard';
import { ProfilePrimaryAction } from '../../profile/ProfilePrimaryAction';
import { mergeAccountProfile } from '../../profile/profileModel';

/**
 * Rich sender card shown when a chat message avatar is clicked.
 *
 * Same card for self and peers; the only differences are the profile source
 * (api.profileGet vs the shared peer-profile cache) and the primary action
 * selected by ProfilePrimaryAction. The lightweight in-projection
 * name/avatar paints immediately while the rich profile hydrates.
 *
 * The component mounts only while its popover is open, so per-actor store
 * subscriptions never cost anything for the virtualized timeline.
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
  const currentUserPtid = useSessionStore((state) => state.currentUser?.actorPtid ?? null);
  const isSelf = Boolean(currentUserPtid && senderPtid === currentUserPtid);

  const loadPeerProfile = useSocialChatStore((state) => state.loadPeerProfile);
  const peerProfile = useSocialChatStore((state) => state.peerProfiles[senderPtid]);
  const currentUser = useSessionStore((state) => state.currentUser);
  const actorStationEntries = useFederationStore((state) => state.actorStationEntries);

  const [selfProfile, setSelfProfile] = useState<AccountProfile | null>(null);
  const [selfLoadFailed, setSelfLoadFailed] = useState(false);

  useEffect(() => {
    if (!senderPtid) return;
    if (isSelf) {
      let cancelled = false;
      api.profileGet()
        .then((profile) => {
          if (!cancelled) setSelfProfile(profile);
        })
        .catch(() => {
          if (!cancelled) setSelfLoadFailed(true);
        });
      return () => {
        cancelled = true;
      };
    }
    void loadPeerProfile(senderPtid);
  }, [isSelf, loadPeerProfile, senderPtid]);

  const stationName = resolveFederationStationName({
    actorPtid: senderPtid,
    actorStationEntries,
  });

  const profile = useMemo<PublicProfileModel>(() => {
    const displayName = actorDisplayName(
      (isSelf ? selfProfile?.display_name : peerProfile?.display_name)?.trim()
        || fallbackName,
      t('chat.social.detail.unknownMember'),
    );
    const rich = isSelf ? selfProfile : peerProfile;
    const fallback: PublicProfileModel = {
      displayName,
      avatar: (rich ? canonicalProfileAvatar(rich) : '')
        || (isSelf ? currentUser?.avatarUrl : fallbackAvatar)
        || '',
      username: rich?.username,
      homeStationDomain: rich?.home_station_domain?.trim() || undefined,
      did: rich?.id?.trim() || senderPtid,
      identityMetadata: stationName
        ? [t('chat.social.identity.station', { station: stationName })]
        : undefined,
      technicalDetails: isSelf
        ? undefined
        : [
            {
              id: 'actor-ptid',
              label: t('chat.social.identity.details.actorPtid'),
              value: peerProfile?.id?.trim() || senderPtid,
              copyLabel: t('chat.social.identity.details.copy', {
                label: t('chat.social.identity.details.actorPtid'),
              }),
              copiedLabel: t('chat.social.identity.details.copied', {
                label: t('chat.social.identity.details.actorPtid'),
              }),
              copyFailedLabel: t('chat.social.identity.details.copyFailed', {
                label: t('chat.social.identity.details.actorPtid'),
              }),
            },
            ...(peerProfile?.home_station_peer_id?.trim()
              ? [{
                  id: 'station-peer-id',
                  label: t('chat.social.identity.details.stationPeerId'),
                  value: peerProfile.home_station_peer_id.trim(),
                  copyLabel: t('chat.social.identity.details.copy', {
                    label: t('chat.social.identity.details.stationPeerId'),
                  }),
                  copiedLabel: t('chat.social.identity.details.copied', {
                    label: t('chat.social.identity.details.stationPeerId'),
                  }),
                  copyFailedLabel: t('chat.social.identity.details.copyFailed', {
                    label: t('chat.social.identity.details.stationPeerId'),
                  }),
                }]
              : []),
          ],
      technicalDetailsLabel: t('chat.social.identity.details.title'),
    };
    if (!rich) return fallback;
    return mergeAccountProfile(
      fallback,
      rich,
      {
        posts: t('chat.social.detail.posts'),
        followers: t('chat.social.detail.followers'),
        following: t('chat.social.detail.following'),
      },
      t('chat.social.profile.joined'),
    );
  }, [
    currentUser,
    fallbackAvatar,
    fallbackName,
    isSelf,
    peerProfile,
    selfProfile,
    senderPtid,
    stationName,
    t,
  ]);

  return (
    <div data-sender-profile-card>
      {isSelf && !selfProfile && !selfLoadFailed ? (
        <div className="sc-sender-profile__loading">
          <PtSpin size="small" />
        </div>
      ) : (
        <PublicProfileCard
          variant="author"
          profile={profile}
          actions={<ProfilePrimaryAction actorPtid={senderPtid} />}
        />
      )}
    </div>
  );
}
