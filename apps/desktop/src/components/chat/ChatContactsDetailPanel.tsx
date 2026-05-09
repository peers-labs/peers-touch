import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Empty, theme } from 'antd';
import { MessageCircle, Users } from 'lucide-react';

import { peerOfSession, useSocialChatStore } from '../../store/socialChat';
import { PublicProfileCard, type PublicProfileModel } from '../profile/PublicProfileCard';

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
    sessions,
    groups,
    currentUserDid,
    peerProfiles,
    loadPeerProfile,
    restoreConversation,
  } = useSocialChatStore();

  const activeSession = activeTab === 'friend'
    ? sessions.find((session) => session.ulid === activeSessionUlid)
    : undefined;
  const activeGroup = activeTab === 'group'
    ? groups.find((group) => group.ulid === activeGroupUlid)
    : undefined;

  const peer = activeSession ? peerOfSession(activeSession, currentUserDid) : null;
  const peerDid = peer?.did || '';
  const cachedPeer = peerDid ? peerProfiles[peerDid] : undefined;

  // Lazy peer profile load. The cache is single-owner (socialChat store);
  // running this effect here is the *view trigger*, not the projection.
  useEffect(() => {
    if (peerDid) {
      void loadPeerProfile(peerDid);
    }
  }, [peerDid, loadPeerProfile]);

  const profile = useMemo<PublicProfileModel | null>(() => {
    if (activeGroup) {
      return {
        displayName: activeGroup.name || t('chat.social.sessionList.unnamedGroup'),
        did: activeGroup.ulid,
        relationLabel: t('chat.social.contacts.groupLabel', { defaultValue: 'Group' }),
        relationTone: 'processing',
        stats: [
          {
            label: t('chat.social.detail.members', { defaultValue: 'members' }),
            value: Number(activeGroup.memberCount ?? 0),
          },
        ],
      };
    }
    if (!peer) return null;
    const sessionFallback: PublicProfileModel = {
      displayName: peer.name || t('chat.social.sessionList.unknown'),
      avatar: peer.avatar || '',
      did: peer.did || '',
      relationLabel: t('chat.social.contacts.friendLabel', { defaultValue: 'Friend' }),
      relationTone: 'success',
    };
    if (!cachedPeer) return sessionFallback;
    return mergePeerProfile(sessionFallback, cachedPeer, t);
  }, [activeGroup, peer, cachedPeer, t]);

  if (!activeSession && !activeGroup) {
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
        avatarNode={activeGroup ? (
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
              if (activeSession) restoreConversation('friend', activeSession.ulid);
              if (activeGroup) restoreConversation('group', activeGroup.ulid);
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
      label: t('chat.social.detail.posts', { defaultValue: 'Posts' }),
      value: remote.statuses_count,
    });
  }
  if (typeof remote.followers_count === 'number') {
    stats.push({
      label: t('chat.social.detail.followers', { defaultValue: 'Followers' }),
      value: remote.followers_count,
    });
  }
  if (typeof remote.following_count === 'number') {
    stats.push({
      label: t('chat.social.detail.following', { defaultValue: 'Following' }),
      value: remote.following_count,
    });
  }
  return stats;
}
