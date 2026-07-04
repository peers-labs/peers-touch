import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Dropdown, Input } from '@lobehub/ui';
import { Badge, Empty, theme, Typography } from 'antd';
import { BellOff, Pin, Search, Plus, UserPlus, Users, UsersRound, Volume2, VolumeX, CheckCheck, EyeOff, Trash2 } from 'lucide-react';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { useSocialChatStore } from '../../store/socialChat';
import type { DesktopIMConversationProjection } from '../../store/socialProjection';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { presentError } from '../../services/errorPresenter';
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
    messages,
    activeTab,
    activeSessionUlid,
    activeGroupUlid,
    conversationLocalState,
    setActiveTab,
    selectSession,
    selectGroup,
    getIMConversations,
    updateConversationLocalState,
    hideConversation,
    deleteGroupContact,
    deleteFriendContact,
  } = useSocialChatStore();

  const [searchText, setSearchText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showFindPeople, setShowFindPeople] = useState(false);

  // NOTE: Initial data loading (sessions, groups, previews) is owned by
  // `SocialChatPage`'s `tick()` effect — see comment there. We deliberately
  // do NOT re-fire those calls here, otherwise the cold path runs every
  // fetch twice in parallel and the spinner blocks longer than necessary.

  const conversations = useMemo(
    () => getIMConversations(),
    [
      getIMConversations,
      sessions,
      groups,
      groupUnreadCounts,
      lastPreviews,
      currentUserDid,
      conversationLocalState,
      messages,
    ],
  );

  const filteredItems = useMemo(() => {
    if (!searchText.trim()) return conversations;
    const q = searchText.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
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

  const handleSelect = (c: DesktopIMConversationProjection) => {
    if (c.kind === 'friend') {
      selectSession(c.id);
      setActiveTab('friend');
    } else {
      selectGroup(c.id);
      setActiveTab('group');
    }
  };

  const buildContextMenu = useCallback((c: DesktopIMConversationProjection) => {
    const localState = conversationLocalState[`${c.kind}:${c.id}`];
    const isPinned = Boolean(localState?.sticky);
    const isMuted = Boolean(localState?.muted);

    return {
      items: [
        {
          key: 'pin',
          icon: <Pin size={14} />,
          label: isPinned ? t('chat.social.contextMenu.unpin') : t('chat.social.contextMenu.pin'),
        },
        {
          key: 'mute',
          icon: isMuted ? <Volume2 size={14} /> : <VolumeX size={14} />,
          label: isMuted ? t('chat.social.contextMenu.unmute') : t('chat.social.contextMenu.mute'),
        },
        ...(c.unread > 0 ? [{
          key: 'markRead',
          icon: <CheckCheck size={14} />,
          label: t('chat.social.contextMenu.markRead'),
        }] : []),
        { type: 'divider' as const, key: 'divider-1' },
        {
          key: 'hide',
          icon: <EyeOff size={14} />,
          label: t('chat.social.contextMenu.hide'),
        },
        { type: 'divider' as const, key: 'divider-2' },
        {
          key: 'delete',
          icon: <Trash2 size={14} />,
          label: t('chat.social.contextMenu.delete'),
          danger: true,
        },
      ],
      onClick: async ({ key }: { key: string }) => {
        switch (key) {
          case 'pin':
            try {
              await updateConversationLocalState(c.kind, c.id, { sticky: !isPinned });
            } catch (error) {
              presentError(error, {
                mapper: mapChatError,
                context: { operation: 'conversationAction' },
              });
            }
            break;
          case 'mute':
            try {
              await updateConversationLocalState(c.kind, c.id, { muted: !isMuted });
            } catch (error) {
              presentError(error, {
                mapper: mapChatError,
                context: { operation: 'conversationAction' },
              });
            }
            break;
          case 'markRead':
            // Mark-read clears unread badge; for friend chats this acks messages.
            try {
              await updateConversationLocalState(c.kind, c.id, { clearedAt: 0 });
            } catch (error) {
              presentError(error, {
                mapper: mapChatError,
                context: { operation: 'conversationAction' },
              });
            }
            break;
          case 'hide':
            await hideConversation(c.kind, c.id, true);
            break;
          case 'delete': {
            try {
              if (c.kind === 'group') {
                await deleteGroupContact(c.id);
              } else {
                await deleteFriendContact(c.id);
              }
            } catch (error) {
              presentError(error, {
                mapper: mapChatError,
                context: { operation: 'delete' },
              });
            }
            break;
          }
        }
      },
    };
  }, [conversationLocalState, t, updateConversationLocalState, hideConversation, deleteGroupContact, deleteFriendContact]);

  const isRowActive = (c: DesktopIMConversationProjection) => {
    if (c.kind === 'friend') {
      return activeTab === 'friend' && c.id === activeSessionUlid;
    }
    return activeTab === 'group' && c.id === activeGroupUlid;
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
          {filteredItems.length === 0 ? (
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
              const name = c.title || t('chat.social.sessionList.unknown');
              const timeStr = relativeTime(c.lastActivity, t);
              const unread = c.unread;
              const localState = conversationLocalState[`${c.kind}:${c.id}`];

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
                if (c.kind === 'group' && p.senderDid) {
                  const senderShort = p.senderDid.length > 12 ? p.senderDid.slice(0, 12) + '…' : p.senderDid;
                  subtitle = `${senderShort}: ${text}`;
                } else {
                  subtitle = text;
                }
              }

              return (
                <Dropdown key={`${c.kind}-${c.id}`} menu={buildContextMenu(c)} trigger={['contextMenu']}>
                  <Flexbox
                    horizontal
                    align="center"
                    gap={10}
                    data-chat-conversation-kind={c.kind}
                    data-chat-session-ulid={c.kind === 'friend' ? c.id : undefined}
                    data-chat-group-ulid={c.kind === 'group' ? c.id : undefined}
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
                        {c.kind === 'group' && (
                          <Users size={12} style={{ color: token.colorTextSecondary, flexShrink: 0 }} aria-hidden />
                        )}
                        <Text strong ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                          {name}
                        </Text>
                        {localState?.sticky ? (
                          <Pin size={11} style={{ color: token.colorPrimary, flexShrink: 0 }} aria-label={t('chat.social.detail.stateSticky')} />
                        ) : null}
                        {localState?.muted || localState?.alertEnabled === false ? (
                          <BellOff size={11} style={{ color: token.colorTextTertiary, flexShrink: 0 }} aria-label={t('chat.social.detail.stateMuted')} />
                        ) : null}
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
                </Dropdown>
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
