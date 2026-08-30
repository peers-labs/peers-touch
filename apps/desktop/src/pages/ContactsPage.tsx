import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Badge, Collapse, theme, Typography, Empty } from 'antd';
import { UserPlus, Users, Contact, ChevronRight, Check, X } from 'lucide-react';
import { groupAvatarRemoteUrl, peerOfSession, useSocialChatStore } from '../store/socialChat';
import { UserSquareAvatar } from '../components/common/UserSquareAvatar';
import { log } from '../utils/logger';

const { Text } = Typography;

function goToChat() {
  window.location.hash = '#/chat';
}

export function ContactsPage() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const sessions = useSocialChatStore(s => s.sessions);
  const groups = useSocialChatStore(s => s.groups);
  const friendRequests = useSocialChatStore(s => s.friendRequests);
  const peerProfiles = useSocialChatStore(s => s.peerProfiles);
  const currentUserPtid = useSocialChatStore(s => s.currentUserPtid);
  const selectSession = useSocialChatStore(s => s.selectSession);
  const selectGroup = useSocialChatStore(s => s.selectGroup);
  const setActiveTab = useSocialChatStore(s => s.setActiveTab);
  const acceptFriendRequest = useSocialChatStore(s => s.acceptFriendRequest);
  const rejectFriendRequest = useSocialChatStore(s => s.rejectFriendRequest);

  const [busyAction, setBusyAction] = useState<{ id: string; kind: 'accept' | 'reject' } | null>(null);

  const pendingRequests = friendRequests.filter((r) => r.status === 1);

  const collapseItems = [
    {
      key: 'new-friends',
      label: (
        <Flexbox horizontal align="center" justify="space-between" style={{ width: '100%', paddingRight: 8 }}>
          <Flexbox horizontal align="center" gap={8}>
            <UserPlus size={16} style={{ color: token.colorTextSecondary }} />
            <Text strong>{t('chat.social.contacts.newFriends')}</Text>
          </Flexbox>
          {pendingRequests.length > 0 ? (
            <Badge count={pendingRequests.length} size="small" />
          ) : null}
        </Flexbox>
      ),
      children:
        pendingRequests.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noPendingRequests')} />
        ) : (
          <Flexbox gap={8}>
            {pendingRequests.map((req) => {
              const cachedProfile = peerProfiles[req.senderPtid];
              const peerLabel = cachedProfile?.display_name?.trim()
                || cachedProfile?.username?.trim()
                || req.senderDisplayName
                || t('chat.social.sessionList.unknown');
              const peerAvatar = cachedProfile?.avatar?.trim() || req.senderAvatar;
              return (
                <Flexbox
                  key={req.id}
                  horizontal
                  align="flex-start"
                  gap={10}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <UserSquareAvatar remoteUrl={peerAvatar} name={peerLabel} size={40} />
                  <Flexbox flex={1} style={{ minWidth: 0 }} gap={6}>
                    <Text strong ellipsis style={{ fontSize: 13 }}>
                      {peerLabel}
                    </Text>
                  {req.message ? (
                    <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                      {req.message}
                    </Text>
                  ) : null}
                  <Flexbox horizontal gap={8} style={{ marginTop: 4 }}>
                    <Button
                      size="small"
                      type="primary"
                      icon={<Check size={14} />}
                      loading={busyAction?.id === req.id && busyAction?.kind === 'accept'}
                      onClick={async () => {
                        setBusyAction({ id: req.id, kind: 'accept' });
                        try {
                          await acceptFriendRequest(req.id);
                        } catch (e) {
                          log.error('contacts', 'acceptFriendRequest failed', e);
                        } finally {
                          setBusyAction(null);
                        }
                      }}
                    >
                      {t('chat.social.contacts.accept')}
                    </Button>
                    <Button
                      size="small"
                      icon={<X size={14} />}
                      loading={busyAction?.id === req.id && busyAction?.kind === 'reject'}
                      onClick={async () => {
                        setBusyAction({ id: req.id, kind: 'reject' });
                        try {
                          await rejectFriendRequest(req.id);
                        } catch (e) {
                          log.error('contacts', 'rejectFriendRequest failed', e);
                        } finally {
                          setBusyAction(null);
                        }
                      }}
                    >
                      {t('chat.social.contacts.reject')}
                    </Button>
                  </Flexbox>
                  </Flexbox>
                </Flexbox>
              );
            })}
          </Flexbox>
        ),
    },
    {
      key: 'saved-groups',
      label: (
        <Flexbox horizontal align="center" gap={8}>
          <Users size={16} style={{ color: token.colorTextSecondary }} />
          <Text strong>{t('chat.social.contacts.savedGroups')}</Text>
        </Flexbox>
      ),
      children:
        groups.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noGroups')} />
        ) : (
          <Flexbox gap={2}>
            {groups.map((g) => (
              <Flexbox
                key={g.ulid}
                horizontal
                align="center"
                gap={10}
                onClick={() => {
                  selectGroup(g.ulid);
                  setActiveTab('group');
                  goToChat();
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = token.colorFillQuaternary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <UserSquareAvatar
                  remoteUrl={groupAvatarRemoteUrl(g)}
                  name={g.name || t('chat.social.sessionList.unnamedGroup')}
                  size={40}
                />
                <Flexbox flex={1} style={{ minWidth: 0 }}>
                  <Text strong ellipsis style={{ fontSize: 14 }}>
                    {g.name || t('chat.social.sessionList.unnamedGroup')}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('chat.social.detail.membersCount', { count: g.memberCount ?? 0 })}
                  </Text>
                </Flexbox>
                <ChevronRight size={16} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
              </Flexbox>
            ))}
          </Flexbox>
        ),
    },
    {
      key: 'friends',
      label: (
        <Flexbox horizontal align="center" gap={8}>
          <Contact size={16} style={{ color: token.colorTextSecondary }} />
          <Text strong>{t('chat.social.contacts.friends')}</Text>
        </Flexbox>
      ),
      children:
        sessions.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noFriends')} />
        ) : (
          <Flexbox gap={2}>
            {sessions.map((s) => {
              const peer = peerOfSession(s, currentUserPtid);
              const label = peer.name || t('chat.social.sessionList.unknown');
              return (
                <Flexbox
                  key={s.ulid}
                  horizontal
                  align="center"
                  gap={10}
                  onClick={() => {
                    selectSession(s.ulid);
                    setActiveTab('friend');
                    goToChat();
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = token.colorFillQuaternary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <UserSquareAvatar remoteUrl={peer.avatar} name={label} size={40} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ fontSize: 14 }}>
                      {label}
                    </Text>
                  </Flexbox>
                  <ChevronRight size={16} style={{ color: token.colorTextQuaternary, flexShrink: 0 }} />
                </Flexbox>
              );
            })}
          </Flexbox>
        ),
    },
  ];

  return (
    <Flexbox
      style={{
        height: '100%',
        width: '100%',
        overflow: 'auto',
        padding: 16,
        background: token.colorBgLayout,
      }}
    >
      <Collapse
        bordered={false}
        defaultActiveKey={['new-friends', 'saved-groups', 'friends']}
        style={{ background: token.colorBgContainer, borderRadius: 8 }}
        items={collapseItems}
      />
    </Flexbox>
  );
}
