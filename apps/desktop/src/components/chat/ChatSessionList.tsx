import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Dropdown, Input } from '@lobehub/ui';
import { Badge, Empty, theme, Typography } from 'antd';
import {
  BellOff,
  CheckCheck,
  CircleAlert,
  EyeOff,
  Pin,
  Plus,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  UsersRound,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { GroupSquareAvatar } from '../common/GroupSquareAvatar';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { presentError } from '../../services/errorPresenter';
import { markOverlayIntent, markOverlayVisible } from '../../kernel/frontendRuntimeProfiler';
import { OverlayCommitProfiler } from '../../kernel/OverlayCommitProfiler';
import { useNavigationBadgeStore } from '../../store/navigationBadges';
import {
  projectGroupAvatarSlots,
  resolveActorIdentity,
} from '../../store/socialProfileProjection';
import {
  projectChatFriendContacts,
  type ChatActorIdentityProjection,
} from '../../store/friendshipProjection';
import type { DesktopIMConversationProjection } from '../../store/socialProjection';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
} from './useActiveSocialChatStore';
import { ChatSearchDropdown } from './ChatSearchDropdown';
import {
  CHAT_SESSION_ROW_HEIGHT,
  CHAT_SESSION_UNREAD_LANE_WIDTH,
} from './chatGeometry';
import type { FriendContactSelection } from './contactSelection';
import { CreateGroupModal } from './CreateGroupModal';
import { FindPeopleModal } from './FindPeopleModal';

const { Text } = Typography;

// #region debug-point A-C:cross-station-direct-open
function reportDirectOpenDebug(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('pt:direct-open-debug', { detail }));
}
// #endregion

function ConversationListError({
  compact = false,
  onRetry,
}: {
  compact?: boolean;
  onRetry: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation(['chat', 'common']);

  return (
    <Flexbox
      data-chat-session-list-error
      data-chat-session-list-error-mode={compact ? 'stale' : 'blocking'}
      role="alert"
      align="center"
      justify="center"
      gap={8}
      style={{
        boxSizing: 'border-box',
        minWidth: 0,
        width: '100%',
        padding: compact ? '12px' : '24px 16px',
        background: compact ? token.colorErrorBg : 'transparent',
        borderBottom: compact ? `1px solid ${token.colorErrorBorder}` : undefined,
        textAlign: 'center',
      }}
    >
      <CircleAlert size={compact ? 16 : 24} color={token.colorError} aria-hidden />
      <Text
        strong
        style={{
          display: 'block',
          minWidth: 0,
          maxWidth: '100%',
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: 'normal',
          overflowWrap: 'break-word',
          wordBreak: 'normal',
        }}
      >
        {t('chat.social.sessionList.loadFailed')}
      </Text>
      <Button
        data-chat-session-list-retry
        size="small"
        icon={<RefreshCw size={12} />}
        onClick={onRetry}
      >
        {t('common.action.retry', { ns: 'common' })}
      </Button>
    </Flexbox>
  );
}

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

function conversationWithActorIdentity(
  conversation: DesktopIMConversationProjection,
  identity: ChatActorIdentityProjection,
): DesktopIMConversationProjection {
  return {
    ...conversation,
    title: identity.displayName,
    avatar: identity.avatarUrl,
    username: identity.username,
    federatedHandle: identity.federatedHandle,
    homeStationDomain: identity.homeStationDomain,
    homeStationPeerId: identity.homeStationPeerId,
    homeStationName: identity.homeStationName,
    federationId: identity.federationId,
    federationName: identity.federationName,
  };
}

interface ChatSessionListProps {
  onConversationSelected: () => void;
  onOpenDirect: (contact: FriendContactSelection) => void;
}

export function ChatSessionList({
  onConversationSelected,
  onOpenDirect,
}: ChatSessionListProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation(['chat', 'common']);
  const {
    sessions,
    groups,
    conversations,
    groupMembers,
    groupUnreadCounts,
    lastPreviews,
    currentUserPtid,
    currentUserProfile,
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
    markFriendRead,
    markGroupRead,
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
    currentUserPtid: state.currentUserPtid,
    currentUserProfile: state.currentUserProfile,
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
    markFriendRead: state.markFriendRead,
    markGroupRead: state.markGroupRead,
    hideConversation: state.hideConversation,
    loadSessions: state.loadSessions,
    loadGroups: state.loadGroups,
  }));
  const { actorStationEntries, federations } = useActiveChatFederationSlice((state) => ({
    actorStationEntries: state.actorStationEntries,
    federations: state.federations,
  }));

  const [searchText, setSearchText] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showFindPeople, setShowFindPeople] = useState(false);
  const clearChatUnread = useNavigationBadgeStore((state) => state.clearChatUnread);
  const stationNamesByPeerId = useMemo(() => Object.fromEntries(
    Object.values(actorStationEntries)
      .map((entry) => [entry.homeStationPeerId.trim(), entry.homeStationName.trim()])
      .filter(([peerId, name]) => Boolean(peerId && name)),
  ), [actorStationEntries]);
  const stationNamesByActorPtid = useMemo(() => Object.fromEntries(
    Object.values(actorStationEntries)
      .map((entry) => [entry.actorPtid.trim(), entry.homeStationName.trim()])
      .filter(([actorPtid, name]) => Boolean(actorPtid && name)),
  ), [actorStationEntries]);

  // NOTE: Initial data loading (sessions, groups, previews) is owned by
  // `SocialChatPage`'s `tick()` effect — see comment there. We deliberately
  // do NOT re-fire those calls here, otherwise the cold path runs every
  // fetch twice in parallel and the spinner blocks longer than necessary.

  const conversationProjection = useMemo(
    () => getIMConversations(),
    [
      getIMConversations,
      conversations,
      sessions,
      groups,
      groupUnreadCounts,
      lastPreviews,
      currentUserPtid,
      conversationLocalState,
      messages,
      peerProfiles,
      friendRequests,
    ],
  );
  const friendIdentities = useMemo(
    () => projectChatFriendContacts({
      conversations: conversationProjection,
      friendRequests,
      peerProfiles,
      currentUserPtid: currentUserPtid || '',
      federations,
      stationNamesByPeerId,
      stationNamesByActorPtid,
    }),
    [
      conversationProjection,
      federations,
      friendRequests,
      currentUserPtid,
      peerProfiles,
      stationNamesByActorPtid,
      stationNamesByPeerId,
    ],
  );
  const friendIdentitiesByPtid = useMemo(
    () => new Map(friendIdentities.map((identity) => [
      identity.actorPtid,
      identity,
    ])),
    [friendIdentities],
  );
  const visibleConversations = useMemo(
    () => conversationProjection
      .filter((conversation) => !conversation.hidden)
      .map((conversation) => {
        if (conversation.kind !== 'friend' || !conversation.peerPtid) {
          return conversation;
        }
        const identity = friendIdentitiesByPtid.get(conversation.peerPtid);
        const projected = identity
          ? conversationWithActorIdentity(conversation, identity)
          : conversation;
        return projected;
      }),
    [conversationProjection, friendIdentitiesByPtid],
  );

  const handleSearchSelect = async (c: DesktopIMConversationProjection) => {
    reportDirectOpenDebug({
      kind: 'handler-entry',
      candidateId: c.id,
      candidateKind: c.kind,
      peerPtid: c.peerPtid || '',
    });
    const existingConv = getIMConversations().find(
      (conv) => conv.id === c.id || (c.peerPtid && conv.peerPtid === c.peerPtid),
    );
    reportDirectOpenDebug({
      kind: 'branch-resolved',
      existingConversationId: existingConv?.id || '',
    });

    if (existingConv) {
      reportDirectOpenDebug({
        kind: 'existing-conversation-selected',
        conversationId: existingConv.id,
      });
      setSearchText('');
      handleSelect(existingConv);
      if (existingConv.hidden) {
        updateConversationLocalState(existingConv.kind, existingConv.id, { hidden: false });
      }
      return;
    }

    if (c.kind === 'friend' && c.peerPtid) {
      setSearchText('');
      onOpenDirect({
        kind: 'friend',
        peerPtid: c.peerPtid,
        federationId: c.federationId || '',
        federationName: c.federationName || '',
        displayName: c.title,
        avatar: c.avatar,
        username: c.username || '',
        federatedHandle: c.federatedHandle || '',
        homeStationDomain: c.homeStationDomain || '',
        homeStationPeerId: c.homeStationPeerId || '',
      });
    }
  };

  const searchResults = useMemo(() => {
    if (!searchText.trim()) return [];
    const q = searchText.toLowerCase();

    const fromConversations = visibleConversations.filter((conversation) => (
      conversation.title.toLowerCase().includes(q)
      || conversation.federatedHandle?.toLowerCase().includes(q)
      || conversation.homeStationDomain?.toLowerCase().includes(q)
      || conversation.federationName?.toLowerCase().includes(q)
    ));

    const existingPeerIds = new Set(fromConversations.map((c) => c.peerPtid).filter(Boolean));
    const fromContacts: DesktopIMConversationProjection[] = friendIdentities
      .filter((identity) => (
        !existingPeerIds.has(identity.actorPtid)
        && [
          identity.displayName,
          identity.username,
          identity.federatedHandle,
          identity.homeStationDomain,
          identity.federationName,
        ].some((value) => value.toLowerCase().includes(q))
      ))
      .map((identity) => ({
        id: identity.actorPtid,
        kind: 'friend' as const,
        title: identity.displayName,
        avatar: identity.avatarUrl,
        peerPtid: identity.actorPtid,
        username: identity.username,
        federatedHandle: identity.federatedHandle,
        homeStationDomain: identity.homeStationDomain,
        homeStationPeerId: identity.homeStationPeerId,
        federationId: identity.federationId,
        federationName: identity.federationName,
        lastActivityMs: 0,
        unread: 0,
        visibleUnread: 0,
        authorityStationId: '',
        hidden: false,
        muted: false,
        alertEnabled: true,
        syncStatus: 'live' as const,
        preview: undefined,
      }));

    return [...fromConversations, ...fromContacts];
  }, [friendIdentities, searchText, visibleConversations]);

  const plusMenuItems = [
    {
      key: 'find-people',
      icon: <UserPlus size={14} />,
      label: <span data-chat-find-people-menu>{t('chat.social.sessionList.findPeople')}</span>,
      onClick: () => setShowFindPeople(true),
    },
    {
      key: 'create-group',
      icon: <UsersRound size={14} />,
      label: <span data-chat-create-group-menu>{t('chat.social.sessionList.createGroup')}</span>,
      onClick: () => setShowCreateGroup(true),
    },
  ];

  const handleSelect = (c: DesktopIMConversationProjection) => {
    onConversationSelected();
    clearChatUnread(c.id);
    if (c.kind === 'friend') {
      selectSession(c.id);
    } else {
      selectGroup(c.id);
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
            try {
              await (c.kind === 'friend' ? markFriendRead(c.id) : markGroupRead(c.id));
            } catch (error) {
              presentError(error, {
                mapper: mapChatError,
                context: { operation: 'conversationAction' },
              });
            }
            break;
          case 'hide':
            hideConversation(c.kind, c.id);
            break;
        }
      },
    };
  }, [
    conversationLocalState,
    hideConversation,
    markFriendRead,
    markGroupRead,
    t,
    updateConversationLocalState,
  ]);

  const isRowActive = (c: DesktopIMConversationProjection) => {
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
          width: 'clamp(180px, 28vw, 280px)',
          minWidth: 180,
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
              data-chat-session-search
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

        {loadError && visibleConversations.length > 0 && (
          <ConversationListError compact onRetry={handleRetry} />
        )}

        <Flexbox flex={1} style={{ overflow: 'auto', padding: '8px 8px' }} gap={2}>
          {loadError && visibleConversations.length === 0 ? (
            <ConversationListError onRetry={handleRetry} />
          ) : visibleConversations.length === 0 ? (
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
              const identityMetadata = c.kind === 'friend'
                ? [
                    c.homeStationName || c.homeStationDomain,
                    c.federationName,
                  ].filter(Boolean).join(' · ')
                : '';

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
                if (c.kind === 'group' && p.senderPtid) {
                  const profile = peerProfiles[p.senderPtid];
                  const senderShort = p.senderPtid === currentUserPtid
                    ? t('chat.social.preview.you')
                    : profile?.display_name?.trim() || profile?.username?.trim() || p.senderPtid.slice(0, 8) + '…';
                  subtitle = `${senderShort}: ${text}`;
                } else {
                  subtitle = text;
                }
              }
              if (identityMetadata) {
                subtitle = [identityMetadata, subtitle].filter(Boolean).join(' · ');
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
                    data-chat-conversation-preview={c.preview?.content ?? ''}
                    data-chat-conversation-latest-at={c.lastActivityMs}
                    data-chat-conversation-unread={unread}
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
                      boxSizing: 'border-box',
                      height: CHAT_SESSION_ROW_HEIGHT,
                      minHeight: CHAT_SESSION_ROW_HEIGHT,
                      overflow: 'hidden',
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
                              members={projectGroupAvatarSlots(
                                groupMembers[c.id] || [],
                                (ptid, nickname) => resolveActorIdentity({
                                  ptid,
                                  currentUserPtid,
                                  currentUserProfile,
                                  peerProfiles,
                                  sessions,
                                  nickname,
                                }),
                              )}
                              name={name}
                              size={36}
                            />
                          ) : (
                            <span
                              data-chat-avatar-ptid={c.peerPtid || ''}
                              data-chat-avatar-src={c.avatar || ''}
                              data-chat-identity-federated-handle={c.federatedHandle || ''}
                              data-chat-identity-home-station-domain={c.homeStationDomain || ''}
                              data-chat-identity-home-station-peer-id={c.homeStationPeerId || ''}
                              data-chat-identity-federation-id={c.federationId || ''}
                              style={{ display: 'inline-flex', flexShrink: 0 }}
                            >
                              <UserSquareAvatar remoteUrl={c.avatar} name={name} size={36} />
                            </span>
                          )}

                          <Flexbox flex={1} justify="center" style={{ minWidth: 0, height: '100%' }}>
                            <Flexbox horizontal align="center" justify="space-between" gap={6} style={{ height: 20 }}>
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
                            <Flexbox horizontal align="center" style={{ height: 20, minWidth: 0 }}>
                              <Text type="secondary" ellipsis style={{ fontSize: 12, lineHeight: '20px', flex: 1, minWidth: 0 }}>
                                {subtitle}
                              </Text>
                              <span
                                data-chat-session-unread={unread}
                                data-chat-session-unread-lane
                                aria-hidden={unread <= 0}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'flex-end',
                                  width: CHAT_SESSION_UNREAD_LANE_WIDTH,
                                  minWidth: CHAT_SESSION_UNREAD_LANE_WIDTH,
                                  height: 20,
                                  marginLeft: 8,
                                  overflow: 'hidden',
                                  visibility: unread > 0 ? 'visible' : 'hidden',
                                }}
                              >
                                <Badge count={unread} overflowCount={99} size="small" />
                              </span>
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
          onDismiss={() => setSearchText('')}
        />
      </Flexbox>

      <CreateGroupModal open={showCreateGroup} onClose={() => setShowCreateGroup(false)} />
      <FindPeopleModal open={showFindPeople} onClose={() => setShowFindPeople(false)} />
    </>
  );
}
