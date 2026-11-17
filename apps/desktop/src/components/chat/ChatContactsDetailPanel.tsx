/**
 * ChatContactsDetailPanel — the work-area profile surface for a person who
 * is not yet an established friend (incoming/outgoing friend request).
 *
 * Decision actions live HERE, on the full profile sheet, never on the compact
 * request card in the catalogue: the card stays a single-height navigation
 * row and accept/reject get the room and context of the peer's identity.
 *
 * The surface reuses the shared PublicProfileCard grammar and the same store
 * actions as the old inline buttons; it only changes WHERE the decision is
 * taken and routes failures through mapChatError so station reasons surface
 * instead of a bare generic toast.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@peers-touch/ui';

import { useSocialChatStore } from '../../store/socialChat';
import {
  canonicalProfileAvatar,
  remoteProfileHandle,
} from '../../store/socialProfileProjection';
import { findFriendRequest } from '../profile/profileRelationship';
import { useSessionStore } from '../../store/session';
import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';
import { presentError } from '../../services/errorPresenter';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { log } from '../../utils/logger';
import type { ContactSelection } from './contactSelection';

interface ChatContactsDetailPanelProps {
  selection: Extract<ContactSelection, { kind: 'person' }>;
}

export function ChatContactsDetailPanel({ selection }: ChatContactsDetailPanelProps) {
  const { t } = useTranslation('chat');
  const currentUserPtid = useSessionStore((state) => state.currentUser?.actorPtid ?? null);
  const friendRequests = useSocialChatStore((state) => state.friendRequests);
  const peerProfile = useSocialChatStore((state) => state.peerProfiles[selection.peerPtid]);
  const acceptFriendRequest = useSocialChatStore((state) => state.acceptFriendRequest);
  const rejectFriendRequest = useSocialChatStore((state) => state.rejectFriendRequest);

  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  const friendRequest = useMemo(
    () => findFriendRequest(friendRequests, currentUserPtid, selection.peerPtid),
    [friendRequests, currentUserPtid, selection.peerPtid],
  );

  const isIncomingPending = selection.requestDirection === 'incoming'
    && selection.requestState === 1;
  const isOutgoingPending = selection.requestDirection === 'outgoing'
    && selection.requestState === 1;

  const profile = useMemo<PublicProfileModel>(() => {
    const handle = peerProfile ? remoteProfileHandle(peerProfile) : '';
    const localPart = handle.replace(/^@/, '').split('@')[0] || selection.username;
    const homeDomain = handle.replace(/^@/, '').split('@')[1]
      || selection.homeStationDomain
      || '';
    const identityMetadata = [
      selection.homeStationName
        ? t('chat.social.identity.station', { station: selection.homeStationName })
        : '',
      friendRequest?.message?.trim() ? friendRequest.message.trim() : '',
    ].filter(Boolean);

    return {
      displayName: peerProfile?.display_name?.trim() || selection.displayName,
      avatar: (peerProfile ? canonicalProfileAvatar(peerProfile) : '') || selection.avatar,
      header: peerProfile?.header?.trim() || undefined,
      username: peerProfile?.username?.trim() || localPart || undefined,
      homeStationDomain: homeDomain || undefined,
      bio: peerProfile?.note?.trim() || undefined,
      did: selection.peerPtid,
      identityMetadata: identityMetadata.length > 0 ? identityMetadata : undefined,
      relationLabel: isIncomingPending
        ? t('chat.social.contacts.direction.incoming')
        : isOutgoingPending
          ? t('chat.social.contacts.direction.outgoing')
          : undefined,
      relationTone: isIncomingPending ? 'warning' : 'default',
      technicalDetails: [
        {
          id: 'actor-ptid',
          label: t('chat.social.identity.details.actorPtid'),
          value: selection.peerPtid,
        },
        {
          id: 'station-peer-id',
          label: t('chat.social.identity.details.stationPeerId'),
          value: selection.homeStationPeerId,
        },
        {
          id: 'federation-id',
          label: t('chat.social.identity.details.federationId'),
          value: selection.federationId,
        },
      ].filter((detail) => detail.value).map((detail) => ({
        ...detail,
        copyLabel: t('chat.social.identity.details.copy', { label: detail.label }),
        copiedLabel: t('chat.social.identity.details.copied', { label: detail.label }),
        copyFailedLabel: t('chat.social.identity.details.copyFailed', { label: detail.label }),
      })),
      technicalDetailsLabel: t('chat.social.identity.details.title'),
    };
  }, [peerProfile, selection, friendRequest, t, isIncomingPending, isOutgoingPending]);

  const runDecision = async (action: 'accept' | 'reject') => {
    if (!friendRequest || busy) return;
    setBusy(action);
    try {
      if (action === 'accept') {
        await acceptFriendRequest(friendRequest);
      } else {
        await rejectFriendRequest(friendRequest);
      }
    } catch (error) {
      log.error('contactRequestDetail', `${action} friend request failed`, error);
      presentError(error, {
        mapper: mapChatError,
        context: { operation: 'conversationAction' },
      });
    } finally {
      setBusy(null);
    }
  };

  const actions = isIncomingPending ? (
    <div className="sc-request-detail__actions">
      <Button
        actionId={`friend-request-accept-${friendRequest?.id ?? selection.peerPtid}`}
        emphasis="primary"
        fullWidth
        execution={busy === 'accept' ? 'pending' : 'idle'}
        data-chat-friend-request-action="accept"
        onActivate={() => void runDecision('accept')}
      >
        {t('chat.social.contacts.accept')}
      </Button>
      <Button
        actionId={`friend-request-reject-${friendRequest?.id ?? selection.peerPtid}`}
        emphasis="quiet"
        fullWidth
        execution={busy === 'reject' ? 'pending' : 'idle'}
        data-chat-friend-request-action="reject"
        onActivate={() => void runDecision('reject')}
      >
        {t('chat.social.contacts.reject')}
      </Button>
    </div>
  ) : isOutgoingPending ? (
    <div className="sc-request-detail__actions">
      <Button
        actionId="friend-request-outgoing-waiting"
        fullWidth
        availability={{ kind: 'disabled', reason: t('chat.social.profile.requested') }}
        data-chat-friend-request-outgoing-waiting
      >
        {t('chat.social.profile.requested')}
      </Button>
    </div>
  ) : undefined;

  return (
    <div
      className="sc-request-detail"
      data-chat-contact-detail
      data-chat-contact-detail-kind={selection.kind}
      data-chat-contact-detail-peer-ptid={selection.peerPtid}
      data-chat-contact-detail-home-station-name={selection.homeStationName ?? ''}
      data-chat-contact-detail-home-station-peer-id={selection.homeStationPeerId}
      data-chat-contact-detail-request-attempt-count={selection.requestAttemptCount}
    >
      <PublicProfileCard variant="sheet" profile={profile} actions={actions} />
    </div>
  );
}
