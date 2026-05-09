import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Dropdown, Input } from '@lobehub/ui';
import { Badge, Empty, Spin, theme, Typography } from 'antd';
import { Users, Search, Plus, UserPlus, UsersRound } from 'lucide-react';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useSocialChatStore } from '../../store/socialChat';
import type { UnifiedConversation } from '../../store/socialChat';
import { CreateGroupModal } from './CreateGroupModal';
import { FindPeopleModal } from './FindPeopleModal';

const { Text } = Typography;

function relativeTime(d: Date, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) return t('chat.social.time.justNow');
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return t('chat.social.time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('chat.social.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    if (hours === 1) return t('chat.social.time.oneHourAgo');
    return t('chat.social.time.hoursAgo', { count: hours });
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return t('chat.social.time.yesterday');
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function ChatSessionList() {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const {
    sessions,
    groups,
    groupUnreadCounts,
    lastPreviews,
    currentUserDid,
    activeTab,
    activeSessionUlid,
    activeGroupUlid,
    loading,
    setActiveTab,
    selectSession,
    selectGroup,
    getUnifiedConversations,
  } = useSocialChatStore();

  const [searchText, setSearchText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showFindPeople, setShowFindPeople] = useState(false);

  // NOTE: Initial data loading (sessions, groups, previews) is owned by
  // `SocialChatPage`'s `tick()` effect — see comment there. We deliberately
  // do NOT re-fire those calls here, otherwise the cold path runs every
  // fetch twice in parallel and the spinner blocks longer than necessary.

  const conversations = useMemo(
    () => getUnifiedConversations(),
    [getUnifiedConversations, sessions, groups, groupUnreadCounts, lastPreviews, currentUserDid],
  );

  const filteredItems = useMemo(() => {
    if (!searchText.trim()) return conversations;
    const q = searchText.toLowerCase();
    return conversations.filter((c) => c.name.toLowerCase().includes(q));
  }, [conversations, searchText]);

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

  const handleSelect = (c: UnifiedConversation) => {
    if (c.type === 'friend') {
      selectSession(c.ulid);
      setActiveTab('friend');
    } else {
      selectGroup(c.ulid);
      setActiveTab('group');
    }
  };

  const isRowActive = (c: UnifiedConversation) => {
    if (c.type === 'friend') {
      return activeTab === 'friend' && c.ulid === activeSessionUlid;
    }
    return activeTab === 'group' && c.ulid === activeGroupUlid;
  };

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
                description={
                  searchText ? t('chat.social.sessionList.noResults') : t('chat.social.sessionList.noConversations')
                }
              />
            </Flexbox>
          ) : (
            filteredItems.map((c) => {
              const isActive = isRowActive(c);
              const name = c.name || t('chat.social.sessionList.unknown');
              const timeStr = relativeTime(c.lastActivity, t);
              const unread = c.unread;

              let subtitle = '';
              if (c.preview) {
                const p = c.preview;
                let text: string;
                if (p.type === 2) {
                  text = t('chat.social.preview.image');
                } else if (p.type === 3) {
                  text = t('chat.social.preview.file');
                } else if (p.type === 4) {
                  text = t('chat.social.preview.audio');
                } else if (p.type === 5) {
                  text = t('chat.social.preview.video');
                } else {
                  text = p.content;
                }
                if (c.type === 'group' && p.senderDid) {
                  const senderShort = p.senderDid.length > 12 ? p.senderDid.slice(0, 12) + '…' : p.senderDid;
                  subtitle = `${senderShort}: ${text}`;
                } else {
                  subtitle = text;
                }
              }

              return (
                <Flexbox
                  key={`${c.type}-${c.ulid}`}
                  horizontal
                  align="center"
                  gap={10}
                  onClick={() => handleSelect(c)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isActive ? token.colorPrimaryBg : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <UserSquareAvatar remoteUrl={c.avatar} name={name} size={36} />

                  <Flexbox flex={1} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align="center" justify="space-between" gap={6}>
                      <Flexbox horizontal align="center" gap={6} style={{ minWidth: 0, flex: 1 }}>
                        {c.type === 'group' && (
                          <Users size={12} style={{ color: token.colorTextSecondary, flexShrink: 0 }} aria-hidden />
                        )}
                        <Text strong ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                          {name}
                        </Text>
                      </Flexbox>
                      <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
                        {timeStr}
                      </Text>
                    </Flexbox>
                    <Flexbox horizontal align="center" justify="space-between">
                      <Text type="secondary" ellipsis style={{ fontSize: 12, flex: 1, minWidth: 0 }}>
                        {subtitle}
                      </Text>
                      {unread > 0 && (
                        <Badge count={unread} size="small" style={{ marginLeft: 8 }} />
                      )}
                    </Flexbox>
                  </Flexbox>
                </Flexbox>
              );
            })
          )}
        </Flexbox>
      </Flexbox>

      <CreateGroupModal open={showCreateGroup} onClose={() => setShowCreateGroup(false)} />
      <FindPeopleModal open={showFindPeople} onClose={() => setShowFindPeople(false)} />
    </>
  );
}
