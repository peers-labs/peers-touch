import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Collapse, Empty, Modal, Tabs, theme, Typography } from 'antd';
import { UserPlus, Users, Contact, Check, X, Trash2 } from 'lucide-react';
import { peerOfSession, useSocialChatStore } from '../../store/socialChat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { log } from '../../utils/logger';

const { Text } = Typography;

const PANEL_WIDTH = 240;
const PENDING_STATUS = 1;
const ACCEPTED_STATUS = 2;
const REJECTED_STATUS = 3;

export function ChatContactsPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const sessions = useSocialChatStore((s) => s.sessions);
  const groups = useSocialChatStore((s) => s.groups);
  const friendRequests = useSocialChatStore((s) => s.friendRequests);
  const currentUserDid = useSocialChatStore((s) => s.currentUserDid);
  const activeTab = useSocialChatStore((s) => s.activeTab);
  const activeSessionUlid = useSocialChatStore((s) => s.activeSessionUlid);
  const activeGroupUlid = useSocialChatStore((s) => s.activeGroupUlid);
  const loadFriendRequests = useSocialChatStore((s) => s.loadFriendRequests);
  const selectSession = useSocialChatStore((s) => s.selectSession);
  const selectGroup = useSocialChatStore((s) => s.selectGroup);
  const setActiveTab = useSocialChatStore((s) => s.setActiveTab);
  const restoreConversation = useSocialChatStore((s) => s.restoreConversation);
  const deleteFriendContact = useSocialChatStore((s) => s.deleteFriendContact);
  const deleteGroupContact = useSocialChatStore((s) => s.deleteGroupContact);
  const acceptFriendRequest = useSocialChatStore((s) => s.acceptFriendRequest);
  const rejectFriendRequest = useSocialChatStore((s) => s.rejectFriendRequest);

  const [busyAction, setBusyAction] = useState<{ id: string; kind: 'accept' | 'reject' } | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void loadFriendRequests().catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [loadFriendRequests]);

  const receivedRequests = useMemo(() => {
    if (!currentUserDid) return [];
    return friendRequests.filter((r) => r.receiverId === currentUserDid);
  }, [friendRequests, currentUserDid]);

  const sentRequests = useMemo(() => {
    if (!currentUserDid) return [];
    return friendRequests.filter((r) => r.senderId === currentUserDid);
  }, [friendRequests, currentUserDid]);

  const pendingIncomingCount = useMemo(
    () => receivedRequests.filter((r) => r.status === PENDING_STATUS).length,
    [receivedRequests],
  );

  const avatarSize = 36;
  const selectedRowStyle: CSSProperties = {
    background: token.colorFillQuaternary,
  };

  const rowBaseStyle: CSSProperties = {
    padding: '9px 10px',
    borderRadius: 10,
    boxSizing: 'border-box',
    maxWidth: '100%',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
  };

  const rowListStyle: CSSProperties = {
    padding: '2px 0 4px',
    minWidth: 0,
    maxWidth: '100%',
  };

  function statusTag(status: number) {
    if (status === PENDING_STATUS) {
      return <Text style={{ fontSize: 11, color: token.colorInfoText, flexShrink: 0 }}>{t('chat.social.contacts.status.pending')}</Text>;
    }
    if (status === ACCEPTED_STATUS) {
      return <Text style={{ fontSize: 11, color: token.colorSuccessText, flexShrink: 0 }}>{t('chat.social.contacts.status.accepted')}</Text>;
    }
    if (status === REJECTED_STATUS) {
      return <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>{t('chat.social.contacts.status.rejected')}</Text>;
    }
    return null;
  }

  function confirmDeleteContact(kind: 'friend' | 'group', id: string, name: string) {
    Modal.confirm({
      title: kind === 'friend'
        ? t('chat.social.contacts.deleteFriendTitle', 'Delete contact?')
        : t('chat.social.contacts.deleteGroupTitle', 'Leave group?'),
      content: kind === 'friend'
        ? t('chat.social.contacts.deleteFriendDescription', 'This removes the contact and direct-chat history for both sides.')
        : t('chat.social.contacts.deleteGroupDescription', 'This leaves the group and removes it from your contacts.'),
      okText: t('chat.social.contacts.deleteConfirm', 'Delete'),
      cancelText: t('chat.social.createGroup.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          if (kind === 'friend') {
            await deleteFriendContact(id);
          } else {
            await deleteGroupContact(id);
          }
          toast.success(t('chat.social.contacts.deleteSuccess', '{{name}} deleted', { name }));
        } catch (error) {
          log.error('contacts', 'delete contact failed', error);
          toast.error(t('chat.social.contacts.deleteFailed', 'Delete failed'));
          throw error;
        }
      },
    });
  }

  function renderFriendRequestRow(req: typeof friendRequests[number], direction: 'received' | 'sent') {
    const peerLabel = direction === 'received'
      ? req.senderDisplayName || req.senderId
      : req.receiverDisplayName || req.receiverId;
    const peerAvatar = direction === 'received' ? req.senderAvatar : req.receiverAvatar;
    const isIncomingPending = direction === 'received' && req.status === PENDING_STATUS;

    return (
      <Flexbox
        key={req.id}
        horizontal
        align="flex-start"
        gap={9}
        style={{ ...rowBaseStyle, cursor: 'default' }}
      >
        <UserSquareAvatar remoteUrl={peerAvatar} name={peerLabel} size={avatarSize} />
        <Flexbox flex={1} style={{ minWidth: 0, maxWidth: '100%' }} gap={5}>
          <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0, maxWidth: '100%' }}>
            <Text strong ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
              {peerLabel}
            </Text>
            {statusTag(req.status)}
          </Flexbox>
          {req.message ? (
            <Text type="secondary" ellipsis style={{ fontSize: 12, maxWidth: '100%' }}>
              {req.message}
            </Text>
          ) : null}
          {isIncomingPending ? (
            <Flexbox horizontal gap={6} style={{ marginTop: 2, minWidth: 0, maxWidth: '100%' }}>
              <Button
                size="small"
                type="primary"
                icon={<Check size={12} />}
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
                style={{ flex: 1, minWidth: 0 }}
              >
                {t('chat.social.contacts.accept')}
              </Button>
              <Button
                size="small"
                icon={<X size={12} />}
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
                style={{ flex: 1, minWidth: 0 }}
              >
                {t('chat.social.contacts.reject')}
              </Button>
            </Flexbox>
          ) : null}
        </Flexbox>
      </Flexbox>
    );
  }

  const newFriendsContent = (
    <Tabs
      size="small"
      defaultActiveKey="received"
      items={[
        {
          key: 'received',
          label: t('chat.social.contacts.receivedTab'),
          children:
            receivedRequests.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('chat.social.contacts.noReceivedRequests')}
              />
            ) : (
              <Flexbox gap={2} style={rowListStyle}>
                {receivedRequests.map((req) => renderFriendRequestRow(req, 'received'))}
              </Flexbox>
            ),
        },
        {
          key: 'sent',
          label: t('chat.social.contacts.sentTab'),
          children:
            sentRequests.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noSentRequests')} />
            ) : (
              <Flexbox gap={2} style={rowListStyle}>
                {sentRequests.map((req) => renderFriendRequestRow(req, 'sent'))}
              </Flexbox>
            ),
        },
      ]}
    />
  );

  const collapseItems = [
    {
      key: 'new-friends',
      label: (
        <Flexbox horizontal align="center" gap={8}>
          <UserPlus size={14} style={{ color: token.colorTextSecondary }} />
          <Text strong style={{ fontSize: 13 }}>
            {t('chat.social.contacts.newFriendsCount', { count: pendingIncomingCount })}
          </Text>
        </Flexbox>
      ),
      children: newFriendsContent,
    },
    {
      key: 'saved-groups',
      label: (
        <Flexbox horizontal align="center" gap={8}>
          <Users size={14} style={{ color: token.colorTextSecondary }} />
          <Text strong style={{ fontSize: 13 }}>
            {t('chat.social.contacts.savedGroupsCount', { count: groups.length })}
          </Text>
        </Flexbox>
      ),
      children:
        groups.length === 0 ? (
          <Flexbox align="center" justify="center" style={{ padding: '14px 8px' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noGroups')} />
          </Flexbox>
        ) : (
          <Flexbox gap={3} style={rowListStyle}>
            {groups.map((g) => {
              const isSelected = activeTab === 'group' && g.ulid === activeGroupUlid;
              return (
                <Flexbox
                  key={g.ulid}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => {
                    restoreConversation('group', g.ulid);
                    selectGroup(g.ulid);
                    setActiveTab('group');
                  }}
                  style={{
                    ...rowBaseStyle,
                    ...(isSelected ? selectedRowStyle : {}),
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = token.colorFillQuaternary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSelected ? token.colorPrimaryBg : 'transparent';
                  }}
                >
                  <Flexbox
                    align="center"
                    justify="center"
                    style={{
                      width: avatarSize,
                      height: avatarSize,
                      borderRadius: Math.max(8, Math.floor(avatarSize * 0.25)),
                      background: isSelected ? token.colorPrimaryBgHover : token.colorFillSecondary,
                      color: isSelected ? token.colorPrimary : token.colorTextSecondary,
                      fontSize: 14,
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {(g.name || '?').charAt(0).toUpperCase()}
                  </Flexbox>
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ fontSize: 13, color: isSelected ? token.colorPrimary : undefined }}>
                      {g.name || t('chat.social.sessionList.unnamedGroup')}
                    </Text>
                    <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                      {t('chat.social.detail.membersCount', { count: g.memberCount ?? 0 })}
                    </Text>
                  </Flexbox>
                  <Button
                    type="text"
                    size="small"
                    icon={<Trash2 size={13} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmDeleteContact('group', g.ulid, g.name || t('chat.social.sessionList.unnamedGroup'));
                    }}
                    style={{ color: token.colorTextTertiary, flexShrink: 0 }}
                  />
                </Flexbox>
              );
            })}
          </Flexbox>
        ),
    },
    {
      key: 'friends',
      label: (
        <Flexbox horizontal align="center" gap={8}>
          <Contact size={14} style={{ color: token.colorTextSecondary }} />
          <Text strong style={{ fontSize: 13 }}>
            {t('chat.social.contacts.contactsCount', { count: sessions.length })}
          </Text>
        </Flexbox>
      ),
      children:
        sessions.length === 0 ? (
          <Flexbox align="center" justify="center" style={{ padding: '14px 8px' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noFriends')} />
          </Flexbox>
        ) : (
          <Flexbox gap={3} style={rowListStyle}>
            {sessions.map((s) => {
              const peer = peerOfSession(s, currentUserDid);
              const label = peer.name || t('chat.social.sessionList.unknown');
              const isSelected = activeTab === 'friend' && s.ulid === activeSessionUlid;
              return (
                <Flexbox
                  key={s.ulid}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => {
                    restoreConversation('friend', s.ulid);
                    selectSession(s.ulid);
                    setActiveTab('friend');
                  }}
                  style={{
                    ...rowBaseStyle,
                    ...(isSelected ? selectedRowStyle : {}),
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = token.colorFillQuaternary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSelected ? token.colorPrimaryBg : 'transparent';
                  }}
                >
                  <UserSquareAvatar remoteUrl={peer.avatar} name={label} size={avatarSize} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ fontSize: 13, color: isSelected ? token.colorPrimary : undefined }}>
                      {label}
                    </Text>
                    {peer.did ? (
                      <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                        {peer.did}
                      </Text>
                    ) : null}
                  </Flexbox>
                  <Button
                    type="text"
                    size="small"
                    icon={<Trash2 size={13} />}
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmDeleteContact('friend', s.ulid, label);
                    }}
                    style={{ color: token.colorTextTertiary, flexShrink: 0 }}
                  />
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
        width: PANEL_WIDTH,
        minWidth: PANEL_WIDTH,
        height: '100%',
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        overflow: 'hidden',
      }}
    >
      <Flexbox flex={1} style={{ overflow: 'auto', padding: '8px 6px' }}>
        <Collapse
          bordered={false}
          defaultActiveKey={['saved-groups', 'friends']}
          style={{ background: 'transparent', width: '100%' }}
          items={collapseItems}
        />
      </Flexbox>
    </Flexbox>
  );
}
