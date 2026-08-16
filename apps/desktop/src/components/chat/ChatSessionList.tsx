import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Dropdown, Input } from '@lobehub/ui';
import { Alert, Badge, Empty, theme, Typography } from 'antd';
import { RefreshCw, BellOff, Pin, Search, Plus, UserPlus, Users, UsersRound, Volume2, VolumeX, CheckCheck, EyeOff } from 'lucide-react';
import type { IMConversationProjection } from '@peers-touch/client-chat-core';
import { GroupSquareAvatar } from '../common/GroupSquareAvatar';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { presentError } from '../../services/errorPresenter';
import { markOverlayIntent, markOverlayVisible } from '../../kernel/frontendRuntimeProfiler';
import { OverlayCommitProfiler } from '../../kernel/OverlayCommitProfiler';
import { imServiceV1 } from '../../services/im-service';
import { useNavigationBadgeStore } from '../../store/navigationBadges';
import { useActiveSocialChatSlice } from './useActiveSocialChatStore';
import { ChatSearchDropdown } from './ChatSearchDropdown';
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
  const { t } = useTranslation(['chat', 'common']);
  const {
    sessions,
    groups,
    conversations,
    groupMembers,
    groupUnreadCounts,
    lastPreviews,
    currentUserDid,
    messages,
    activeTab,
    activeSessionUlid,
    activeGroupUlid,
    conversationLocalState,
    loadError,
    peerProfiles,
    friendRequests,
    selectSession,
    selectGroup,
    getIMConversations,
    updateConversationLocalState,
    hideConversation,
    loadSessions,
    loadGroups,
  } = useActiveSocialChatSlice((state) => ({
    sessions: state.sessions,
    groups: state.groups,
    conversations: state.conversations,
    groupMembers: state.groupMembers,
    groupUnreadCounts: state.groupUnreadCounts,
    lastPreviews: state.lastPreviews,
    currentUserDid: state.currentUserDid,
    messages: state.messages,
    activeTab: state.activeTab,
    activeSessionUlid: state.activeSessionUlid,
    activeGroupUlid: state.activeGroupUlid,
    conversationLocalState: state.conversationLocalState,
    loadError: state.loadError,
    peerProfiles: state.peerProfiles,
    friendRequests: state.friendRequests,
    selectSession: state.selectSession,
    selectGroup: state.selectGroup,
    getIMConversations: state.getIMConversations,
    updateConversationLocalState: state.updateConversationLocalState,
    hideConversation: state.hideConversation,
    loadSessions: state.loadSessions,
    loadGroups: state.loadGroups,
  }));

  const [searchText, setSearchText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showFindPeople, setShowFindPeople] = useState(false);
  const clearChatUnread = useNavigationBadgeStore((state) => state.clearChatUnread);

  // NOTE: Initial data loading (sessions, groups, previews) is owned by
  // `SocialChatPage`'s `tick()` effect — see comment there. We deliberately
  // do NOT re-fire those calls here, otherwise the cold path runs every
  // fetch twice in parallel and the spinner blocks longer than necessary.

  const visibleConversations = useMemo(
    () => getIMConversations().filter((c) => !c.hidden),
    [
      getIMConversations,
      conversations,
      sessions,
      groups,
      groupUnreadCounts,
      lastPreviews,
      currentUserDid,
      conversationLocalState,
      messages,
      peerProfiles,
      friendRequests,
    ],
  );

  const handleSearchSelect = async (c: any) => {
    const existingConv = getIMConversations().find(
      (conv) => conv.id === c.id || (c.peerDid && conv.peerDid === c.peerDid),
    );

    if (existingConv) {
      setSearchText('');
      handleSelect(existingConv);
      if (existingConv.hidden) {
        updateConversationLocalState(existingConv.kind, existingConv.id, { hidden: false });
      }
      return;
    }

    if (c.kind === 'friend' && c.peerDid) {
      try {
        await imServiceV1.messaging.createDirect(c.peerDid);
        await loadSessions();
        const created = getIMConversations().find((conv) => conv.peerDid === c.peerDid);
        if (created) {
          setSearchText('');
          handleSelect(created);
        }
      } catch (error) {
        presentError(error, {
          mapper: mapChatError,
          context: { operation: 'conversationAction' },
        });
      }
    }
  };

  const searchResults = useMemo(() => {
    if (!searchText.trim()) return [];
    const q = searchText.toLowerCase();

    const fromConversations = getIMConversations().filter((c) => c.title.toLowerCase().includes(q));

    const existingPeerIds = new Set(fromConversations.map((c) => c.peerDid).filter(Boolean));
    const myId = currentUserDid || '';
    const fromContacts: IMConversationProjection[] = friendRequests
      .filter((r) => r.status === 2)
      .map((r) => {
        const isSender = r.senderId === myId;
        const peerId = isSender ? r.receiverId : r.senderId;
        const peerName = isSender ? r.receiverDisplayName : r.senderDisplayName;
        const peerAvatar = isSender ? r.receiverAvatar : r.senderAvatar;
        return { peerId, peerName, peerAvatar };
      })
      .filter(({ peerId, peerName }) =>
        !existingPeerIds.has(peerId) && peerName.toLowerCase().includes(q),
      )
      .map(({ peerId, peerName, peerAvatar }) => ({
        id: peerId,
        kind: 'friend' as const,
        title: peerName,
        avatar: peerAvatar || '',
        peerDid: peerId,
        lastActivityMs: 0,
        unread: 0,
        visibleUnread: 0,
        hidden: false,
        muted: false,
        alertEnabled: true,
        syncStatus: 'live' as const,
        preview: undefined,
      }));

    return [...fromConversations, ...fromContacts];
  }, [searchText, getIMConversations, conversations, peerProfiles, friendRequests, currentUserDid]);

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
      label: <span data-chat-create-group-menu>{t('chat.social.sessionList.createGroup')}</span>,
      onClick: () => setShowCreateGroup(true),
    },
  ];

  const handleSelect = (c: IMConversationProjection) => {
    clearChatUnread(c.id);
    if (c.kind === 'friend') {
      selectSession(c.id);
    } else {
      selectGroup(c.id);
    }
  };

  const buildContextMenu = useCallback((c: IMConversationProjection) => {
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
            hideConversation(c.kind, c.id, true);
            break;
        }
      },
    };
  }, [conversationLocalState, t, updateConversationLocalState, hideConversation]);

  const isRowActive = (c: IMConversationProjection) => {
    if (c.kind === 'friend') {
      return activeTab === 'friend' && c.id === activeSessionUlid;
    }
    return activeTab === 'group' && c.id === activeGroupUlid;
  };

  const handleRetry = useCallback(() => {
    loadSessions();
    loadGroups();
  }, [loadSessions, loadGroups]);

  return (
    <>
      <Flexbox
        gap={0}
        style={{
          width: 280,
          minWidth: 280,
          flexShrink: 0,
          height: '100%',
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          position: 'relative',
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
                data-chat-new-menu
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

        {loadError && (
          <div style={{ padding: '8px 12px 0', overflow: 'hidden' }}>
            <Alert
              type="error"
              showIcon
              message={t('chat.social.sessionList.loadFailed')}
              action={
                <Button size="small" type="text" icon={<RefreshCw size={12} />} onClick={handleRetry}>
                  {t('common.action.retry', { ns: 'common' })}
                </Button>
              }
              style={{ fontSize: 12 }}
            />
          </div>
        )}

        <Flexbox flex={1} style={{ overflow: 'auto', padding: '8px 8px' }} gap={2}>
          {visibleConversations.length === 0 ? (
            <Flexbox align="center" justify="center" flex={1}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('chat.social.sessionList.noConversations')}
              />
            </Flexbox>
          ) : (
            visibleConversations.map((c) => {
              const isActive = isRowActive(c);
              const name = c.title || t('chat.social.sessionList.unknown');
              const timeStr = relativeTime(new Date(c.lastActivityMs), t);
              const unread = c.visibleUnread;
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
                if (c.kind === 'group' && p.senderId) {
                  const profile = peerProfiles[p.senderId];
                  const senderShort = p.senderId === currentUserDid
                    ? t('chat.social.preview.you')
                    : profile?.display_name?.trim() || profile?.username?.trim() || p.senderId.slice(0, 8) + '…';
                  subtitle = `${senderShort}: ${text}`;
                } else {
                  subtitle = text;
                }
              }

              const contextMenuTarget = `context-menu:chat:${c.kind}:${c.id}`;

              return (
                <Dropdown
                  key={`${c.kind}-${c.id}`}
                  menu={buildContextMenu(c)}
                  trigger={['contextMenu']}
                  onOpenChange={(open) => {
                    markOverlayVisible(contextMenuTarget, open, {
                      conversationId: c.id,
                      conversationKind: c.kind,
                      surface: 'chat-conversation-context-menu',
                    });
                  }}
                >
                  <Flexbox
                    horizontal
                    align="center"
                    gap={10}
                    data-pt-conversation-item={c.id}
                    data-chat-conversation-kind={c.kind}
                    data-chat-session-ulid={c.kind === 'friend' ? c.id : undefined}
                    data-chat-group-ulid={c.kind === 'group' ? c.id : undefined}
                    data-testid={`pt-context-menu-trigger-chat-${c.kind}-${c.id}`}
                    data-pt-context-menu-trigger="chat-conversation"
                    data-pt-context-menu-kind={c.kind}
                    data-pt-context-menu-id={c.id}
                    onContextMenuCapture={() => {
                      markOverlayIntent(contextMenuTarget, {
                        conversationId: c.id,
                        conversationKind: c.kind,
                        surface: 'chat-conversation-context-menu',
                      });
                    }}
                    onClick={() => handleSelect(c)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: isActive ? token.colorPrimaryBg : 'transparent',
                      transition: 'background 0.15s',
                    }}
                  >
                    <OverlayCommitProfiler owner={contextMenuTarget} surface="chat-conversation-context-menu">
                      <>
                          {c.kind === 'group' ? (
                            <GroupSquareAvatar
                              remoteUrl={c.avatar || undefined}
                              members={(groupMembers[c.id] || []).slice(0, 4).map((m) => {
                                const p = peerProfiles[m.ptid];
                                return { name: p?.display_name?.trim() || p?.username?.trim() || m.nickname || '', avatar: p?.avatar || '' };
                              })}
                              name={name}
                              size={36}
                            />
                          ) : (
                            <UserSquareAvatar remoteUrl={c.avatar} name={name} size={36} />
                          )}

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
                                <span data-chat-session-unread={unread}>
                                  <Badge count={unread} size="small" style={{ marginLeft: 8 }} />
                                </span>
                              )}
                          </Flexbox>
                          </Flexbox>
                      </>
                    </OverlayCommitProfiler>
                  </Flexbox>
                </Dropdown>
              );
            })
          )}
        </Flexbox>

        <ChatSearchDropdown
          searchText={searchText}
          results={searchResults}
          onSelect={handleSearchSelect}
        />
      </Flexbox>

      <CreateGroupModal open={showCreateGroup} onClose={() => setShowCreateGroup(false)} />
      <FindPeopleModal open={showFindPeople} onClose={() => setShowFindPeople(false)} />
    </>
  );
}
