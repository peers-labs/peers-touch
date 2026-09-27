/**
 * ContactsPage.tsx — Pure renderer for the contacts tab.
 *
 * W6A contract: this page renders narrow selectors and dispatches typed
 * commands only.  It handles duplicate / no-result / unavailable /
 * role-denied states.  All visible text uses i18n.  Contact and group
 * lists are bounded.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Empty, Input, List, Modal, Radio, Spin, Tag, Typography } from 'antd';
import { ArrowLeft, Ban, Check, ChevronRight, RotateCcw, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import type {
  MobileChatDetailRoute,
  MobileOverlayRoute,
} from '../app/navigation';
import { MobileAvatar } from '../components/MobileAvatar';
import { MobileNotice } from '../components/MobileNotice';
import { BoundedList } from '../components/BoundedList';
import { readRouteQuery, saveRouteQuery } from '../app/navigation/scrollRestoration';
import { useGroupStore } from '../features/group/groupStore';
import { projectGroupConversations, type GroupConversation } from '../features/group/groupProjection';
import { formatSocialError, useSocialStore } from '../features/social/socialStore';
import { projectAcceptedContacts, projectOutgoingRequests, projectPendingInboundRequests, type SocialContact } from '../features/social/socialProjection';
import {
  requestSocialFriendshipStatus,
  requestSocialPeerProfiles,
} from '../features/social/socialRuntime';
import {
  classifyPeopleSearchFeedback,
  friendRequestDecisionFence,
  type FriendRequestDecisionAction,
} from '../features/social/contactInteractionState';
import type { ActorSearchResult } from '../features/social/socialTypes';
import {
  dispatchSendFriendRequest,
  dispatchAcceptFriendRequest,
  dispatchRejectFriendRequest,
  dispatchCreateGroup,
  dispatchOpenContactChat,
} from '../features/social/contactCommands';
import { dispatchBlockUser, dispatchUnblockUser } from '../features/chat/chatCommands';

const { Text } = Typography;
/** Maximum contacts mounted in one traversable window. */
const CONTACT_WINDOW_SIZE = 100;

interface ContactsPageProps {
  readonly activeContactPtid: string | null;
  readonly activeOverlay: MobileOverlayRoute | null;
  readonly onOpenChat: (route: MobileChatDetailRoute) => void;
  readonly onOpenContact: (actorPtid: string) => void;
  readonly onOpenOverlay: (route: MobileOverlayRoute) => void;
  readonly onCloseOverlay: () => void;
  readonly onBack: () => void;
}

export function ContactsPage({
  activeContactPtid,
  activeOverlay,
  onOpenChat,
  onOpenContact,
  onOpenOverlay,
  onCloseOverlay,
  onBack,
}: ContactsPageProps) {
  const { t } = useMobileI18n();

  // --- Local UI state ---
  const [contactQuery, setContactQuery] = useState(() => readRouteQuery('tab:contacts'));
  const [peopleQuery, setPeopleQuery] = useState('');
  const [submittedPeopleQuery, setSubmittedPeopleQuery] = useState('');
  const [selectedFederationId, setSelectedFederationId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedGroupMemberPtids, setSelectedGroupMemberPtids] = useState<string[]>([]);
  const [localActionError, setLocalActionError] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);
  const [directScope, setDirectScope] = useState({ peerPtid: '', federationId: '' });
  const [requestDecisionRevision, setRequestDecisionRevision] = useState(0);
  const activeContactRef = useRef(activeContactPtid);
  const mountedRef = useRef(true);
  activeContactRef.current = activeContactPtid;
  useEffect(() => () => {
    activeContactRef.current = null;
    mountedRef.current = false;
  }, []);

  // --- Narrow store selectors ---
  const authSession = useSocialStore((s) => s.authSession);
  const currentUserPtid = useSocialStore((s) => s.currentUserPtid);
  const friendRequests = useSocialStore((s) => s.friendRequests);
  const loading = useSocialStore((s) => s.loading);
  const error = useSocialStore((s) => s.error);
  const clearSocialError = useSocialStore((s) => s.clearError);
  const selectSession = useSocialStore((s) => s.selectSession);
  const peerProfiles = useSocialStore((s) => s.peerProfiles);
  const peerProfileLoading = useSocialStore((s) => s.peerProfileLoading);
  const peerProfileErrors = useSocialStore((s) => s.peerProfileErrors);
  const friendshipStatus = useSocialStore((s) => s.friendshipStatus);
  const peopleResults = useSocialStore((s) => s.peopleSearchResults);
  const peopleFederations = useSocialStore((s) => s.peopleSearchFederations);
  const peopleFederationsError = useSocialStore((s) => s.peopleSearchFederationsError);
  const peopleSearching = useSocialStore((s) => s.peopleSearchLoading);
  const peopleError = useSocialStore((s) => s.peopleSearchError);
  const searchPeople = useSocialStore((s) => s.searchPeople);
  const clearPeopleSearch = useSocialStore((s) => s.clearPeopleSearch);
  const selectGroup = useGroupStore((s) => s.selectGroup);
  const groupLoading = useGroupStore((s) => s.loading);
  const groupError = useGroupStore((s) => s.error);
  const clearGroupError = useGroupStore((s) => s.clearError);
  const groupCreateOperation = useGroupStore((s) => s.groupCreateOperation);
  const clearGroupCreateOperation = useGroupStore((s) => s.clearGroupCreateOperation);

  // --- Projection data ---
  const peerOnline = useSocialStore((s) => s.peerOnline);
  const groupItems = useGroupStore((s) => s.groups);
  const groupUnreadCounts = useGroupStore((s) => s.unreadCounts);

  const contacts = useMemo(
    () => projectAcceptedContacts(friendRequests, currentUserPtid, peerOnline),
    [currentUserPtid, friendRequests, peerOnline],
  );
  const groups = useMemo(
    () => projectGroupConversations({ groups: groupItems, unreadCounts: groupUnreadCounts }),
    [groupItems, groupUnreadCounts],
  );
  const inboundRequests = useMemo(
    () => projectPendingInboundRequests(friendRequests, currentUserPtid),
    [currentUserPtid, friendRequests],
  );
  const sentRequests = useMemo(
    () => projectOutgoingRequests(friendRequests, currentUserPtid),
    [currentUserPtid, friendRequests],
  );
  const filteredContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((c) => `${c.peerName} ${c.peerPtid}`.toLowerCase().includes(query));
  }, [contactQuery, contacts]);
  const filteredGroups = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((g) => `${g.group.name} ${g.group.ulid} ${g.lastMessage?.content ?? ''}`.toLowerCase().includes(query));
  }, [contactQuery, groups]);
  const pendingTargetPtids = useMemo(
    () => new Set(sentRequests.map((request) => request.receiverPtid)),
    [sentRequests],
  );
  const inboundTargetPtids = useMemo(
    () => new Set(inboundRequests.map((request) => request.senderPtid)),
    [inboundRequests],
  );
  const contactPtids = useMemo(
    () => new Set(contacts.map((c) => c.peerPtid).filter(Boolean)),
    [contacts],
  );
  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.peerPtid === activeContactPtid) ?? null,
    [activeContactPtid, contacts],
  );

  // --- Bounded windowing ---
  const windowedContacts = useMemo(
    () => [...filteredContacts].sort((a, b) => a.peerName.localeCompare(b.peerName)),
    [filteredContacts],
  );
  const windowedGroups = filteredGroups;

  // --- Selected contact profile ---
  const selectedProfile = selectedContact ? peerProfiles[selectedContact.peerPtid] : null;
  const selectedProfileLoading = selectedContact ? Boolean(peerProfileLoading[selectedContact.peerPtid]) : false;
  const selectedProfileError = selectedContact ? peerProfileErrors[selectedContact.peerPtid] : null;
  const selectedBlocked = selectedContact ? Boolean(friendshipStatus[selectedContact.peerPtid]?.blocked) : false;
  const requestFederationId = peopleFederations.some(
    (federation) => federation.federationId === selectedFederationId,
  ) ? selectedFederationId : peopleFederations.length === 1 ? peopleFederations[0].federationId : '';
  const directFederationId = selectedContact?.peerPtid === directScope.peerPtid
    && selectedContact.federationIds.includes(directScope.federationId)
    ? directScope.federationId
    : selectedContact?.federationIds.length === 1 ? selectedContact.federationIds[0] : '';
  const requestDecisionScope = authSession
    ? `${authSession.stationPeerId}\u0000${authSession.actorRef.ptid}`
    : '';
  const requestDecisionStates = useMemo(
    () => friendRequestDecisionFence.snapshot(requestDecisionScope),
    [requestDecisionRevision, requestDecisionScope],
  );
  const peopleSearchFeedback = classifyPeopleSearchFeedback({
    query: submittedPeopleQuery,
    resultCount: peopleResults.length,
    loading: peopleSearching,
    error: peopleError,
  });

  // --- Side effects ---
  useEffect(() => {
    if (activeContactPtid) {
      void requestSocialPeerProfiles([activeContactPtid]);
      void requestSocialFriendshipStatus(activeContactPtid)
        .catch(() => undefined);
    }
  }, [activeContactPtid]);

  useEffect(() => {
    friendRequestDecisionFence.syncAuthoritativeRequests(
      requestDecisionScope,
      new Set(inboundRequests.map((request) => request.requestId)),
    );
    setRequestDecisionRevision((current) => current + 1);
  }, [inboundRequests, requestDecisionScope]);

  useEffect(() => {
    const operation = groupCreateOperation;
    if (
      operation?.phase !== 'pending'
      || !groupItems.some((group) => group.ulid === operation.conversationId)
    ) {
      return;
    }
    clearGroupCreateOperation(operation.conversationId);
    onCloseOverlay();
    onOpenChat({
      routeId: 'detail:group-conversation',
      groupUlid: operation.conversationId,
    });
    void selectSession(null);
    void selectGroup(operation.conversationId);
  }, [
    clearGroupCreateOperation,
    groupCreateOperation,
    groupItems,
    onCloseOverlay,
    onOpenChat,
    selectGroup,
    selectSession,
  ]);

  // --- Command dispatchers ---
  const closeFindPeople = () => {
    onCloseOverlay();
    setPeopleQuery('');
    setSubmittedPeopleQuery('');
    setSelectedFederationId('');
    clearPeopleSearch();
  };

  const runPeopleSearch = async (value: string) => {
    const query = value.trim();
    setSubmittedPeopleQuery(query);
    await searchPeople(query);
  };

  const sendRequestToResult = async (result: ActorSearchResult) => {
    const receiverPtid = result.ptid;
    if (!receiverPtid || !requestFederationId || peopleSearching || sendingRequest) return;
    setLocalActionError('');
    setSendingRequest(true);
    try {
      const command = await dispatchSendFriendRequest(
        receiverPtid,
        result.homeStationPeerId,
        requestFederationId,
        '',
      );
      if (!command.checkpointReady) {
        setLocalActionError(t('mobile.contacts.requestUnconfirmed'));
        return;
      }
      await searchPeople(peopleQuery);
    } catch (err) {
      setLocalActionError(t(err instanceof Error && err.message === 'mobile.contacts.requestUnconfirmed'
        ? err.message : 'mobile.contacts.requestFailed'));
    } finally {
      setSendingRequest(false);
    }
  };

  const runFriendRequestDecision = async (
    requestId: string,
    action: FriendRequestDecisionAction,
  ) => {
    if (!friendRequestDecisionFence.begin(requestDecisionScope, requestId, action)) return;
    setRequestDecisionRevision((current) => current + 1);
    setLocalActionError('');
    try {
      if (action === 'accept') await dispatchAcceptFriendRequest(requestId);
      else await dispatchRejectFriendRequest(requestId);
    } catch (error) {
      const unknown = error instanceof Error
        && error.message === 'mobile.contacts.requestUnconfirmed';
      if (unknown) friendRequestDecisionFence.markUnknown(requestDecisionScope, requestId);
      else friendRequestDecisionFence.release(requestDecisionScope, requestId);
      if (mountedRef.current) {
        setRequestDecisionRevision((current) => current + 1);
        setLocalActionError(t(unknown
          ? 'mobile.contacts.requestUnconfirmed'
          : 'mobile.contacts.requestFailed'));
      }
    }
  };

  const handleAcceptRequest = (requestId: string) =>
    runFriendRequestDecision(requestId, 'accept');

  const handleRejectRequest = async (requestId: string) => {
    await runFriendRequestDecision(requestId, 'reject');
  };

  const openContactChat = async (contact: SocialContact) => {
    if (openingChat || !directFederationId) return;
    setOpeningChat(true);
    setLocalActionError('');
    try {
      const sessionUlid = await dispatchOpenContactChat(contact.peerPtid, directFederationId);
      if (activeContactRef.current !== contact.peerPtid) return;
      onOpenChat({ routeId: 'detail:chat-conversation', sessionUlid });
      void selectGroup(null);
      void selectSession(sessionUlid);
    } catch (error) {
      setLocalActionError(t(error instanceof Error && error.message === 'mobile.contacts.conversationPreparing'
        ? error.message : 'mobile.contacts.openChatFailed'));
    } finally {
      setOpeningChat(false);
    }
  };

  const openGroupChat = (group: GroupConversation) => {
    onOpenChat({
      routeId: 'detail:group-conversation',
      groupUlid: group.group.ulid,
    });
    void selectSession(null);
    void selectGroup(group.group.ulid);
  };

  const confirmBlockSelectedContact = () => {
    if (!selectedContact) return;
    Modal.confirm({
      title: t('mobile.contacts.blockConfirmTitle'), content: t('mobile.contacts.blockConfirmBody'),
      okText: t('mobile.contacts.block'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
      onOk: async () => {
        await dispatchBlockUser(selectedContact.peerPtid);
        onBack();
      },
    });
  };

  const confirmUnblockSelectedContact = () => {
    if (!selectedContact) return;
    Modal.confirm({
      title: t('mobile.contacts.unblockConfirmTitle'), content: t('mobile.contacts.unblockConfirmBody'),
      okText: t('mobile.contacts.unblock'), cancelText: t('common.action.cancel'),
      onOk: async () => { await dispatchUnblockUser(selectedContact.peerPtid); },
    });
  };

  const closeCreateGroup = () => {
    onCloseOverlay();
    setGroupName('');
    setGroupDescription('');
    setSelectedGroupMemberPtids([]);
  };

  const toggleInitialGroupMember = (ptid: string, checked: boolean) => {
    setSelectedGroupMemberPtids((current) => checked ? [...new Set([...current, ptid])] : current.filter((i) => i !== ptid));
  };

  const submitCreateGroup = async () => {
    const name = groupName.trim();
    if (!name || groupCreateOperation?.phase === 'pending') return;
    setLocalActionError('');
    try {
      const groupUlid = await dispatchCreateGroup({
        name, description: groupDescription.trim(), initialMemberPtids: selectedGroupMemberPtids,
      });
      closeCreateGroup();
      if (groupUlid) {
        clearGroupCreateOperation(groupUlid);
        onOpenChat({
          routeId: 'detail:group-conversation',
          groupUlid,
        });
        void selectSession(null);
        void selectGroup(groupUlid);
      }
    } catch {
      setLocalActionError(t('mobile.group.operationCreateFailed'));
    }
  };

  const retryGroupCreate = () => {
    if (!groupCreateOperation || groupCreateOperation.phase !== 'failed') return;
    setGroupName(groupCreateOperation.name);
    setGroupDescription(groupCreateOperation.description);
    setSelectedGroupMemberPtids([...groupCreateOperation.initialMemberPtids]);
    clearGroupCreateOperation(groupCreateOperation.conversationId);
    onOpenOverlay({ routeId: 'overlay:create-group' });
  };

  if (activeContactPtid) {
    return (
      <div className="page-container mobile-detail-page">
        <header className="page-header">
          <button
            className="header-action"
            type="button"
            onClick={onBack}
            aria-label={t('common.action.back')}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="header-title compact">
            {selectedContact?.peerName || t('mobile.contacts.profile')}
          </h1>
        </header>
        <div className="mobile-detail-body">
          {selectedContact ? (
            <div className="contact-profile-card">
              <Spin spinning={selectedProfileLoading}>
                <MobileAvatar src={selectedProfile?.avatar || selectedContact.peerAvatar} size={64}>
                  {(selectedProfile?.displayName || selectedContact.peerName).slice(0, 1)}
                </MobileAvatar>
              </Spin>
              <div className="contact-profile-copy">
                <Text strong className="contact-profile-name">{selectedProfile?.displayName || selectedContact.peerName}</Text>
                {selectedProfile?.acct || selectedProfile?.username ? <Text type="secondary">{selectedProfile.acct || selectedProfile.username}</Text> : null}
                <Text type="secondary" copyable>{selectedContact.peerPtid}</Text>
                {selectedProfile?.note ? <Text className="contact-profile-note">{selectedProfile.note}</Text> : null}
                <Tag color={selectedContact.peerOnline ? 'success' : 'default'}>
                  {selectedContact.peerOnline ? t('mobile.social.online') : t('mobile.social.offline')}
                </Tag>
              </div>
              {selectedProfile ? (
                <div className="contact-profile-stats">
                  <ProfileStat label={t('mobile.contacts.profilePosts')} value={selectedProfile.statusesCount} />
                  <ProfileStat label={t('mobile.contacts.profileFollowing')} value={selectedProfile.followingCount} />
                  <ProfileStat label={t('mobile.contacts.profileFollowers')} value={selectedProfile.followersCount} />
                </div>
              ) : null}
              {selectedProfile?.tags.length ? (
                <div className="contact-profile-tags">{selectedProfile.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</div>
              ) : null}
              {selectedProfileError ? <Text type="danger">{formatSocialError(selectedProfileError)}</Text> : null}
              {selectedBlocked ? <Tag color="error">{t('mobile.contacts.blocked')}</Tag> : null}
              {selectedContact.federationIds.length > 1 ? (
                <fieldset>
                  <legend>{t('mobile.contacts.federation')}</legend>
                  <Radio.Group value={directFederationId} onChange={(event) => setDirectScope({
                    peerPtid: selectedContact.peerPtid,
                    federationId: String(event.target.value),
                  })}>
                    {selectedContact.federationIds.map((federationId) => (
                      <Radio key={federationId} value={federationId}>{federationId}</Radio>
                    ))}
                  </Radio.Group>
                </fieldset>
              ) : null}
              {!directFederationId ? <MobileNotice>{t('mobile.contacts.federationRequired')}</MobileNotice> : null}
              {localActionError ? <MobileNotice tone="error">{localActionError}</MobileNotice> : null}
              <Button type="primary" block loading={openingChat} disabled={selectedBlocked || !directFederationId} onClick={() => void openContactChat(selectedContact)}>
                {t('mobile.contacts.openChat')}
              </Button>
              {selectedBlocked ? (
                <Button block icon={<RotateCcw size={14} />} onClick={confirmUnblockSelectedContact}>{t('mobile.contacts.unblock')}</Button>
              ) : (
                <Button block danger icon={<Ban size={14} />} onClick={confirmBlockSelectedContact}>{t('mobile.contacts.block')}</Button>
              )}
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('mobile.contacts.unavailable')}
            />
          )}
        </div>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="header-title">{t('mobile.contacts.title')}</h1>
        <button
          className="header-action"
          type="button"
          onClick={() => onOpenOverlay({ routeId: 'overlay:create-group' })}
          aria-label={t('mobile.group.create')}
        >
          <Users size={20} />
        </button>
        <button
          className="header-action"
          type="button"
          onClick={() => onOpenOverlay({ routeId: 'overlay:add-friend' })}
          aria-label={t('mobile.contacts.findPeople')}
        >
          <UserPlus size={20} />
        </button>
      </header>

      <div className="chat-search-bar">
        <Input value={contactQuery} onChange={(e) => { setContactQuery(e.target.value); saveRouteQuery('tab:contacts', e.target.value); }} prefix={<Search size={16} color="#9ca0ab" />} placeholder={t('mobile.contacts.searchPlaceholder')} allowClear />
      </div>

      {localActionError ? <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice> : null}
      {error ? <MobileNotice onClose={clearSocialError}>{formatSocialError(error)}</MobileNotice> : null}
      {groupError ? <MobileNotice onClose={clearGroupError}>{formatSocialError(groupError)}</MobileNotice> : null}
      {groupCreateOperation ? (
        <div data-group-create-state={groupCreateOperation.phase}>
          <MobileNotice tone={groupCreateOperation.phase === 'failed' ? 'error' : 'info'}>
            <Text strong>{groupCreateOperation.name}</Text>
            {' '}
            <Tag color={groupCreateOperation.phase === 'failed' ? 'error' : 'processing'}>
              {t(groupCreateOperation.phase === 'failed'
                ? 'mobile.group.operationCreateFailed'
                : 'mobile.recovery.command.state.pending')}
            </Tag>
            {groupCreateOperation.phase === 'failed' ? (
              <Button size="small" onClick={retryGroupCreate}>
                {t('common.action.retry')}
              </Button>
            ) : null}
          </MobileNotice>
        </div>
      ) : null}

      <section className="contacts-body">
        <Spin spinning={(loading || groupLoading) && windowedContacts.length === 0 && windowedGroups.length === 0 && inboundRequests.length === 0 && sentRequests.length === 0}>
          {/* --- Friend requests --- */}
          {inboundRequests.length > 0 ? (
            <div className="contact-section">
              <div className="section-header"><span>{t('mobile.contacts.friendRequests')}</span></div>
              <BoundedList surfaceKey="contacts:inbound" items={inboundRequests} itemKey={(request) => request.requestId}>
              {(rows) => <List dataSource={rows} rowKey="requestId" renderItem={(request) => {
                const decision = requestDecisionStates[request.requestId];
                return (
                  <List.Item
                    data-scroll-anchor-id={request.requestId}
                    data-request-decision-state={decision?.phase}
                    aria-busy={decision?.phase === 'pending'}
                    className="contact-item friend-request-item"
                    actions={[
                      <Button
                        key="accept"
                        type="primary"
                        aria-label={t('mobile.contacts.acceptRequest')}
                        icon={<Check size={14} />}
                        loading={decision?.phase === 'pending' && decision.action === 'accept'}
                        disabled={Boolean(decision)}
                        onClick={() => void handleAcceptRequest(request.requestId)}
                      />,
                      <Button
                        key="reject"
                        aria-label={t('mobile.contacts.rejectRequest')}
                        icon={<X size={14} />}
                        loading={decision?.phase === 'pending' && decision.action === 'reject'}
                        disabled={Boolean(decision)}
                        onClick={() => void handleRejectRequest(request.requestId)}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<MobileAvatar src={request.senderAvatar}>{displayPeerName(request.senderDisplayName, t).slice(0, 1)}</MobileAvatar>}
                      title={<Text strong>{displayPeerName(request.senderDisplayName, t)}</Text>}
                      description={request.message || t('mobile.contacts.defaultRequestMessage')}
                    />
                    {decision ? (
                      <Tag color={decision.phase === 'unknown' ? 'warning' : 'processing'}>
                        {t(decision.phase === 'unknown'
                          ? 'mobile.recovery.command.state.unknown-outcome'
                          : 'mobile.recovery.command.state.pending')}
                      </Tag>
                    ) : null}
                  </List.Item>
                );
              }} />}</BoundedList>
            </div>
          ) : null}

          {/* --- Groups section (prototype order: groups before contacts) --- */}
          {windowedGroups.length > 0 ? (
            <div className="contact-section">
              <div className="section-header"><span>{t('mobile.group.title')}</span></div>
              <div className="group-list">
                <BoundedList surfaceKey={`contacts:groups:${contactQuery}`} items={windowedGroups} itemKey={(group) => group.group.ulid}>
                {(rows) => rows.map((group) => (
                  <div key={group.group.ulid} data-scroll-anchor-id={group.group.ulid} data-focus-id={group.group.ulid} tabIndex={0} role="button" className="group-item" onClick={() => openGroupChat(group)} onKeyDown={(event) => { if (event.key === 'Enter') openGroupChat(group); }}>
                    <MobileAvatar src={group.group.avatarCid} size={44} icon={<Users size={16} />}>{group.group.name.slice(0, 1)}</MobileAvatar>
                    <div className="group-info">
                      <Text strong>{group.group.name}</Text>
                      <Text type="secondary">{t('mobile.group.memberCount', { count: group.group.memberCount })}</Text>
                    </div>
                    <ChevronRight size={18} color="#9ca0ab" />
                  </div>
                ))}</BoundedList>
              </div>
            </div>
          ) : null}

          {/* --- Contacts section with alphabetical letter grouping --- */}
          <div className="contact-section">
            <div className="section-header"><span>{t('mobile.contacts.friends')}</span></div>
            {windowedContacts.length > 0 ? (
              <div className="contact-list">
                <BoundedList surfaceKey={`contacts:friends:${contactQuery}`} items={windowedContacts} itemKey={(contact) => contact.peerPtid} size={CONTACT_WINDOW_SIZE}>
                {(rows) => rows.map((contact, index) => (
                  <div key={contact.peerPtid} data-scroll-anchor-id={contact.peerPtid}>
                    {index === 0 || contact.peerName[0]?.toUpperCase() !== rows[index - 1].peerName[0]?.toUpperCase()
                      ? <div className="contact-letter">{contact.peerName[0]?.toUpperCase() || '?'}</div>
                      : null}
                      <div className="contact-item-row" data-focus-id={contact.peerPtid} tabIndex={0} role="button" onClick={() => onOpenContact(contact.peerPtid)} onKeyDown={(event) => { if (event.key === 'Enter') onOpenContact(contact.peerPtid); }}>
                        <span className="conversation-avatar-frame">
                          <MobileAvatar src={contact.peerAvatar} size={44}>{contact.peerName.slice(0, 1)}</MobileAvatar>
                          {contact.peerOnline ? <span className="conversation-online-dot" aria-hidden="true" /> : null}
                        </span>
                        <div className="contact-info">
                          <Text strong>{contact.peerName}</Text>
                          <Text type="secondary">{contact.peerOnline ? t('mobile.social.online') : t('mobile.social.offline')}</Text>
                        </div>
                      </div>
                  </div>
                ))}</BoundedList>
              </div>
            ) : contacts.length > 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.contacts.noSearchResults')} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={
                <div className="empty-copy"><Text strong>{t('mobile.contacts.emptyTitle')}</Text><Text type="secondary">{t('mobile.contacts.emptySubtitle')}</Text></div>
              } />
            )}
          </div>

          {/* --- Sent requests --- */}
          {sentRequests.length > 0 ? (
            <div className="contact-section">
              <div className="section-header"><span>{t('mobile.contacts.sentRequests')}</span></div>
              <BoundedList surfaceKey="contacts:outbound" items={sentRequests} itemKey={(request) => request.requestId}>
              {(rows) => <List dataSource={rows} rowKey="requestId" renderItem={(request) => (
                <List.Item data-scroll-anchor-id={request.requestId} className="contact-item">
                  <List.Item.Meta
                    avatar={<MobileAvatar src={request.receiverAvatar}>{displayPeerName(request.receiverDisplayName, t).slice(0, 1)}</MobileAvatar>}
                    title={<Text strong>{displayPeerName(request.receiverDisplayName, t)}</Text>}
                    description={t('mobile.contacts.waitingForAccept')}
                  />
                  <Tag color="processing">{t('mobile.contacts.requestPending')}</Tag>
                </List.Item>
              )} />}</BoundedList>
            </div>
          ) : null}
        </Spin>
      </section>

      {/* --- Find People modal --- */}
      <Modal
        title={t('mobile.contacts.findPeople')}
        open={activeOverlay?.routeId === 'overlay:add-friend'}
        footer={null}
        onCancel={closeFindPeople}
        destroyOnClose
      >
        <div className="find-people-modal">
          <Input.Search
            value={peopleQuery}
            onChange={(e) => {
              setPeopleQuery(e.target.value);
              setSubmittedPeopleQuery('');
              clearPeopleSearch();
            }}
            onSearch={(value) => void runPeopleSearch(value)}
            placeholder={t('mobile.contacts.findPeoplePlaceholder')}
            enterButton={t('mobile.contacts.search')}
            loading={peopleSearching}
            allowClear
          />
          {peopleResults.length > 0 && !peopleSearching ? (
            peopleFederationsError ? (
              <MobileNotice tone="error">{t('mobile.contacts.federationsFailed')}</MobileNotice>
            ) : peopleFederations.length === 0 ? (
              <MobileNotice>{t('mobile.contacts.noFederation')}</MobileNotice>
            ) : (
              <fieldset>
                <legend>{t('mobile.contacts.federation')}</legend>
                <Radio.Group
                  value={requestFederationId}
                  onChange={(event) => setSelectedFederationId(String(event.target.value))}
                >
                  {peopleFederations.map((federation) => (
                    <Radio key={federation.federationId} value={federation.federationId}>
                      {federation.name || federation.federationId}
                    </Radio>
                  ))}
                </Radio.Group>
              </fieldset>
            )
          ) : null}
          {localActionError ? <MobileNotice tone="error">{localActionError}</MobileNotice> : null}
          <Spin spinning={peopleSearching && peopleResults.length === 0}>
            <div className="people-result-list">
              {peopleResults.length > 0 ? (
                peopleResults.map((result) => {
                  const receiverPtid = result.ptid;
                  const isSelf = !!currentUserPtid && receiverPtid === currentUserPtid;
                  const alreadyPending = pendingTargetPtids.has(receiverPtid);
                  const inboundPending = inboundTargetPtids.has(receiverPtid);
                  const alreadyFriend = contactPtids.has(receiverPtid);
                  return (
                    <div className="people-result-card" key={receiverPtid || result.username}>
                      <MobileAvatar src={result.avatar} size={42}>{(result.displayName || result.username || receiverPtid).slice(0, 1)}</MobileAvatar>
                      <div className="people-result-copy">
                        <div className="people-result-title">
                          <Text strong ellipsis>{result.displayName || result.username || receiverPtid}</Text>
                          {result.federation ? (
                            <Tag color="success" icon={<ShieldCheck size={11} />}>{t('mobile.contacts.verified')}</Tag>
                          ) : null}
                          {result.federation?.isLocal === false ? (
                            <Tag color="blue">{t('mobile.contacts.federatedTag')}</Tag>
                          ) : null}
                          {result.federation?.fromCache ? (
                            <Tag>{t('mobile.contacts.cachedTag')}</Tag>
                          ) : null}
                        </div>
                        <Text type="secondary" ellipsis>{result.federation?.handle || result.username || receiverPtid}</Text>
                      </div>
                      <Button type="primary" size="small" loading={sendingRequest} disabled={isSelf || alreadyPending || inboundPending || alreadyFriend || peopleSearching || sendingRequest || !requestFederationId || !result.homeStationPeerId} onClick={() => sendRequestToResult(result)}>
                        {isSelf ? t('mobile.contacts.self')
                          : alreadyFriend ? t('mobile.contacts.alreadyFriend')
                          : alreadyPending ? t('mobile.contacts.requestSent')
                          : inboundPending ? t('mobile.contacts.requestPending')
                          : t('mobile.contacts.sendRequest')}
                      </Button>
                    </div>
                  );
                })
              ) : peopleSearchFeedback === 'loading' ? null : (
                <div data-people-search-state={peopleSearchFeedback}>
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={
                    <div className="empty-copy">
                      <Text>
                        {peopleSearchFeedback === 'unresolved-federated-handle'
                          ? t('mobile.contacts.resolveFailed', { handle: submittedPeopleQuery })
                          : peopleSearchFeedback === 'remote-unavailable'
                            ? t('common.stationPicker.status.offline')
                            : peopleSearchFeedback === 'failed'
                              ? t(peopleError?.context.message.startsWith('mobile.')
                                ? peopleError.context.message
                                : 'mobile.contacts.searchFailed')
                              : peopleSearchFeedback === 'local-no-result'
                                ? t('mobile.contacts.noPeopleResults')
                                : t('mobile.contacts.findPeopleHint')}
                      </Text>
                      {peopleSearchFeedback !== 'idle' ? (
                        <Button
                          size="small"
                          onClick={() => void runPeopleSearch(peopleQuery)}
                        >
                          {t(peopleSearchFeedback === 'local-no-result'
                            ? 'common.action.search'
                            : 'common.action.retry')}
                        </Button>
                      ) : null}
                    </div>
                  } />
                </div>
              )}
            </div>
          </Spin>
        </div>
      </Modal>

      {/* --- Create Group modal --- */}
      <Modal title={t('mobile.group.create')} open={activeOverlay?.routeId === 'overlay:create-group'} onCancel={closeCreateGroup}
        onOk={submitCreateGroup} okText={t('mobile.group.create')} cancelText={t('common.action.cancel')}
        confirmLoading={groupCreateOperation?.phase === 'pending'}
        okButtonProps={{ disabled: !groupName.trim() || groupCreateOperation?.phase === 'pending' }} destroyOnClose>
        <div className="group-create-form">
          {groupCreateOperation?.phase === 'failed' ? (
            <MobileNotice tone="error">
              {t('mobile.group.operationCreateFailed')}
            </MobileNotice>
          ) : null}
          <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t('mobile.group.namePlaceholder')} />
          <Input.TextArea value={groupDescription} onChange={(e) => setGroupDescription(e.target.value)} placeholder={t('mobile.group.descriptionPlaceholder')} autoSize={{ minRows: 2, maxRows: 4 }} />
          <SectionTitle title={t('mobile.group.initialMembers')} count={selectedGroupMemberPtids.length} />
          {contacts.length > 0 ? (
            <BoundedList surfaceKey="contacts:create-group" items={contacts} itemKey={(contact) => contact.peerPtid}>
            {(rows) => <List dataSource={rows} rowKey="peerPtid" renderItem={(contact) => (
              <List.Item data-scroll-anchor-id={contact.peerPtid}>
                <List.Item.Meta
                  avatar={<MobileAvatar src={contact.peerAvatar}>{contact.peerName.slice(0, 1)}</MobileAvatar>}
                  title={<Text strong>{contact.peerName}</Text>}
                  description={<Text type="secondary" copyable>{contact.peerPtid}</Text>}
                />
                <Checkbox aria-label={contact.peerName} checked={selectedGroupMemberPtids.includes(contact.peerPtid)} onChange={(e) => toggleInitialGroupMember(contact.peerPtid, e.target.checked)} />
              </List.Item>
            )} />}</BoundedList>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noInitialMembers')} />}
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — pure renderers
// ---------------------------------------------------------------------------

function ProfileStat({ label, value }: { label: string; value: number }) {
  return <div className="contact-profile-stat"><Text strong>{value}</Text><Text type="secondary">{label}</Text></div>;
}

function displayPeerName(name: string | undefined, t: (key: string) => string): string {
  return name?.trim() || t('mobile.contacts.unknownUser');
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return <div className="social-section-title"><Text strong>{title}</Text><Text type="secondary">{count}</Text></div>;
}
