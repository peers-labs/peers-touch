import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Empty, theme } from 'antd';
import { MessageCircle, Users } from 'lucide-react';

import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';

interface ChatContactsDetailPanelProps {
  onMessage: () => void;
}

export function ChatContactsDetailPanel({ onMessage }: ChatContactsDetailPanelProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    activeTab,
    activeSessionUlid,
    activeGroupUlid,
    getIMConversations,
    peerProfiles,
    loadPeerProfile,
    restoreConversation,
  } = useActiveSocialChatSlice((s) => ({
    activeTab: s.activeTab,
    activeSessionUlid: s.activeSessionUlid,
    activeGroupUlid: s.activeGroupUlid,
    getIMConversations: s.getIMConversations,
    peerProfiles: s.peerProfiles,
    loadPeerProfile: s.loadPeerProfile,
    restoreConversation: s.restoreConversation,
  }));

  const activeConversationId = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;
  const activeConversation = activeConversationId
    ? getIMConversations().find(
      (conversation) => conversation.kind === activeTab && conversation.id === activeConversationId,
    )
    : undefined;
  const isGroup = activeConversation?.kind === 'group';
  const peerDid = activeConversation?.kind === 'friend' ? activeConversation.peerDid || '' : '';
  const cachedPeer = peerDid ? peerProfiles[peerDid] : undefined;

  // Lazy peer profile load. The cache is single-owner (socialChat store);
  // running this effect here is the *view trigger*, not the projection.
  useEffect(() => {
    if (peerDid) {
      void loadPeerProfile(peerDid);
    }
  }, [peerDid, loadPeerProfile]);

  const profile = useMemo<PublicProfileModel | null>(() => {
    if (activeConversation?.kind === 'group') {
      return {
        displayName: activeConversation.title || t('chat.social.sessionList.unnamedGroup'),
        did: activeConversation.id,
        relationLabel: t('chat.social.contacts.groupLabel'),
        relationTone: 'processing',
        stats: [
          {
            label: t('chat.social.detail.membersLabel'),
            value: Number(activeConversation.memberCount ?? 0),
          },
        ],
      };
    }
    if (!activeConversation) return null;
    const sessionFallback: PublicProfileModel = {
      displayName: activeConversation.title || t('chat.social.sessionList.unknown'),
      avatar: activeConversation.avatar || '',
      did: peerDid,
      relationLabel: t('chat.social.contacts.friendLabel'),
      relationTone: 'success',
    };
    if (!cachedPeer) return sessionFallback;
    return mergePeerProfile(sessionFallback, cachedPeer, t);
  }, [activeConversation, cachedPeer, peerDid, t]);

  if (!activeConversation) {
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
            block
            size="large"
            type="primary"
            icon={<MessageCircle size={16} />}
            onClick={() => {
              if (activeConversation) restoreConversation(activeConversation.kind, activeConversation.id);
              onMessage();
            }}
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
