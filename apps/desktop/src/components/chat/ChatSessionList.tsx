import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, ContextMenu, Empty, Icon, IconButton, Menu, TextField } from '@peers-touch/ui';
import type { MenuAction } from '@peers-touch/ui';
import { GroupSquareAvatar } from '../common/GroupSquareAvatar';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { presentError } from '../../services/errorPresenter';
import { markOverlayIntent, markOverlayVisible } from '../../kernel/frontendRuntimeProfiler';
import { OverlayCommitProfiler } from '../../kernel/OverlayCommitProfiler';
import { useNavigationBadgeStore } from '../../store/navigationBadges';
import {
  actorDisplayName,
  projectGroupAvatarSlots,
  resolveActorIdentity,
} from '../../store/socialProfileProjection';
import {
  projectChatFriendContacts,
  type ChatActorIdentityProjection,
} from '../../store/friendshipProjection';
import {
  directConversationDisplayName,
  type DesktopIMConversationProjection,
} from '../../store/socialProjection';
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
  onRetry: () => Promise<void>;
}) {
  const { t } = useTranslation(['chat', 'common']);
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={`sc-list-error${compact ? '' : ' sc-list-error--block'}`}
      data-chat-session-list-error
      data-chat-session-list-error-mode={compact ? 'stale' : 'blocking'}
      role={compact ? 'status' : 'alert'}
      aria-busy={retrying}
    >
      <span className="sc-list-error__glyph" style={{ color: compact ? 'var(--pt-warning)' : 'var(--pt-danger)' }}>
        <Icon iconId="warning" size={compact ? 14 : 24} />
      </span>
      <span className="sc-list-error__text">
        {retrying
          ? t('common.state.loading', { ns: 'common' })
          : t(compact
            ? 'chat.social.sessionList.refreshFailed'
            : 'chat.social.sessionList.loadFailed')}
      </span>
      <Button
        actionId="chat.session-list.retry"
        data-chat-session-list-retry
        emphasis={compact ? 'quiet' : 'secondary'}
        density="compact"
        execution={retrying ? 'pending' : 'idle'}
        availability={retrying ? { kind: 'disabled', reason: '' } : undefined}
        leading={<Icon iconId="refresh-cw" size={12} />}
        onActivate={handleRetry}
      >
        {t('common.action.retry', { ns: 'common' })}
      </Button>
    </div>
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
        displayName: directConversationDisplayName(
          c,
          t('chat.social.contacts.savedMessages'),
          t('chat.social.sessionList.unknown'),
        ),
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

    const selfLabel = t('chat.social.contacts.savedMessages').toLowerCase();
    const fromConversations = visibleConversations.filter((conversation) => (
      conversation.title.toLowerCase().includes(q)
      || (conversation.selfDirect === true && selfLabel.includes(q))
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
  }, [friendIdentities, searchText, visibleConversations, t]);

  const plusMenuItems: MenuAction[] = [
    {
      id: 'find-people',
      iconId: 'user-plus',
      label: t('chat.social.sessionList.findPeople'),
      onActivate: () => setShowFindPeople(true),
    },
    {
      id: 'create-group',
      iconId: 'users-round',
      label: t('chat.social.sessionList.createGroup'),
      onActivate: () => setShowCreateGroup(true),
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

  const buildContextActions = useCallback((c: DesktopIMConversationProjection): MenuAction[] => {
    const localState = conversationLocalState[`${c.kind}:${c.id}`];
    const isPinned = Boolean(localState?.sticky);
    const isMuted = Boolean(localState?.muted);

    const applyLocal = async (patch: { sticky?: boolean; muted?: boolean }) => {
      try {
        await updateConversationLocalState(c.kind, c.id, patch);
      } catch (error) {
        presentError(error, {
          mapper: mapChatError,
          context: { operation: 'conversationAction' },
        });
      }
    };

    const actions: MenuAction[] = [
      {
        id: 'pin',
        iconId: 'pin',
        label: isPinned ? t('chat.social.contextMenu.unpin') : t('chat.social.contextMenu.pin'),
        onActivate: () => void applyLocal({ sticky: !isPinned }),
      },
      {
        id: 'mute',
        iconId: isMuted ? 'volume-2' : 'volume-x',
        label: isMuted ? t('chat.social.contextMenu.unmute') : t('chat.social.contextMenu.mute'),
        onActivate: () => void applyLocal({ muted: !isMuted }),
      },
    ];
    if (c.unread > 0) {
      actions.push({
        id: 'markRead',
        iconId: 'check-check',
        label: t('chat.social.contextMenu.markRead'),
        onActivate: () => {
          (c.kind === 'friend' ? markFriendRead(c.id) : markGroupRead(c.id))
            .catch((error) => presentError(error, {
              mapper: mapChatError,
              context: { operation: 'conversationAction' },
            }));
        },
      });
    }
    actions.push({
      id: 'hide',
      iconId: 'eye-off',
      label: t('chat.social.contextMenu.hide'),
      onActivate: () => hideConversation(c.kind, c.id),
    });
    return actions;
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

  const handleRetry = useCallback(async () => {
    try {
      await loadSessions();
    } catch {
      // The store records and logs the failure; loadError keeps retry available.
    }
  }, [loadSessions]);

  return (
    <>
      <div className="sc-sessions" data-chat-conversation-pane>
        <div className="sc-sessions__toolbar">
          <TextField
            className="sc-sessions__search"
            data-chat-session-search
            density="compact"
            leading={<Icon iconId="search" size={14} className="sc-sessions__search-glyph" />}
            placeholder={t('chat.social.sessionList.searchPlaceholder')}
            value={searchText}
            onValueChange={setSearchText}
            clearable
            onClear={() => setSearchText('')}
          />
          <Menu actions={plusMenuItems} placement="bottom">
            <IconButton
              actionId="chat.new-menu"
              className="sc-sessions__new"
              data-chat-new-menu
              iconId="plus"
              iconSize={16}
              label={t('chat.social.sessionList.newMenu')}
            />
          </Menu>
        </div>

        {loadError && visibleConversations.length > 0 && (
          <ConversationListError compact onRetry={handleRetry} />
        )}

        <div className="sc-sessions__scroll">
          {loadError && visibleConversations.length === 0 ? (
            <ConversationListError onRetry={handleRetry} />
          ) : visibleConversations.length === 0 ? (
            <div className="sc-sessions__empty">
              <Empty description={t('chat.social.sessionList.noConversations')} />
            </div>
          ) : (
            visibleConversations.map((c) => {
              const isActive = isRowActive(c);
              const name = directConversationDisplayName(
                c,
                t('chat.social.contacts.savedMessages'),
                t('chat.social.sessionList.unknown'),
              );
              const timeStr = relativeTime(new Date(c.lastActivityMs), t);
              const unread = c.visibleUnread;
              const localState = conversationLocalState[`${c.kind}:${c.id}`];

              // The conversation row subtitle is always the latest message.
              // Station/identity metadata never falls back here: human station
              // names live on the contact profile, while raw endpoints (IP/domain)
              // must never be exposed as a conversation description.
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
                  const member = groupMembers[c.id]?.find(
                    (item) => item.ptid === p.senderPtid,
                  );
                  const sender = resolveActorIdentity({
                    ptid: p.senderPtid,
                    currentUserPtid,
                    currentUserProfile,
                    peerProfiles,
                    sessions,
                    nickname: member?.nickname,
                  });
                  const senderShort = p.senderPtid === currentUserPtid
                    ? t('chat.social.preview.you')
                    : actorDisplayName(sender.displayName, t('chat.social.detail.unknownMember'));
                  subtitle = `${senderShort}: ${text}`;
                } else {
                  subtitle = text;
                }
              }

              const contextMenuTarget = `context-menu:chat:${c.kind}:${c.id}`;

              return (
                <ContextMenu
                  key={`${c.kind}-${c.id}`}
                  actions={buildContextActions(c)}
                  label={t('chat.social.contextMenu.title')}
                  onOpenChange={(open) => {
                    markOverlayVisible(contextMenuTarget, open, {
                      conversationId: c.id,
                      conversationKind: c.kind,
                      surface: 'chat-conversation-context-menu',
                    });
                  }}
                >
                  <div
                    className={`sc-session-row${isActive ? ' is-active' : ''}`}
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
                    style={{ height: CHAT_SESSION_ROW_HEIGHT, minHeight: CHAT_SESSION_ROW_HEIGHT }}
                  >
                    <OverlayCommitProfiler owner={contextMenuTarget} surface="chat-conversation-context-menu">
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
                          <UserSquareAvatar
                            remoteUrl={c.avatar}
                            actorPtid={c.peerPtid || null}
                            name={name}
                            size={36}
                          />
                        </span>
                      )}

                      <span className="sc-session-row__body">
                        <span className="sc-session-row__line">
                          <span className="sc-session-row__name">
                            {c.kind === 'group' && (
                              <span className="sc-session-row__group-glyph" aria-hidden>
                                <Icon iconId="users" size={12} />
                              </span>
                            )}
                            <span className="sc-session-row__name-text">{name}</span>
                            {localState?.sticky ? (
                              <span className="sc-session-row__pin" aria-label={t('chat.social.detail.stateSticky')}>
                                <Icon iconId="pin" size={11} />
                              </span>
                            ) : null}
                            {localState?.muted || localState?.alertEnabled === false ? (
                              <span className="sc-session-row__muted" aria-label={t('chat.social.detail.stateMuted')}>
                                <Icon iconId="bell-off" size={11} />
                              </span>
                            ) : null}
                          </span>
                          <span className="sc-session-row__time">{timeStr}</span>
                        </span>
                        <span className="sc-session-row__sub">
                          <span className="sc-session-row__preview">{subtitle}</span>
                          <span
                            className="sc-session-row__unread"
                            data-chat-session-unread={unread}
                            data-chat-session-unread-lane
                            style={{ width: CHAT_SESSION_UNREAD_LANE_WIDTH, minWidth: CHAT_SESSION_UNREAD_LANE_WIDTH }}
                            aria-hidden={unread <= 0}
                          >
                            <Badge count={unread} limit={99} />
                          </span>
                        </span>
                      </span>
                    </OverlayCommitProfiler>
                  </div>
                </ContextMenu>
              );
            })
          )}
        </div>

        <ChatSearchDropdown
          searchText={searchText}
          results={searchResults}
          onSelect={handleSearchSelect}
          onDismiss={() => setSearchText('')}
        />
      </div>

      <CreateGroupModal open={showCreateGroup} onClose={() => setShowCreateGroup(false)} />
      <FindPeopleModal open={showFindPeople} onClose={() => setShowFindPeople(false)} />
    </>
  );
}
