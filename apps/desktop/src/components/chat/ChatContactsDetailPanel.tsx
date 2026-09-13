import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Empty, theme } from 'antd';
import { MessageCircle, Users } from 'lucide-react';

import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';
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
  openingPeerPtid,
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
  const peerPtid = selectedContact?.kind === 'friend' ? selectedContact.peerPtid : '';
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
    const sessionFallback: PublicProfileModel = {
      displayName: selectedContact.displayName,
      avatar: selectedContact.avatar || '',
      username: selectedContact.username || undefined,
      did: peerPtid,
      identityMetadata: [
        selectedContact.federationName || selectedContact.federationId,
        selectedContact.federatedHandle
          || selectedContact.homeStationDomain
          || selectedContact.homeStationPeerId,
      ].filter(Boolean),
      relationLabel: t('chat.social.contacts.friendLabel'),
      relationTone: 'success',
    };
    if (!cachedPeer) return sessionFallback;
    return mergePeerProfile(sessionFallback, cachedPeer, t);
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
              width: 72,
              height: 72,
              borderRadius: 18,
              background: token.colorFillSecondary,
              color: token.colorTextSecondary,
            }}
          >
            <Users size={34} />
          </Flexbox>
        ) : undefined}
        actions={(
          <Button
            data-chat-contact-message
            block
            size="large"
            type="primary"
            icon={<MessageCircle size={16} />}
            loading={
              selectedContact.kind === 'friend'
              && openingPeerPtid === selectedContact.peerPtid
            }
            onClick={() => onMessage(selectedContact)}
          >
            {t('chat.social.contacts.sendMessage')}
          </Button>
        )}
      />
    </Flexbox>
  );
}

// Merge a session-derived fallback with the rich Station profile. Station
// values win when present so freshly-edited bios/regions show through, while
// the session row keeps the avatar/displayName visible during the brief
// network round-trip.
function mergePeerProfile(
  fallback: PublicProfileModel,
  remote: import('../../services/desktop_api').AccountProfile,
  t: (key: string, opts?: Record<string, unknown>) => string,
): PublicProfileModel {
  const stats = buildStats(remote, t);
  return {
    ...fallback,
    displayName: remote.display_name?.trim() || fallback.displayName,
    username: remote.username?.trim() || undefined,
    avatar: remote.avatar?.trim() || fallback.avatar,
    header: remote.header?.trim() || undefined,
    bio: remote.note?.trim() || undefined,
    did: remote.id?.trim() || fallback.did,
    createdAt: remote.created_at?.trim() || undefined,
    region: remote.region?.trim() || undefined,
    tags: (remote.tags ?? []).filter(Boolean),
    links: (remote.links ?? []).filter((l) => l && (l.label || l.url)),
    stats: stats.length > 0 ? stats : fallback.stats,
  };
}

function buildStats(
  remote: import('../../services/desktop_api').AccountProfile,
  t: (key: string, opts?: Record<string, unknown>) => string,
): { label: string; value: number }[] {
  const stats: { label: string; value: number }[] = [];
  if (typeof remote.statuses_count === 'number') {
    stats.push({
      label: t('chat.social.detail.posts'),
      value: remote.statuses_count,
    });
  }
  if (typeof remote.followers_count === 'number') {
    stats.push({
      label: t('chat.social.detail.followers'),
      value: remote.followers_count,
    });
  }
  if (typeof remote.following_count === 'number') {
    stats.push({
      label: t('chat.social.detail.following'),
      value: remote.following_count,
    });
  }
  return stats;
}
