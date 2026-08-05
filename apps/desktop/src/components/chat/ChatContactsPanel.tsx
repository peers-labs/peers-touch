import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Tag } from '@lobehub/ui';
import { Collapse, Empty, theme, Typography } from 'antd';
import { UserPlus, Users, Contact, ChevronRight, Check, X } from 'lucide-react';
import { currentAuthenticatedActorId } from '../../store/session';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { log } from '../../utils/logger';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';
import {
  friendContactSelection,
  type ContactSelection,
} from './contactSelection';

const { Text } = Typography;

const PANEL_WIDTH = 300;

interface ChatContactsPanelProps {
  selectedContact: ContactSelection | null;
  onSelectContact: (selection: ContactSelection) => void;
}

export function ChatContactsPanel({
  selectedContact,
  onSelectContact,
}: ChatContactsPanelProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    friendRequests,
    peerProfiles,
    currentUserDid,
    conversationRecords,
    conversationMembers,
    groupMembers,
    getIMConversations,
    selectSession,
    selectGroup,
    acceptFriendRequest,
    rejectFriendRequest,
  } = useActiveSocialChatSlice((s) => ({
    friendRequests: s.friendRequests,
    peerProfiles: s.peerProfiles,
    currentUserDid: s.currentUserDid,
    conversationRecords: s.conversations,
    conversationMembers: s.conversationMembers,
    groupMembers: s.groupMembers,
    getIMConversations: s.getIMConversations,
    selectSession: s.selectSession,
    selectGroup: s.selectGroup,
    acceptFriendRequest: s.acceptFriendRequest,
    rejectFriendRequest: s.rejectFriendRequest,
  }));

  const [busyAction, setBusyAction] = useState<{ id: string; kind: 'accept' | 'reject' } | null>(null);
  const conversations = useMemo(
    () => {
      // getIMConversations reads the store imperatively. Referencing its
      // projection sources here makes async Conversation loads invalidate
      // this memo without subscribing the panel to the whole social store.
      void conversationRecords;
      void conversationMembers;
      void groupMembers;
      void currentUserDid;
      void friendRequests;
      void peerProfiles;
      return getIMConversations();
    },
    [
      conversationMembers,
      conversationRecords,
      currentUserDid,
      friendRequests,
      getIMConversations,
      groupMembers,
      peerProfiles,
    ],
  );
  const groupConversations = conversations.filter((conversation) => conversation.kind === 'group');
  const friendConversations = conversations.filter((conversation) => conversation.kind === 'friend');

  const myDid = currentUserDid || currentAuthenticatedActorId() || '';

  const acceptedContacts = (() => {
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
  })();

  const totalContacts = friendConversations.length + acceptedContacts.length;

  const unifiedRequests = useMemo(() => {
    if (!myDid) return [];
    return friendRequests
      .filter((request) => request.senderId === myDid || request.receiverId === myDid)
      .map((request) => {
        const outgoing = request.senderId === myDid;
        return {
          request,
          direction: outgoing ? 'outgoing' as const : 'incoming' as const,
          peerDid: outgoing ? request.receiverId : request.senderId,
          peerName: outgoing ? request.receiverDisplayName : request.senderDisplayName,
          peerAvatar: outgoing ? request.receiverAvatar : request.senderAvatar,
        };
      })
      .sort((left, right) => {
        const leftTime = Date.parse(left.request.createdAt) || 0;
        const rightTime = Date.parse(right.request.createdAt) || 0;
        return rightTime - leftTime;
      });
  }, [friendRequests, myDid]);

  const pendingIncomingCount = useMemo(
    () => unifiedRequests.filter(
      ({ direction, request }) => direction === 'incoming' && request.status === 1,
    ).length,
    [unifiedRequests],
  );

  const requestCardStyle: CSSProperties = {
    padding: '10px',
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

  const selectAcceptedActor = (
    peerDid: string,
    displayName: string,
    avatar?: string,
  ) => {
    const selection = friendContactSelection(
      peerDid,
      displayName,
      avatar,
      friendConversations,
    );
    if (selection.conversationId) selectSession(selection.conversationId);
    onSelectContact(selection);
  };

  const newFriendsContent = unifiedRequests.length === 0 ? (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={t('chat.social.contacts.noPendingRequests')}
    />
  ) : (
    <Flexbox gap={8}>
      {unifiedRequests.map(({ request, direction, peerDid, peerName, peerAvatar }) => {
        const cachedProfile = peerProfiles[peerDid];
        const peerLabel = cachedProfile?.display_name?.trim()
          || cachedProfile?.username?.trim()
          || peerName
          || t('chat.social.sessionList.unknown');
        const resolvedAvatar = cachedProfile?.avatar?.trim() || peerAvatar;
        const isPendingIncoming = direction === 'incoming' && request.status === 1;
        const isAccepted = request.status === 2;
        const isSelected = selectedContact?.kind === 'friend'
          && selectedContact.peerDid === peerDid;
        return (
          <Flexbox
            key={request.id}
            horizontal
            align="flex-start"
            gap={10}
            title={peerLabel}
            role={isAccepted ? 'button' : undefined}
            tabIndex={isAccepted ? 0 : undefined}
            onClick={isAccepted
              ? () => selectAcceptedActor(peerDid, peerLabel, resolvedAvatar)
              : undefined}
            onKeyDown={isAccepted
              ? (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  selectAcceptedActor(peerDid, peerLabel, resolvedAvatar);
                }
              : undefined}
            style={{
              ...requestCardStyle,
              ...(isSelected ? selectedRowStyle : {}),
              cursor: isAccepted ? 'pointer' : 'default',
            }}
          >
            <UserSquareAvatar remoteUrl={resolvedAvatar} name={peerLabel} size={36} />
            <Flexbox flex={1} style={{ minWidth: 0 }} gap={5}>
              <Text
                strong
                style={{
                  fontSize: 13,
                  lineHeight: 1.35,
                  overflowWrap: 'anywhere',
                }}
              >
                {peerLabel}
              </Text>
              {request.message ? (
                <Text
                  type="secondary"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.4,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {request.message}
                </Text>
              ) : null}
              <Flexbox horizontal align="center" gap={6} style={{ flexWrap: 'wrap' }}>
                <Tag color={direction === 'incoming' ? 'blue' : 'default'}>
                  {t(`chat.social.contacts.direction.${direction}`)}
                </Tag>
                {statusTag(request.status)}
              </Flexbox>
              {isPendingIncoming ? (
                <Flexbox horizontal gap={6}>
                  <Button
                    size="small"
                    type="primary"
                    icon={<Check size={12} />}
                    loading={busyAction?.id === request.id && busyAction?.kind === 'accept'}
                    onClick={async () => {
                      setBusyAction({ id: request.id, kind: 'accept' });
                      try {
                        await acceptFriendRequest(request.id);
                      } catch (error) {
                        log.error('contacts', 'acceptFriendRequest failed', error);
                      } finally {
                        setBusyAction(null);
                      }
                    }}
                  >
                    {t('chat.social.contacts.accept')}
                  </Button>
                  <Button
                    size="small"
                    icon={<X size={12} />}
                    loading={busyAction?.id === request.id && busyAction?.kind === 'reject'}
                    onClick={async () => {
                      setBusyAction({ id: request.id, kind: 'reject' });
                      try {
                        await rejectFriendRequest(request.id);
                      } catch (error) {
                        log.error('contacts', 'rejectFriendRequest failed', error);
                      } finally {
                        setBusyAction(null);
                      }
                    }}
                  >
                    {t('chat.social.contacts.reject')}
                  </Button>
                </Flexbox>
              ) : null}
            </Flexbox>
          </Flexbox>
        );
      })}
    </Flexbox>
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
              const isSelected = selectedContact?.kind === 'group'
                && selectedContact.conversationId === conversation.id;
              const displayName = conversation.title || t('chat.social.sessionList.unnamedGroup');
              return (
                <Flexbox
                  key={conversation.id}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => {
                    selectGroup(conversation.id);
                    onSelectContact({
                      kind: 'group',
                      conversationId: conversation.id,
                      displayName,
                      avatar: conversation.avatar,
                      memberCount: conversation.memberCount ?? 0,
                    });
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
                    name={displayName}
                    size={avatarSize}
                  />
                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ fontSize: 13, color: isSelected ? token.colorPrimary : undefined }}>
                      {displayName}
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
              const isSelected = selectedContact?.kind === 'friend'
                && selectedContact.conversationId === conversation.id;
              return (
                <Flexbox
                  key={conversation.id}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => {
                    selectSession(conversation.id);
                    onSelectContact({
                      kind: 'friend',
                      conversationId: conversation.id,
                      peerDid: conversation.peerDid || '',
                      displayName: label,
                      avatar: conversation.avatar,
                    });
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
              const cachedProfile = peerProfiles[peerId];
              const label = cachedProfile?.display_name?.trim()
                || cachedProfile?.username?.trim()
                || peerName
                || t('chat.social.sessionList.unknown');
              const avatar = cachedProfile?.avatar?.trim() || peerAvatar;
              const isSelected = selectedContact?.kind === 'friend'
                && !selectedContact.conversationId
                && selectedContact.peerDid === peerId;
              return (
                <Flexbox
                  key={peerId}
                  horizontal
                  align="center"
                  gap={9}
                  onClick={() => onSelectContact({
                    kind: 'friend',
                    peerDid: peerId,
                    displayName: label,
                    avatar,
                  })}
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
                  <UserSquareAvatar remoteUrl={avatar} name={label} size={avatarSize} />
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
