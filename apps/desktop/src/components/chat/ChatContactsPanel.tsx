import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert as PtAlert,
  Button,
  ContextMenu,
  Empty as PtEmpty,
  Icon,
  IconButton,
  Spin as PtSpin,
  Tag as PtTag,
  type MenuAction,
  type Tone,
} from '@peers-touch/ui';
import { currentAuthenticatedActorPtid } from '../../store/session';
import {
  projectChatFriendContacts,
  projectChatFriendRequestPeers,
  type ChatActorIdentityProjection,
} from '../../store/friendshipProjection';
import {
  canonicalProfileAvatar,
  remoteProfileHandle,
} from '../../store/socialProfileProjection';
import type { FriendRequestData } from '../../store/socialNormalizers';
import { useDismissedFriendRequestsStore } from '../../store/dismissedFriendRequests';
import { presentError } from '../../services/errorPresenter';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { log } from '../../utils/logger';
import {
  useActiveChatFederationSlice,
  useActiveSocialChatSlice,
} from './useActiveSocialChatStore';
import {
  friendContactSelection,
  personContactSelection,
  type ContactSelection,
} from './contactSelection';
import { ChatActorIdentityRow } from './ChatActorIdentityRow';

const PANEL_WIDTH = 300;

// Section keys mirror the north-star ContactsPane anatomy: self entry first,
// then action-bearing request queues, settled history (collapsed at rest),
// groups and friends.
type ContactSectionKey = 'incoming' | 'outgoing' | 'history' | 'groups' | 'friends';

const SECTION_COLLAPSED_DEFAULT: Record<ContactSectionKey, boolean> = {
  incoming: false,
  outgoing: false,
  history: true,
  groups: false,
  friends: false,
};

interface ChatContactsPanelProps {
  selectedContact: ContactSelection | null;
  onSelectContact: (selection: ContactSelection) => void;
  onStartChat?: (selection: ContactSelection) => void;
  /** Embedded inside the unified chat rail: fills the rail width and rows open
   *  conversations directly (no drill-down detail pane). */
  embedded?: boolean;
  /** Live in-rail search query; when non-empty the pane renders flat matches. */
  query?: string;
}

export function ChatContactsPanel({
  selectedContact,
  onSelectContact,
  onStartChat,
  embedded = false,
  query = '',
}: ChatContactsPanelProps) {
  const { t } = useTranslation('chat');
  const {
    friendRequests,
    friendRequestsLoading,
    friendRequestsLoadedAt,
    friendRequestsError,
    peerProfiles,
    currentUserPtid,
    currentUserProfile,
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
    friendRequestsLoading: s.friendRequestsLoading,
    friendRequestsLoadedAt: s.friendRequestsLoadedAt,
    friendRequestsError: s.friendRequestsError,
    peerProfiles: s.peerProfiles,
    currentUserPtid: s.currentUserPtid,
    currentUserProfile: s.currentUserProfile,
    conversationRecords: s.conversations,
    conversationMembers: s.conversationMembers,
    groupMembers: s.groupMembers,
    getIMConversations: s.getIMConversations,
    selectSession: s.selectSession,
    selectGroup: s.selectGroup,
    acceptFriendRequest: s.acceptFriendRequest,
    rejectFriendRequest: s.rejectFriendRequest,
  }));
  const { federations, actorStationEntries } = useActiveChatFederationSlice((s) => ({
    federations: s.federations,
    actorStationEntries: s.actorStationEntries,
  }));

  const [busyAction, setBusyAction] = useState<{ id: string; kind: 'accept' | 'reject' } | null>(null);
  const [collapsed, setCollapsed] = useState<ContactSectionKey[]>(
    Object.entries(SECTION_COLLAPSED_DEFAULT)
      .filter(([, isCollapsed]) => isCollapsed)
      .map(([key]) => key as ContactSectionKey),
  );
  const toggleSection = (key: ContactSectionKey) => {
    setCollapsed((current) => (current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]));
  };

  const myDid = currentUserPtid || currentAuthenticatedActorPtid() || '';
  const dismissedPeers = useDismissedFriendRequestsStore((state) => state.dismissedPeers);
  const loadDismissedForActor = useDismissedFriendRequestsStore(
    (state) => state.loadForActor,
  );
  const dismissFriendRequestPeer = useDismissedFriendRequestsStore(
    (state) => state.dismissPeer,
  );

  // History dismissal is local-only and actor-scoped; re-hydrate whenever the
  // authenticated actor changes so accounts never share hidden rows.
  useEffect(() => {
    if (myDid) loadDismissedForActor(myDid);
  }, [myDid, loadDismissedForActor]);

  const conversations = useMemo(
    () => {
      // getIMConversations reads the store imperatively. Referencing its
      // projection sources here makes async Conversation loads invalidate
      // this memo without subscribing the panel to the whole social store.
      void conversationRecords;
      void conversationMembers;
      void groupMembers;
      void currentUserPtid;
      void currentUserProfile;
      void friendRequests;
      void peerProfiles;
      return getIMConversations();
    },
    [
      conversationMembers,
      conversationRecords,
      currentUserProfile,
      currentUserPtid,
      friendRequests,
      getIMConversations,
      groupMembers,
      peerProfiles,
    ],
  );
  const groupConversations = conversations.filter((conversation) => conversation.kind === 'group');
  const friendConversations = conversations.filter((conversation) => conversation.kind === 'friend');
  const friendshipReady = Boolean(
    myDid
    && friendRequestsLoadedAt,
  );
  const stationNamesByPeerId = useMemo(() => {
    const candidates = new Map<string, Set<string>>();
    Object.values(actorStationEntries).forEach((entry) => {
      const peerId = entry.homeStationPeerId.trim();
      const name = entry.homeStationName.trim();
      if (!peerId || !name) return;
      const names = candidates.get(peerId) ?? new Set<string>();
      names.add(name);
      candidates.set(peerId, names);
    });
    return Object.fromEntries(
      [...candidates.entries()]
        .filter(([, names]) => names.size === 1)
        .map(([peerId, names]) => [peerId, [...names][0] ?? '']),
    );
  }, [actorStationEntries]);
  const stationNamesByActorPtid = useMemo(
    () => Object.fromEntries(
      Object.entries(actorStationEntries)
        .filter(([, entry]) => entry.homeStationName.trim())
        .map(([actorPtid, entry]) => [
          actorPtid,
          entry.homeStationName.trim(),
        ]),
    ),
    [actorStationEntries],
  );
  const friendContacts = useMemo(
    () => projectChatFriendContacts({
      conversations,
      friendRequests,
      peerProfiles,
      currentUserPtid: myDid,
      federations,
      stationNamesByPeerId,
      stationNamesByActorPtid,
    }),
    [
      conversations,
      federations,
      friendRequests,
      myDid,
      peerProfiles,
      stationNamesByPeerId,
      stationNamesByActorPtid,
    ],
  );
  const friendContactsByPtid = useMemo(
    () => new Map(friendContacts.map((contact) => [contact.actorPtid, contact])),
    [friendContacts],
  );
  const federationNames = useMemo(
    () => new Map(federations.map((federation) => [
      federation.federationId,
      federation.name,
    ])),
    [federations],
  );

  const totalContacts = friendContacts.length;

  const requestPeers = useMemo(
    () => projectChatFriendRequestPeers(friendRequests, myDid),
    [friendRequests, myDid],
  );
  const incomingRequests = useMemo(
    () => requestPeers.filter((peer) => peer.direction === 'incoming' && peer.request.status === 1),
    [requestPeers],
  );
  const outgoingRequests = useMemo(
    () => requestPeers.filter((peer) => peer.direction === 'outgoing' && peer.request.status === 1),
    [requestPeers],
  );
  // Settled (accepted/rejected) requests are an archive, not a todo queue.
  // Locally dismissed peers stay hidden until a new request re-surfaces them.
  const historyRequests = useMemo(
    () => requestPeers.filter(
      (peer) => peer.request.status !== 1 && !dismissedPeers.includes(peer.peerPtid),
    ),
    [requestPeers, dismissedPeers],
  );

  function statusTag(status: number) {
    if (status === 1) {
      return <PtTag tone="info">{t('chat.social.contacts.status.pending')}</PtTag>;
    }
    if (status === 2) {
      return <PtTag tone="success">{t('chat.social.contacts.status.accepted')}</PtTag>;
    }
    if (status === 3) {
      return <PtTag>{t('chat.social.contacts.status.rejected')}</PtTag>;
    }
    return null;
  }

  const selectAcceptedActor = (identity: ChatActorIdentityProjection) => {
    const selection = friendContactSelection(identity, friendConversations);
    if (
      selection.kind === 'friend'
      && selection.conversationId
    ) {
      selectSession(selection.conversationId);
    }
    onSelectContact(selection);
  };

  // Self-direct (Saved Messages) is a one-member Direct with the current
  // actor. The identity feeds the canonical friend-contact selection, so
  // open/create reuse the single openDirectConversation path.
  const selfIdentity = useMemo<ChatActorIdentityProjection>(() => ({
    actorPtid: myDid,
    username: currentUserProfile?.username?.trim() ?? '',
    displayName: t('chat.social.contacts.savedMessages'),
    avatarUrl: currentUserProfile?.avatar ?? '',
    federatedHandle: '',
    homeStationDomain: '',
    homeStationPeerId: '',
    federationId: '',
    federationName: '',
  }), [currentUserProfile, myDid, t]);

  const openSelfConversation = () => {
    if (!myDid || !onStartChat) return;
    onStartChat(friendContactSelection(selfIdentity, friendConversations));
  };

  const runRequestAction = async (
    request: FriendRequestData,
    action: 'accept' | 'reject',
  ) => {
    setBusyAction({ id: request.id, kind: action });
    try {
      if (action === 'accept') {
        await acceptFriendRequest(request);
      } else {
        await rejectFriendRequest(request);
      }
    } catch (error) {
      log.error('contacts', `${action}FriendRequest failed`, error);
      // Unified floating toast; the request row stays interactive.
      presentError(error, {
        fallbackKey: 'error.chat.conversationActionFailed',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const renderRequestCard = (peer: (typeof requestPeers)[number]) => {
    const { request, direction, peerPtid, attemptCount } = peer;
    const peerName = direction === 'outgoing'
      ? request.receiverDisplayName
      : request.senderDisplayName;
    const peerAvatar = direction === 'outgoing'
      ? request.receiverAvatar
      : request.senderAvatar;
    const federationId = request.federationId;
    const cachedProfile = peerProfiles[peerPtid];
    const peerLabel = cachedProfile?.display_name?.trim()
      || cachedProfile?.username?.trim()
      || peerName
      || t('chat.social.sessionList.unknown');
    // Key on the canonical Station media identity, not the rotating
    // projected station-resource token from the peer profile edge.
    const resolvedAvatar = (cachedProfile ? canonicalProfileAvatar(cachedProfile) : '')
      || peerAvatar;
    const federatedHandle = cachedProfile
      ? remoteProfileHandle(cachedProfile)
      : '';
    const homeStationPeerId = direction === 'incoming'
      ? request.senderHomeStationPeerId
      : request.receiverHomeStationPeerId;
    const projectedIdentity = friendContactsByPtid.get(peerPtid) ?? {
      actorPtid: peerPtid,
      username: cachedProfile?.username?.trim() || '',
      displayName: peerLabel,
      avatarUrl: resolvedAvatar,
      federatedHandle,
      homeStationDomain: homeStationDomainFromHandle(federatedHandle),
      homeStationPeerId,
      homeStationName: stationNamesByActorPtid[peerPtid]
        || stationNamesByPeerId[homeStationPeerId]
        || '',
      federationId,
      federationName: federationNames.get(federationId) || '',
    };
    const isPendingIncoming = direction === 'incoming' && request.status === 1;
    const isOutgoing = direction === 'outgoing';
    const isSettled = request.status !== 1;
    const isSelected = Boolean(
      selectedContact
      && selectedContact.kind !== 'group'
      && selectedContact.peerPtid === peerPtid
    );
    const selection = request.status === 2
      ? friendContactSelection(projectedIdentity, friendConversations)
      : personContactSelection(
          projectedIdentity,
          request.status,
          direction,
          attemptCount,
        );
    const selectRequestActor = () => {
      if (embedded && request.status === 2) {
        onStartChat?.(selection);
        return;
      }
      if (
        selection.kind === 'friend'
        && selection.conversationId
      ) {
        selectSession(selection.conversationId);
      }
      onSelectContact(selection);
    };
    const directionTone: Tone = isOutgoing ? 'neutral' : 'info';
    // Settled history rows compress to one line: the repeated-attempt count is
    // secondary metadata and moves into the hover tooltip instead of wrapping
    // into a third tag row that would outgrow the 40px avatar.
    const attemptsLabel = attemptCount > 1
      ? t('chat.social.contacts.requestAttempts', { count: attemptCount })
      : '';
    const cardTitle = isSettled && attemptsLabel
      ? t('chat.social.contacts.historyRowTitle', {
        peer: peerLabel,
        attempts: attemptsLabel,
      })
      : peerLabel;

    const card = (
      <div
        className={[
          'sc-request-card',
          isOutgoing ? 'is-outgoing' : '',
          isSettled ? 'is-history' : '',
          isSelected ? 'is-selected' : '',
        ].filter(Boolean).join(' ')}
        data-chat-friend-request-id={request.id}
        data-chat-friend-request-peer-ptid={peerPtid}
        data-chat-friend-request-direction={direction}
        data-chat-friend-request-status={request.status}
        data-chat-friend-request-attempt-count={attemptCount}
        {...(isSettled ? { 'data-chat-friend-request-history-card': true } : {})}
        title={cardTitle}
        role="button"
        tabIndex={0}
        onClick={selectRequestActor}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          selectRequestActor();
        }}
      >
        <UserSquareAvatar remoteUrl={resolvedAvatar} actorPtid={peerPtid} name={peerLabel} size={40} />
        <div className="sc-request-card__body">
          <div className="sc-request-card__name-row">
            <strong className="sc-request-card__name">{peerLabel}</strong>
            <span className="sc-request-card__tags">
              <PtTag tone={directionTone}>
                {t(`chat.social.contacts.direction.${direction}`)}
              </PtTag>
              {statusTag(request.status)}
              {!isSettled && attemptsLabel ? (
                <PtTag>{attemptsLabel}</PtTag>
              ) : null}
            </span>
            {isPendingIncoming ? (
              <span className="sc-request-card__decide">
                <IconButton
                  actionId={`friend-request-accept-${request.id}`}
                  className="sc-decide is-accept"
                  data-chat-friend-request-action="accept"
                  iconId="check"
                  iconSize={14}
                  density="compact"
                  emphasis="quiet"
                  execution={busyAction?.id === request.id && busyAction?.kind === 'accept' ? 'pending' : 'idle'}
                  label={t('chat.social.contacts.accept')}
                  onActivate={(event) => {
                    event.stopPropagation();
                    void runRequestAction(request, 'accept');
                  }}
                />
                <IconButton
                  actionId={`friend-request-reject-${request.id}`}
                  className="sc-decide is-reject"
                  data-chat-friend-request-action="reject"
                  iconId="close"
                  iconSize={14}
                  density="compact"
                  emphasis="quiet"
                  execution={busyAction?.id === request.id && busyAction?.kind === 'reject' ? 'pending' : 'idle'}
                  label={t('chat.social.contacts.reject')}
                  onActivate={(event) => {
                    event.stopPropagation();
                    void runRequestAction(request, 'reject');
                  }}
                />
              </span>
            ) : null}
          </div>
          {!isSettled && isOutgoing && request.status === 1 ? (
            <span className="sc-request-card__greeting is-sent">
              {t('chat.social.contacts.outgoingPendingHint')}
            </span>
          ) : !isSettled && request.message ? (
            <span className="sc-request-card__greeting">{request.message}</span>
          ) : null}
        </div>
      </div>
    );

    // Only settled archive rows are dismissible; pending queues keep their
    // accept/reject decision actions and cannot be removed from the list.
    if (!isSettled) {
      return card;
    }
    const historyActions: MenuAction[] = [
      {
        id: `friend-request-history-delete-${request.id}`,
        // Registered Peers glyph key; the lucide source name "trash-2" is not
        // a valid IconId and throws inside <Icon> at render time.
        iconId: 'delete',
        label: t('chat.social.contacts.deleteHistory'),
        onActivate: () => dismissFriendRequestPeer(peerPtid),
      },
    ];
    return (
      <ContextMenu
        key={peerPtid}
        actions={historyActions}
        label={t('chat.social.contacts.historyContextMenu')}
      >
        {card}
      </ContextMenu>
    );
  };

  const selfSelected = selectedContact?.kind === 'friend' && selectedContact.peerPtid === myDid;
  const selfRow = !myDid ? null : (
    <Button
      actionId="contact.open-self"
      emphasis="quiet"
      fullWidth
      className={`sc-contact-row${selfSelected ? ' is-selected' : ''}`}
      data-chat-contact-self
      onActivate={openSelfConversation}
    >
      <UserSquareAvatar
        remoteUrl={selfIdentity.avatarUrl}
        actorPtid={myDid}
        name={t('chat.social.contacts.savedMessages')}
        size={38}
      />
      <span className="sc-contact-row__body">
        <strong className="sc-contact-row__name">{t('chat.social.contacts.savedMessages')}</strong>
        <span className="sc-contact-row__meta">{t('chat.social.contacts.savedMessagesHint')}</span>
      </span>
    </Button>
  );

  const renderGroupRow = (conversation: typeof groupConversations[number]) => {
    const isSelected = selectedContact?.kind === 'group'
      && selectedContact.conversationId === conversation.id;
    const displayName = conversation.title || t('chat.social.sessionList.unnamedGroup');
    return (
      <Button
        key={conversation.id}
        actionId={`contact.open-group.${conversation.id}`}
        emphasis="quiet"
        fullWidth
        className={`sc-contact-row${isSelected ? ' is-selected' : ''}`}
        data-chat-contact-ptid={conversation.peerPtid}
        onActivate={() => {
          const groupSelection = {
            kind: 'group' as const,
            conversationId: conversation.id,
            displayName,
            avatar: conversation.avatar,
            memberCount: conversation.memberCount ?? 0,
          };
          if (embedded) {
            onStartChat?.(groupSelection);
            return;
          }
          selectGroup(conversation.id);
          onSelectContact(groupSelection);
        }}
        onDoubleClick={() => {
          onStartChat?.({
            kind: 'group',
            conversationId: conversation.id,
            displayName,
            avatar: conversation.avatar,
            memberCount: conversation.memberCount ?? 0,
          });
        }}
      >
        <UserSquareAvatar
          remoteUrl={conversation.avatar}
          actorPtid={conversation.peerPtid || null}
          name={displayName}
          size={38}
        />
        <span className="sc-contact-row__body">
          <strong className="sc-contact-row__name">{displayName}</strong>
          <span className="sc-contact-row__meta">
            {t('chat.social.detail.membersCount', { count: conversation.memberCount ?? 0 })}
          </span>
        </span>
      </Button>
    );
  };

  const renderFriendRow = (friend: ChatActorIdentityProjection) => {
    const isSelected = selectedContact?.kind === 'friend'
      && selectedContact.peerPtid === friend.actorPtid;
    const selection = friendContactSelection(
      friend,
      friendConversations,
    );
    return (
      <button
        key={friend.actorPtid}
        type="button"
        className={`sc-contact-row${isSelected ? ' is-selected' : ''}`}
        data-chat-contact-ptid={friend.actorPtid}
        data-chat-contact-conversation-id={friend.conversationId ?? ''}
        data-chat-contact-federation-id={friend.federationId}
        data-chat-contact-federated-handle={friend.federatedHandle}
        data-chat-contact-home-station-domain={friend.homeStationDomain}
        data-chat-contact-home-station-peer-id={friend.homeStationPeerId}
        data-chat-contact-home-station-name={friend.homeStationName ?? ''}
        data-chat-contact-avatar-src={friend.avatarUrl}
        onClick={() => {
          if (embedded) {
            onStartChat?.(selection);
            return;
          }
          selectAcceptedActor(friend);
        }}
        onDoubleClick={() => onStartChat?.(selection)}
      >
        <ChatActorIdentityRow
          identity={friend}
          avatarSize={38}
        />
      </button>
    );
  };

  const section = (
    key: ContactSectionKey,
    label: string,
    children: ReactNode,
  ) => (
    <section
      key={key}
      className="sc-contact-section"
      data-contact-section={key}
      data-collapsed={collapsed.includes(key) ? 'true' : 'false'}
    >
      <Button
        actionId={`contacts.section.${key}`}
        className="sc-contact-section__toggle"
        emphasis="quiet"
        density="compact"
        fullWidth
        aria-expanded={!collapsed.includes(key)}
        label={label}
        leading={(
          <Icon
            iconId="chevron-down"
            size={12}
            className="sc-contact-section__chevron"
          />
        )}
        onActivate={() => toggleSection(key)}
      />
      <div className="sc-contact-section__body">{children}</div>
    </section>
  );

  const trimmedQuery = query.trim().toLowerCase();
  const searching = trimmedQuery.length > 0;
  const requestMatches = (peer: (typeof requestPeers)[number]) => {
    const name = peer.direction === 'outgoing'
      ? peer.request.receiverDisplayName
      : peer.request.senderDisplayName;
    return [name, peer.request.message, peer.request.federationId]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(trimmedQuery);
  };
  const groupMatches = (conversation: typeof groupConversations[number]) =>
    conversation.title.toLowerCase().includes(trimmedQuery);
  const friendMatches = (friend: ChatActorIdentityProjection) =>
    [
      friend.displayName,
      friend.username,
      friend.federatedHandle,
      friend.homeStationName,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(trimmedQuery);

  const matchedRequests = searching ? requestPeers.filter(requestMatches) : [];
  const matchedGroups = searching ? groupConversations.filter(groupMatches) : [];
  const matchedFriends = searching ? friendContacts.filter(friendMatches) : [];
  const hasNoMatches = searching
    && matchedRequests.length === 0
    && matchedGroups.length === 0
    && matchedFriends.length === 0;

  return (
    <div
      className="sc-contacts"
      data-chat-contacts
      data-chat-friendship-state={
        friendRequestsError ? 'error' : friendshipReady ? 'ready' : 'loading'
      }
      data-contact-search={searching ? 'true' : 'false'}
      style={embedded
        ? { width: '100%', minWidth: 0 }
        : { width: PANEL_WIDTH, minWidth: PANEL_WIDTH }}
    >
      <div className="sc-contacts__scroll">
        {friendRequestsError ? (
          <PtAlert
            className="sc-contacts__alert"
            tone="danger"
            title={t('chat.social.findPeople.friendshipUnavailable')}
          />
        ) : null}

        {searching ? (
          <div className="sc-contacts__search-results">
            {matchedRequests.map(renderRequestCard)}
            {matchedGroups.map(renderGroupRow)}
            {matchedFriends.map(renderFriendRow)}
            {hasNoMatches ? (
              <PtEmpty className="sc-contacts__empty" description={t('chat.social.contacts.noResults')} />
            ) : null}
          </div>
        ) : (
          <>
            {/* Saved Messages is the fixed self-direct entry, separated by a
                material hairline rather than a collapsible category. */}
            {selfRow ? (
              <div className="sc-contacts__self">{selfRow}</div>
            ) : null}

            {/* Show the spinner only for the very first load. Once data has
                loaded once (friendshipReady), background reconciles must keep
                the list mounted and swap data silently instead of flashing a
                spinner / unmounting the rows. */}
            {!friendshipReady && friendRequestsLoading ? (
              <div className="sc-contacts__status"><PtSpin size="small" /></div>
            ) : (
              <>
                {incomingRequests.length > 0
                  && section(
                    'incoming',
                    t('chat.social.contacts.incomingCount', { count: incomingRequests.length }),
                    <div className="sc-contacts__requests">{incomingRequests.map(renderRequestCard)}</div>,
                  )}
                {outgoingRequests.length > 0
                  && section(
                    'outgoing',
                    t('chat.social.contacts.outgoingCount', { count: outgoingRequests.length }),
                    <div className="sc-contacts__requests">{outgoingRequests.map(renderRequestCard)}</div>,
                  )}
                {historyRequests.length > 0
                  && section(
                    'history',
                    t('chat.social.contacts.historyCount', { count: historyRequests.length }),
                    <div className="sc-contacts__requests">{historyRequests.map(renderRequestCard)}</div>,
                  )}
                {section(
                  'groups',
                  t('chat.social.contacts.savedGroupsCount', { count: groupConversations.length }),
                  groupConversations.length === 0 ? (
                    <PtEmpty className="sc-contacts__empty" description={t('chat.social.contacts.noGroups')} />
                  ) : (
                    <div className="sc-contacts__rows">{groupConversations.map(renderGroupRow)}</div>
                  ),
                )}
                {section(
                  'friends',
                  t('chat.social.contacts.contactsCount', { count: totalContacts }),
                  totalContacts === 0 ? (
                    <PtEmpty className="sc-contacts__empty" description={t('chat.social.contacts.noFriends')} />
                  ) : (
                    <div className="sc-contacts__rows">{friendContacts.map(renderFriendRow)}</div>
                  ),
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function homeStationDomainFromHandle(handle: string): string {
  const value = handle.trim().replace(/^@/, '');
  const separator = value.indexOf('@');
  return separator >= 0 ? value.slice(separator + 1) : '';
}
