import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Empty, theme } from 'antd';
import { MessageCircle, Users } from 'lucide-react';

import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';
import { ProfilePrimaryAction } from '../profile/ProfilePrimaryAction';
import { mergeAccountProfile } from '../profile/profileModel';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';
import {
  findContactConversation,
  type ContactSelection,
} from './contactSelection';

interface ChatContactsDetailPanelProps {
  selectedContact: ContactSelection | null;
  openingPeerPtid?: string;
  onMessage: (contact: ContactSelection) => void;
}

export function ChatContactsDetailPanel({
  selectedContact,
  onMessage,
}: ChatContactsDetailPanelProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    getIMConversations,
    peerProfiles,
    loadPeerProfile,
  } = useActiveSocialChatSlice((s) => ({
    getIMConversations: s.getIMConversations,
    peerProfiles: s.peerProfiles,
    loadPeerProfile: s.loadPeerProfile,
  }));

  const activeConversation = selectedContact
    ? findContactConversation(selectedContact, getIMConversations())
    : undefined;
  const isGroup = selectedContact?.kind === 'group';
  const peerPtid = selectedContact && selectedContact.kind !== 'group'
    ? selectedContact.peerPtid
    : '';
  const cachedPeer = peerPtid ? peerProfiles[peerPtid] : undefined;

  // Lazy peer profile load. The cache is single-owner (socialChat store);
  // running this effect here is the *view trigger*, not the projection.
  useEffect(() => {
    if (peerPtid) {
      void loadPeerProfile(peerPtid);
    }
  }, [peerPtid, loadPeerProfile]);

  const profile = useMemo<PublicProfileModel | null>(() => {
    if (selectedContact?.kind === 'group') {
      return {
        displayName: selectedContact.displayName,
        avatar: selectedContact.avatar,
        did: selectedContact.conversationId,
        relationLabel: t('chat.social.contacts.groupLabel'),
        relationTone: 'processing',
        stats: [
          {
            label: t('chat.social.detail.membersLabel'),
            value: Number(activeConversation?.memberCount ?? selectedContact.memberCount),
          },
        ],
      };
    }
    if (!selectedContact) return null;
    const technicalDetails = [
      {
        id: 'actor-ptid',
        label: t('chat.social.identity.details.actorPtid'),
        value: selectedContact.peerPtid,
      },
      {
        id: 'station-peer-id',
        label: t('chat.social.identity.details.stationPeerId'),
        value: selectedContact.homeStationPeerId,
      },
      {
        id: 'federated-handle',
        label: t('chat.social.identity.details.federatedHandle'),
        value: selectedContact.federatedHandle,
      },
      {
        id: 'federation-id',
        label: t('chat.social.identity.details.federationId'),
        value: selectedContact.federationId,
      },
    ].filter((detail) => detail.value).map((detail) => ({
      ...detail,
      copyLabel: t('chat.social.identity.details.copy', {
        label: detail.label,
      }),
      copiedLabel: t('chat.social.identity.details.copied', {
        label: detail.label,
      }),
      copyFailedLabel: t('chat.social.identity.details.copyFailed', {
        label: detail.label,
      }),
    }));
    const sessionFallback: PublicProfileModel = {
      displayName: selectedContact.displayName,
      avatar: selectedContact.avatar || '',
      username: selectedContact.username || undefined,
      homeStationDomain: selectedContact.homeStationDomain || undefined,
      did: peerPtid,
      identityMetadata: [
        selectedContact.federationName || selectedContact.federationId
          ? t('chat.social.identity.federation', {
              federation: selectedContact.federationName
                || selectedContact.federationId,
            })
          : '',
        selectedContact.homeStationName || selectedContact.homeStationDomain
          ? t('chat.social.identity.station', {
              station: selectedContact.homeStationName
                || selectedContact.homeStationDomain,
            })
          : selectedContact.homeStationPeerId
            ? t('chat.social.identity.stationUnavailable')
            : '',
      ].filter(Boolean),
      technicalDetails,
      technicalDetailsLabel: t('chat.social.identity.details.title'),
      relationLabel: selectedContact.kind === 'friend'
        ? t('chat.social.contacts.friendLabel')
        : t(`chat.social.contacts.status.${requestStateKey(
            selectedContact.requestState,
          )}`),
      relationTone: selectedContact.kind === 'friend'
        ? 'success'
        : selectedContact.requestState === 1
          ? 'processing'
          : 'default',
    };
    if (!cachedPeer) return sessionFallback;
    return mergeAccountProfile(
      sessionFallback,
      cachedPeer,
      {
        posts: t('chat.social.detail.posts'),
        followers: t('chat.social.detail.followers'),
        following: t('chat.social.detail.following'),
      },
      t('chat.social.profile.joined'),
    );
  }, [activeConversation, cachedPeer, peerPtid, selectedContact, t]);

  if (!selectedContact) {
    return (
      <Flexbox
        flex={1}
        align="center"
        justify="center"
        style={{ background: token.colorBgLayout, padding: 32 }}
      >
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('chat.social.contacts.detailEmpty')}
        />
      </Flexbox>
    );
  }

  if (!profile) return null;

  return (
    <Flexbox
      data-chat-contact-detail-kind={selectedContact.kind}
      data-chat-contact-detail-peer-ptid={
        selectedContact.kind === 'group' ? '' : selectedContact.peerPtid
      }
      data-chat-contact-detail-home-station-name={
        selectedContact.kind === 'group'
          ? ''
          : selectedContact.homeStationName ?? ''
      }
      data-chat-contact-detail-home-station-peer-id={
        selectedContact.kind === 'group'
          ? ''
          : selectedContact.homeStationPeerId
      }
      data-chat-contact-detail-request-attempt-count={
        selectedContact.kind === 'person'
          ? selectedContact.requestAttemptCount
          : ''
      }
      flex={1}
      align="center"
      justify="center"
      style={{ background: token.colorBgLayout, padding: 32, overflow: 'auto' }}
    >
      <PublicProfileCard
        compact
        profile={profile}
        avatarNode={isGroup ? (
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: token.colorFillSecondary,
              color: token.colorTextSecondary,
            }}
          >
            <Users size={30} />
          </Flexbox>
        ) : undefined}
        actions={isGroup ? (
          <Button
            data-chat-contact-message
            block
            type="primary"
            icon={<MessageCircle size={16} />}
            onClick={() => onMessage(selectedContact)}
          >
            {t('chat.social.contacts.sendMessage')}
          </Button>
        ) : (
          <ProfilePrimaryAction
            actorPtid={selectedContact.peerPtid}
            onMessage={() => onMessage(selectedContact)}
          />
        )}
      />
    </Flexbox>
  );
}

function requestStateKey(state: number): 'pending' | 'accepted' | 'rejected' {
  if (state === 2) return 'accepted';
  if (state === 3) return 'rejected';
  return 'pending';
}
