import { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Dropdown, Input, Segmented } from '@lobehub/ui';
import { Badge, Empty, Spin, theme, Typography } from 'antd';
import { MessageCircle, Users, Search, Plus, UserPlus, UsersRound } from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import type { FriendChatSession } from '../../gen/proto/domain/chat/friend_chat_pb';
import type { Group } from '../../gen/proto/domain/chat/group_chat_pb';
import type { Timestamp } from '@bufbuild/protobuf/wkt';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { CreateGroupModal } from './CreateGroupModal';
import { FindPeopleModal } from './FindPeopleModal';

const { Text } = Typography;

function formatTime(ts: Timestamp | undefined, t: (key: string) => string): string {
  if (!ts) return '';
  const d = timestampDate(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return t('chat.social.sessionList.yesterday');
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

export function ChatSessionList() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    sessions, groups, activeTab, activeSessionUlid, activeGroupUlid,
    loading, loadSessions, loadGroups, setActiveTab, selectSession, selectGroup,
  } = useSocialChatStore();

  const [searchText, setSearchText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showFindPeople, setShowFindPeople] = useState(false);

  useEffect(() => {
    loadSessions();
    loadGroups();
  }, [loadSessions, loadGroups]);

  const activeUlid = activeTab === 'friend' ? activeSessionUlid : activeGroupUlid;

  const filteredItems = useMemo(() => {
    const items = activeTab === 'friend' ? sessions : groups;
    if (!searchText.trim()) return items;
    const q = searchText.toLowerCase();
    return items.filter((item) => {
      const name = activeTab === 'friend'
        ? (item as FriendChatSession).participantBDid
        : (item as Group).name;
      return (name || '').toLowerCase().includes(q);
    });
  }, [activeTab, sessions, groups, searchText]);

  const plusMenuItems = [
    {
      key: 'find-people',
      icon: <UserPlus size={14} />,
      label: t('chat.social.sessionList.findPeople'),
      onClick: () => setShowFindPeople(true),
    },
    {
      key: 'create-group',
      icon: <UsersRound size={14} />,
      label: t('chat.social.sessionList.createGroup'),
      onClick: () => setShowCreateGroup(true),
    },
  ];

  return (
    <>
      <Flexbox
        gap={0}
        style={{
          width: 280,
          minWidth: 280,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <Flexbox gap={8} style={{ padding: '12px 12px 0' }}>
          <Flexbox horizontal align="center" gap={8}>
            <Input
              prefix={<Search size={14} style={{ color: token.colorTextQuaternary }} />}
              placeholder={t('chat.social.sessionList.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ flex: 1 }}
              size="small"
            />
            <Dropdown menu={{ items: plusMenuItems }} trigger={['click']} placement="bottomRight">
              <Button
                size="small"
                type="text"
                icon={<Plus size={16} />}
                style={{
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              />
            </Dropdown>
          </Flexbox>

          <Segmented
            block
            value={activeTab}
            onChange={(v) => setActiveTab(v as 'friend' | 'group')}
            options={[
              { label: t('chat.social.sessionList.friends'), value: 'friend', icon: <MessageCircle size={14} /> },
              { label: t('chat.social.sessionList.groups'), value: 'group', icon: <Users size={14} /> },
            ]}
            size="small"
            style={{ width: '100%' }}
          />
        </Flexbox>

        <Flexbox flex={1} style={{ overflow: 'auto', padding: '8px 8px' }} gap={2}>
          {loading && filteredItems.length === 0 ? (
            <Flexbox align="center" justify="center" flex={1}>
              <Spin size="small" />
            </Flexbox>
          ) : filteredItems.length === 0 ? (
            <Flexbox align="center" justify="center" flex={1}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={searchText ? t('chat.social.sessionList.noResults') : activeTab === 'friend' ? t('chat.social.sessionList.noConversations') : t('chat.social.sessionList.noGroups')}
              />
            </Flexbox>
          ) : (
            filteredItems.map((item) => {
              const ulid = item.ulid;
              const isActive = ulid === activeUlid;

              let name: string;
              let lastMsg: string;
              let timeStr: string;
              let unread: number;

              if (activeTab === 'friend') {
                const s = item as FriendChatSession;
                name = s.participantBDid || t('chat.social.sessionList.unknown');
                lastMsg = s.lastMessageUlid ? t('chat.social.sessionList.message') : '';
                timeStr = formatTime(s.lastMessageAt ?? s.updatedAt, t);
                unread = s.unreadCountB || 0;
              } else {
                const g = item as Group;
                name = g.name || t('chat.social.sessionList.unnamedGroup');
                lastMsg = t('chat.social.detail.membersCount', { count: g.memberCount || 0 });
                timeStr = formatTime(g.updatedAt, t);
                unread = 0;
              }

              const avatarBg = isActive ? token.colorPrimary : token.colorFillSecondary;
              const avatarColor = isActive ? '#fff' : token.colorTextSecondary;

              return (
                <Flexbox
                  key={ulid}
                  horizontal
                  align="center"
                  gap={10}
                  onClick={() => activeTab === 'friend' ? selectSession(ulid) : selectGroup(ulid)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isActive ? token.colorPrimaryBg : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <Flexbox
                      align="center"
                      justify="center"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        background: avatarBg,
                        color: avatarColor,
                        fontSize: 14,
                        fontWeight: 600,
                      }}
                    >
                      {getInitial(name)}
                    </Flexbox>
                    {/* TODO: online status indicator — will be added when per-user online check API is available */}
                  </div>

                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align="center" justify="space-between">
                      <Text strong ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>{name}</Text>
                      <Text
                        type="secondary"
                        style={{ fontSize: 11, flexShrink: 0, marginLeft: 8 }}
                      >
                        {timeStr}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal align="center" justify="space-between">
                      <Text
                        type="secondary"
                        ellipsis
                        style={{ fontSize: 12, flex: 1, minWidth: 0 }}
                      >
                        {lastMsg}
                      </Text>
                      {unread > 0 && (
                        <Badge
                          count={unread}
                          size="small"
                          style={{ marginLeft: 8 }}
                        />
                      )}
                    </Flexbox>
                  </Flexbox>
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      </Flexbox>

      <CreateGroupModal
        open={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
      />
      <FindPeopleModal
        open={showFindPeople}
        onClose={() => setShowFindPeople(false)}
      />
    </>
  );
}
