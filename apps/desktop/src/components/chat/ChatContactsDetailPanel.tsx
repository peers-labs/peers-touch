import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Empty, theme } from 'antd';
import { MessageCircle, Users } from 'lucide-react';

import { peerOfSession, useSocialChatStore } from '../../store/socialChat';
import { PublicProfileCard } from '../profile/PublicProfileCard';

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
    restoreConversation,
  } = useSocialChatStore();

  const activeSession = activeTab === 'friend'
    ? sessions.find((session) => session.ulid === activeSessionUlid)
    : undefined;
  const activeGroup = activeTab === 'group'
    ? groups.find((group) => group.ulid === activeGroupUlid)
    : undefined;

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

  const peer = activeSession ? peerOfSession(activeSession, currentUserDid) : null;
  const title = peer?.name || activeGroup?.name || t('chat.social.sessionList.unknown');
  const profile = activeGroup
    ? {
        displayName: title,
        did: activeGroup.ulid,
        relationLabel: t('chat.social.contacts.groupLabel', { defaultValue: 'Group' }),
        relationTone: 'processing' as const,
        stats: [
          {
            label: t('chat.social.detail.members', { defaultValue: 'members' }),
            value: Number(activeGroup.memberCount ?? 0),
          },
        ],
      }
    : {
        displayName: title,
        avatar: peer?.avatar || '',
        did: peer?.did || '',
        relationLabel: t('chat.social.contacts.friendLabel', { defaultValue: 'Friend' }),
        relationTone: 'success' as const,
      };

  return (
    <Flexbox
      flex={1}
      align="center"
      justify="center"
      style={{ background: token.colorBgLayout, padding: 32 }}
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
