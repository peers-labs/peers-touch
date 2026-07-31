import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tag } from '@lobehub/ui';
import { Badge, Collapse, Empty, Tabs, theme, Typography } from 'antd';
import { UserPlus, Users, Contact, ChevronRight, Check, X } from 'lucide-react';
import { currentAuthenticatedActorId } from '../../store/session';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { log } from '../../utils/logger';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';

const { Text } = Typography;

const PANEL_WIDTH = 240;

export function ChatContactsPanel() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    friendRequests,
    currentUserDid,
    activeTab,
    activeSessionUlid,
    activeGroupUlid,
    getIMConversations,
    selectSession,
    selectGroup,
    acceptFriendRequest,
    rejectFriendRequest,
    loadFriendRequests,
  } = useActiveSocialChatSlice((s) => ({
    friendRequests: s.friendRequests,
    currentUserDid: s.currentUserDid,
    activeTab: s.activeTab,
    activeSessionUlid: s.activeSessionUlid,
    activeGroupUlid: s.activeGroupUlid,
    getIMConversations: s.getIMConversations,
    selectSession: s.selectSession,
    selectGroup: s.selectGroup,
    acceptFriendRequest: s.acceptFriendRequest,
    rejectFriendRequest: s.rejectFriendRequest,
    loadFriendRequests: s.loadFriendRequests,
  }));

  useEffect(() => {
    loadFriendRequests();
  }, [loadFriendRequests]);

  const [busyAction, setBusyAction] = useState<{ id: string; kind: 'accept' | 'reject' } | null>(null);
  const conversations = getIMConversations();
  const groupConversations = conversations.filter((conversation) => conversation.kind === 'group');
  const friendConversations = conversations.filter((conversation) => conversation.kind === 'friend');

  const myDid = currentUserDid || currentAuthenticatedActorId() || '';

  const acceptedContacts = useMemo(() => {
    const existingPeerIds = new Set(friendConversations.map((c) => c.peerDid).filter(Boolean));
    return friendRequests
      .filter((r) => r.status === 2)
      .map((r) => {
        const isSender = r.senderId === myDid;
        const peerId = isSender ? r.receiverId : r.senderId;
        const peerName = isSender ? r.receiverDisplayName : r.senderDisplayName;
        const peerAvatar = isSender ? r.receiverAvatar : r.senderAvatar;
        return { peerId, peerName, peerAvatar };
      })
      .filter(({ peerId }) => !existingPeerIds.has(peerId));
  }, [friendRequests, friendConversations, myDid]);

  const totalContacts = friendConversations.length + acceptedContacts.length;

  const receivedRequests = useMemo(() => {
    if (!myDid) return [];
    return friendRequests.filter((r) => r.receiverId === myDid);
  }, [friendRequests, myDid]);

  const sentRequests = useMemo(() => {
    if (!myDid) return [];
    return friendRequests.filter((r) => r.senderId === myDid);
  }, [friendRequests, myDid]);

  const pendingIncomingCount = useMemo(
    () => receivedRequests.filter((r) => r.status === 1).length,
    [receivedRequests],
  );

  const requestCardStyle: CSSProperties = {
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorFillQuaternary,
  };

  const avatarSize = 36;
  const selectedRowStyle: CSSProperties = {
    background: token.colorPrimaryBg,
    color: token.colorPrimary,
    boxShadow: `inset 0 0 0 1px ${token.colorPrimaryBorder}`,
  };

  const rowBaseStyle: CSSProperties = {
    padding: '9px 10px',
    borderRadius: 10,
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s, box-shadow 0.15s',
  };

  const rowListStyle: CSSProperties = {
    padding: '2px 0 4px',
  };

  function statusTag(status: number) {
    if (status === 1) {
      return <Tag color="blue">{t('chat.social.contacts.status.pending')}</Tag>;
    }
    if (status === 2) {
      return <Tag color="green">{t('chat.social.contacts.status.accepted')}</Tag>;
    }
    if (status === 3) {
      return <Tag>{t('chat.social.contacts.status.rejected')}</Tag>;
    }
    return null;
  }

  const newFriendsContent = (
    <Tabs
      size="small"
      centered
      defaultActiveKey="received"
      items={[
        {
          key: 'received',
          label: (
            <Badge count={pendingIncomingCount} size="small" offset={[6, -2]}>
              {t('chat.social.contacts.receivedTab')}
            </Badge>
          ),
          children:
            receivedRequests.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('chat.social.contacts.noReceivedRequests')}
              />
            ) : (
              <Flexbox gap={8}>
                {receivedRequests.map((req) => {
                  const peerLabel = req.senderDisplayName || req.senderId;
                  const peerAvatar = req.senderAvatar;
                  const isPending = req.status === 1;
                  return (
                    <Flexbox
                      key={req.id}
                      horizontal
                      align="flex-start"
                      gap={8}
                      title={peerLabel}
                      style={{ ...requestCardStyle, cursor: 'default' }}
                    >
                      <UserSquareAvatar remoteUrl={peerAvatar} name={peerLabel} size={30} />
                      <Flexbox flex={1} style={{ minWidth: 0 }} gap={4}>
                        <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
                          <Text strong ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                            {peerLabel}
                          </Text>
                          {statusTag(req.status)}
                        </Flexbox>
                        {req.message ? (
                          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                            {req.message}
                          </Text>
                        ) : null}
                        {isPending ? (
                          <Flexbox horizontal gap={6} style={{ marginTop: 2 }}>
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
                            />
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
                            />
                          </Flexbox>
                        ) : null}
                      </Flexbox>
                    </Flexbox>
                  );
                })}
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
              <Flexbox gap={8}>
                {sentRequests.map((req) => {
                  const peerLabel = req.receiverDisplayName || req.receiverId;
                  const peerAvatar = req.receiverAvatar;
                  return (
                    <Flexbox
                      key={req.id}
                      horizontal
                      align="flex-start"
                      gap={8}
                      title={peerLabel}
                      style={{ ...requestCardStyle, cursor: 'default' }}
                    >
                      <UserSquareAvatar remoteUrl={peerAvatar} name={peerLabel} size={30} />
                      <Flexbox flex={1} style={{ minWidth: 0 }} gap={4}>
                        <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0 }}>
                          <Text strong ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                            {peerLabel}
                          </Text>
                          {statusTag(req.status)}
                        </Flexbox>
                        {req.message ? (
                          <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                            {req.message}
                          </Text>
                        ) : null}
                      </Flexbox>
                    </Flexbox>
                  );
                })}
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
            {t('chat.social.contacts.savedGroupsCount', { count: groupConversations.length })}
          </Text>
        </Flexbox>
      ),
      children:
        groupConversations.length === 0 ? (
          <Flexbox align="center" justify="center" style={{ padding: '14px 8px' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noGroups')} />
          </Flexbox>
        ) : (
          <Flexbox gap={3} style={rowListStyle}>
            {groupConversations.map((conversation) => {
              const isSelected = activeTab === 'group' && conversation.id === activeGroupUlid;
              return (
                <Flexbox
                  key={conversation.id}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => {
                    selectGroup(conversation.id);
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
                  <UserSquareAvatar
                    remoteUrl={conversation.avatar}
                    name={conversation.title || t('chat.social.sessionList.unnamedGroup')}
                    size={avatarSize}
                  />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ fontSize: 13, color: isSelected ? token.colorPrimary : undefined }}>
                      {conversation.title || t('chat.social.sessionList.unnamedGroup')}
                    </Text>
                    <Text type="secondary" ellipsis style={{ fontSize: 11 }}>
                      {t('chat.social.detail.membersCount', { count: conversation.memberCount ?? 0 })}
                    </Text>
                  </Flexbox>
                  <ChevronRight
                    size={14}
                    style={{
                      color: isSelected ? token.colorPrimary : token.colorTextQuaternary,
                      flexShrink: 0,
                    }}
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
            {t('chat.social.contacts.contactsCount', { count: totalContacts })}
          </Text>
        </Flexbox>
      ),
      children:
        totalContacts === 0 ? (
          <Flexbox align="center" justify="center" style={{ padding: '14px 8px' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('chat.social.contacts.noFriends')} />
          </Flexbox>
        ) : (
          <Flexbox gap={3} style={rowListStyle}>
            {friendConversations.map((conversation) => {
              const label = conversation.title || t('chat.social.sessionList.unknown');
              const isSelected = activeTab === 'friend' && conversation.id === activeSessionUlid;
              return (
                <Flexbox
                  key={conversation.id}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => {
                    selectSession(conversation.id);
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
                  <UserSquareAvatar remoteUrl={conversation.avatar} name={label} size={avatarSize} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ fontSize: 13, color: isSelected ? token.colorPrimary : undefined }}>
                      {label}
                    </Text>
                  </Flexbox>
                  <ChevronRight
                    size={14}
                    style={{
                      color: isSelected ? token.colorPrimary : token.colorTextQuaternary,
                      flexShrink: 0,
                    }}
                  />
                </Flexbox>
              );
            })}
            {acceptedContacts.map(({ peerId, peerName, peerAvatar }) => {
              const label = peerName || peerId;
              return (
                <Flexbox
                  key={peerId}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => selectSession(peerId)}
                  style={rowBaseStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.background = token.colorFillQuaternary; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <UserSquareAvatar remoteUrl={peerAvatar} name={label} size={avatarSize} />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ fontSize: 13 }}>
                      {label}
                    </Text>
                  </Flexbox>
                  <ChevronRight
                    size={14}
                    style={{ color: token.colorTextQuaternary, flexShrink: 0 }}
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
          style={{ background: 'transparent' }}
          items={collapseItems}
        />
      </Flexbox>
    </Flexbox>
  );
}
