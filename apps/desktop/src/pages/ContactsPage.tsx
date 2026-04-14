import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button } from '@lobehub/ui';
import { Badge, Collapse, theme, Typography, Empty } from 'antd';
import { UserPlus, Users, Contact, ChevronRight, Check, X } from 'lucide-react';
import { useSocialChatStore } from '../store/socialChat';
import type { FriendChatSession } from '../gen/proto/domain/chat/friend_chat_pb';
import { log } from '../utils/logger';

const { Text } = Typography;

function getInitial(label: string): string {
  if (!label) return '?';
  return label.charAt(0).toUpperCase();
}

function peerDid(s: FriendChatSession, viewerDid: string | null): string {
  if (viewerDid) {
    if (s.participantADid === viewerDid) return s.participantBDid || '';
    if (s.participantBDid === viewerDid) return s.participantADid || '';
  }
  return s.participantBDid || s.participantADid || '';
}

function goToChat() {
  window.location.hash = '#/chat';
}

export function ContactsPage() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    sessions,
    groups,
    friendRequests,
    currentUserDid,
    loadSessions,
    loadGroups,
    loadFriendRequests,
    selectSession,
    selectGroup,
    setActiveTab,
    acceptFriendRequest,
    rejectFriendRequest,
  } = useSocialChatStore();

  const [busyAction, setBusyAction] = useState<{ id: string; kind: 'accept' | 'reject' } | null>(null);

  useEffect(() => {
    void loadFriendRequests().catch(() => {});
  }, [loadFriendRequests]);

  useEffect(() => {
    void loadGroups().catch(() => {});
  }, [loadGroups]);

  useEffect(() => {
    void loadSessions().catch(() => {});
  }, [loadSessions]);

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
            {pendingRequests.map((req) => (
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
                <Flexbox
                  align="center"
                  justify="center"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: token.colorFillSecondary,
                    color: token.colorTextSecondary,
                    fontSize: 15,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {getInitial(req.senderId)}
                </Flexbox>
                <Flexbox flex={1} style={{ minWidth: 0 }} gap={6}>
                  <Text strong ellipsis style={{ fontSize: 13 }}>
                    {req.senderId}
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
            ))}
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
                <Flexbox
                  align="center"
                  justify="center"
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: token.colorFillSecondary,
                    color: token.colorTextSecondary,
                    fontSize: 15,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {getInitial(g.name || '?')}
                </Flexbox>
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
              const did = peerDid(s, currentUserDid);
              const label = did || t('chat.social.sessionList.unknown');
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
                  <Flexbox
                    align="center"
                    justify="center"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      background: token.colorFillSecondary,
                      color: token.colorTextSecondary,
                      fontSize: 15,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {getInitial(label)}
                  </Flexbox>
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
