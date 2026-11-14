/**
 * ContactsPage.tsx — Pure renderer for the contacts tab.
 *
 * W6A contract: this page renders narrow selectors and dispatches typed
 * commands only.  It handles duplicate / no-result / unavailable /
 * role-denied states.  All visible text uses i18n.  Contact
 * lists are bounded.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Checkbox,
  Empty,
  Icon,
  IconButton,
  Spin,
  Tag,
  Text,
  TextArea,
  TextField,
  BottomSheet,
  Switch,
} from '@peers-touch/ui';

import { confirm, confirmDestructive } from '../app/feedback/mobileFeedback';
import { useMobileI18n } from '../app/mobileI18n';
import { useMobileNavigationStore } from '../app/navigation';
import type {
  MobileChatDetailRoute,
  MobileOverlayRoute,
} from '../app/navigation';
import { MobileAvatar } from '../components/MobileAvatar';
import { MobileNotice } from '../components/MobileNotice';
import { BoundedList } from '../components/BoundedList';
import { useContactsSurfaceFixture } from '../acceptance/contactsSurfaceFixture';
import { formatSocialError, useSocialStore } from '../features/social/socialStore';
import {
  actorDisplayName,
  projectAcceptedContacts,
  projectOutgoingRequests,
  projectPendingInboundRequests,
  type SocialContact,
} from '../features/social/socialProjection';
import {
  requestSocialFriendshipStatus,
  requestSocialPeerProfiles,
} from '../features/social/socialRuntime';
import {
  friendRequestDecisionFence,
  type FriendRequestDecisionAction,
} from '../features/social/contactInteractionState';
import { readableErrorMessage } from '../features/social/socialTypes';
import {
  dispatchAcceptFriendRequest,
  dispatchCreateGroup,
  dispatchRejectFriendRequest,
  dispatchOpenContactChat,
} from '../features/social/contactCommands';
import { dispatchBlockUser, dispatchUnblockUser } from '../features/chat/chatCommands';
import { groupCommandOutcomeKey } from '../features/chat/groupCommandState';
import { ContactsAcceptanceSurface } from './contacts/ContactsAcceptanceSurface';
import { mobileContactPreferences } from '../runtimes/contactPreferencesRuntime';
import { useContactPreferences } from '../features/social/useContactPreferences';
import { ContactRemarkForm } from './contacts/ContactRemarkForm';
import type { UpdateFriendConversationSettingsInput } from '../features/social/socialApiTypes';

/** Maximum contacts mounted in one traversable window. */
const CONTACT_WINDOW_SIZE = 100;

interface ContactsPageProps {
  readonly activeContactPtid: string | null;
  readonly activeOverlay: MobileOverlayRoute | null;
  readonly onOpenChat: (route: MobileChatDetailRoute) => void;
  readonly onOpenContact: (actorPtid: string) => void;
  readonly onFindPeople: () => void;
  readonly onOpenOverlay: (route: MobileOverlayRoute) => void;
  readonly onCloseOverlay: () => void;
  readonly onBack: () => void;
  readonly searchEntry?: ReactNode;
  readonly listHeader?: ReactNode;
}

export function ContactsPage(props: ContactsPageProps) {
  const fixture = useContactsSurfaceFixture();
  if (fixture.surfaceId) {
    return (
      <ContactsAcceptanceSurface
        key={`${fixture.surfaceId}:${fixture.revision}`}
        surfaceId={fixture.surfaceId}
        listHeader={props.listHeader}
      />
    );
  }
  return <ContactsPageInner {...props} />;
}

function ContactsPageInner({
  activeContactPtid,
  activeOverlay,
  onOpenChat,
  onOpenContact,
  onFindPeople,
  onOpenOverlay,
  onCloseOverlay,
  onBack,
  searchEntry,
  listHeader,
}: ContactsPageProps) {
  const { t } = useMobileI18n();
  const preferences = useContactPreferences();
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [savingRemark, setSavingRemark] = useState(false);
  const [savingContactSettings, setSavingContactSettings] = useState(false);

  // --- Local UI state ---
  const contactQuery = useMobileNavigationStore((state) => state.messageQueries.contacts);
  const setMessageQuery = useMobileNavigationStore((state) => state.setMessageQuery);
  const setContactQuery = (value: string) => setMessageQuery('contacts', value);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedGroupMemberPtids, setSelectedGroupMemberPtids] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [pendingGroupConversationId, setPendingGroupConversationId] = useState('');
  const [localActionError, setLocalActionError] = useState('');
  const [openingChat, setOpeningChat] = useState(false);
  const [requestDecisionRevision, setRequestDecisionRevision] = useState(0);
  const activeContactRef = useRef(activeContactPtid);
  const mountedRef = useRef(true);
  activeContactRef.current = activeContactPtid;
  useEffect(() => {
    activeContactRef.current = activeContactPtid;
    mountedRef.current = true;
    return () => {
      activeContactRef.current = null;
      mountedRef.current = false;
    };
  }, [activeContactPtid]);

  // --- Narrow store selectors ---
  const authSession = useSocialStore((s) => s.authSession);
  const currentUserPtid = useSocialStore((s) => s.currentUserPtid);
  const friendRequests = useSocialStore((s) => s.friendRequests);
  const messagingConversations = useSocialStore((s) => s.messagingConversations);
  const groupCommandOutcomes = useSocialStore((s) => s.groupCommandOutcomes);
  const clearGroupCommandOutcome = useSocialStore((s) => s.clearGroupCommandOutcome);
  const loading = useSocialStore((s) => s.loading);
  const error = useSocialStore((s) => s.error);
  const clearSocialError = useSocialStore((s) => s.clearError);
  const selectSession = useSocialStore((s) => s.selectSession);
  const sessions = useSocialStore((s) => s.sessions);
  const conversationSettings = useSocialStore((s) => s.conversationSettings);
  const loadConversationSettings = useSocialStore((s) => s.loadConversationSettings);
  const updateConversationSettings = useSocialStore((s) => s.updateConversationSettings);
  const peerProfiles = useSocialStore((s) => s.peerProfiles);
  const peerProfileLoading = useSocialStore((s) => s.peerProfileLoading);
  const peerProfileErrors = useSocialStore((s) => s.peerProfileErrors);
  const friendshipStatus = useSocialStore((s) => s.friendshipStatus);

  // --- Projection data ---
  const peerOnline = useSocialStore((s) => s.peerOnline);

  const contacts = useMemo(
    () => projectAcceptedContacts(friendRequests, currentUserPtid, peerOnline, peerProfiles)
      .map(contact => ({
        ...contact,
        peerName: preferences.contacts[contact.peerPtid]?.nickname || contact.peerName,
      })),
    [currentUserPtid, friendRequests, peerOnline, peerProfiles, preferences.contacts],
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
    return contacts.filter((c) => `${c.peerName} ${c.peerPtid} ${preferences.contacts[c.peerPtid]?.note ?? ''}`
      .toLowerCase().includes(query));
  }, [contactQuery, contacts, preferences.contacts]);
  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.peerPtid === activeContactPtid) ?? null,
    [activeContactPtid, contacts],
  );

  // --- Bounded windowing ---
  const windowedContacts = useMemo(
    () => [...filteredContacts].sort((a, b) => a.peerName.localeCompare(b.peerName)),
    [filteredContacts],
  );

  // --- Selected contact profile ---
  const selectedProfile = selectedContact ? peerProfiles[selectedContact.peerPtid] : null;
  const selectedProfileLoading = selectedContact ? Boolean(peerProfileLoading[selectedContact.peerPtid]) : false;
  const selectedProfileError = selectedContact ? peerProfileErrors[selectedContact.peerPtid] : null;
  const selectedBlocked = selectedContact ? Boolean(friendshipStatus[selectedContact.peerPtid]?.blocked) : false;
  const selectedSessionId = sessions.find(session =>
    (session.participantAPtid === currentUserPtid && session.participantBPtid === activeContactPtid)
    || (session.participantBPtid === currentUserPtid && session.participantAPtid === activeContactPtid))?.ulid;
  const selectedSettings = selectedSessionId ? conversationSettings[selectedSessionId] : undefined;
  const requestDecisionScope = authSession
    ? `${authSession.stationPeerId}\u0000${authSession.actorRef.ptid}`
    : '';
  const contactScopeRef = useRef(requestDecisionScope);
  contactScopeRef.current = requestDecisionScope;
  useEffect(() => {
    setRemarkOpen(false);
    setSavingRemark(false);
    setSavingContactSettings(false);
    setLocalActionError('');
  }, [activeContactPtid, requestDecisionScope]);
  useEffect(() => {
    if (!selectedSessionId) return;
    const scope = requestDecisionScope;
    void loadConversationSettings(selectedSessionId).catch(error => {
      if (contactScopeRef.current === scope && activeContactRef.current === activeContactPtid) {
        setLocalActionError(readableErrorMessage(error, 'mobile.settings.dirty.saveFailed'));
      }
    });
  }, [activeContactPtid, loadConversationSettings, requestDecisionScope, selectedSessionId]);
  const updateContactSettings = async (patch: UpdateFriendConversationSettingsInput) => {
    if (!selectedContact || savingContactSettings) return;
    const ptid = selectedContact.peerPtid;
    const scope = requestDecisionScope;
    const current = () => contactScopeRef.current === scope && activeContactRef.current === ptid && mountedRef.current;
    setSavingContactSettings(true);
    setLocalActionError('');
    try {
      const conversationId = selectedSessionId ?? await dispatchOpenContactChat(ptid);
      if (!current()) return;
      await updateConversationSettings(conversationId, patch);
    } catch (error) {
      if (current()) setLocalActionError(readableErrorMessage(error, 'mobile.settings.dirty.saveFailed'));
    } finally {
      if (current()) setSavingContactSettings(false);
    }
  };
  const requestDecisionStates = useMemo(
    () => friendRequestDecisionFence.snapshot(requestDecisionScope),
    [requestDecisionRevision, requestDecisionScope],
  );

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
    if (!pendingGroupConversationId) return;
    const outcome = groupCommandOutcomes[groupCommandOutcomeKey(
      pendingGroupConversationId,
      'create',
    )];
    if (outcome?.state === 'failed') {
      clearGroupCommandOutcome(pendingGroupConversationId, 'create');
      setPendingGroupConversationId('');
      setCreatingGroup(false);
      setLocalActionError(t('mobile.group.operationCreateFailed'));
      return;
    }
    if (!messagingConversations.some(
      (conversation) => conversation.conversationId === pendingGroupConversationId,
    )) return;
    const groupUlid = pendingGroupConversationId;
    setPendingGroupConversationId('');
    setCreatingGroup(false);
    setGroupName('');
    setGroupDescription('');
    setSelectedGroupMemberPtids([]);
    onCloseOverlay();
    onOpenChat({ routeId: 'detail:group-conversation', groupUlid });
    void selectSession(groupUlid);
  }, [
    clearGroupCommandOutcome,
    groupCommandOutcomes,
    messagingConversations,
    onCloseOverlay,
    onOpenChat,
    pendingGroupConversationId,
    selectSession,
    t,
  ]);

  // --- Command dispatchers ---
  const closeCreateGroup = () => {
    if (pendingGroupConversationId) {
      clearGroupCommandOutcome(pendingGroupConversationId, 'create');
    }
    onCloseOverlay();
    setGroupName('');
    setGroupDescription('');
    setSelectedGroupMemberPtids([]);
    setPendingGroupConversationId('');
    setCreatingGroup(false);
  };

  const toggleInitialGroupMember = (ptid: string, checked: boolean) => {
    setSelectedGroupMemberPtids((current) => checked
      ? [...new Set([...current, ptid])]
      : current.filter((candidate) => candidate !== ptid));
  };

  const submitCreateGroup = async () => {
    const name = groupName.trim();
    if (!name || selectedGroupMemberPtids.length === 0 || creatingGroup) return;
    setLocalActionError('');
    setCreatingGroup(true);
    try {
      const result = await dispatchCreateGroup({
        name,
        description: groupDescription.trim(),
        initialMemberPtids: selectedGroupMemberPtids,
      });
      setPendingGroupConversationId(result.conversationId);
      if (result.state === 'projected') {
        const groupUlid = result.conversationId;
        closeCreateGroup();
        onOpenChat({ routeId: 'detail:group-conversation', groupUlid });
        void selectSession(groupUlid);
      }
    } catch (error) {
      setCreatingGroup(false);
      setLocalActionError(t(
        error instanceof Error && error.message === 'mobile.group.federationScopeRequired'
          ? error.message
          : 'mobile.group.operationCreateFailed',
      ));
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
    if (openingChat) return;
    setOpeningChat(true);
    setLocalActionError('');
    try {
      const sessionUlid = await dispatchOpenContactChat(contact.peerPtid);
      if (activeContactRef.current !== contact.peerPtid) return;
      onOpenChat({ routeId: 'detail:chat-conversation', sessionUlid });
      void selectSession(sessionUlid);
    } catch (error) {
      setLocalActionError(t(error instanceof Error && error.message === 'mobile.contacts.conversationPreparing'
        ? error.message : 'mobile.contacts.openChatFailed'));
    } finally {
      setOpeningChat(false);
    }
  };

  const confirmBlockSelectedContact = () => {
    if (!selectedContact) return;
    void confirmDestructive({
      title: t('mobile.contacts.blockConfirmTitle'),
      description: t('mobile.contacts.blockConfirmBody'),
      confirmLabel: t('mobile.contacts.block'),
      cancelLabel: t('common.action.cancel'),
      onConfirm: async () => {
        await dispatchBlockUser(selectedContact.peerPtid);
        onBack();
      },
    });
  };

  const confirmUnblockSelectedContact = () => {
    if (!selectedContact) return;
    void confirm({
      title: t('mobile.contacts.unblockConfirmTitle'),
      description: t('mobile.contacts.unblockConfirmBody'),
      confirmLabel: t('mobile.contacts.unblock'),
      cancelLabel: t('common.action.cancel'),
      onConfirm: async () => { await dispatchUnblockUser(selectedContact.peerPtid); },
    });
  };

  if (activeContactPtid) {
    return (
      <div
        className="page-container mobile-detail-page"
        data-product-surface={selectedContact
          ? 'contacts.profile'
          : 'contacts.profile-unavailable'}
      >
        <header className="page-header">
          <IconButton actionId="contacts.back" iconId="arrow-left" iconSize={20}
            emphasis="quiet" density="comfortable" onActivate={onBack} label={t('common.action.back')} />
          <h1 className="header-title compact">
            {selectedContact?.peerName || t('mobile.contacts.profile')}
          </h1>
        </header>
        <div className="mobile-detail-body">
          {selectedContact ? (
            <div className="contact-profile-card">
              <Spin active={selectedProfileLoading}>
                <MobileAvatar src={selectedProfile?.avatar || selectedContact.peerAvatar} size={64}>
                  {(selectedProfile?.displayName || selectedContact.peerName).slice(0, 1)}
                </MobileAvatar>
              </Spin>
              <div className="contact-profile-copy">
                <Text strong className="contact-profile-name">{selectedContact.peerName}</Text>
                {preferences.contacts[selectedContact.peerPtid]?.nickname && selectedProfile?.displayName
                  ? <Text tone="secondary">{selectedProfile.displayName}</Text> : null}
                {selectedProfile?.acct || selectedProfile?.username ? <Text tone="secondary">{selectedProfile.acct || selectedProfile.username}</Text> : null}
                {selectedProfile?.note ? <Text className="contact-profile-note">{selectedProfile.note}</Text> : null}
                <Tag tone={selectedContact.peerOnline ? 'success' : 'neutral'}>
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
              {selectedProfileError ? <Text tone="danger">{formatSocialError(selectedProfileError)}</Text> : null}
              {selectedBlocked ? <Tag tone="danger">{t('mobile.contacts.blocked')}</Tag> : null}
              {localActionError ? <MobileNotice tone="error">{localActionError}</MobileNotice> : null}
              {preferences.errorKey ? <MobileNotice tone="error">
                {t(preferences.errorKey)}
                <Button actionId="contact-preferences-retry" density="comfortable"
                  onActivate={() => void mobileContactPreferences.load()}>{t('common.action.retry')}</Button>
              </MobileNotice> : null}
              {preferences.contacts[selectedContact.peerPtid]?.note
                ? <Text>{preferences.contacts[selectedContact.peerPtid].note}</Text> : null}
              <div className="contact-setting-row">
                <Text>{t('mobile.chat.muteNotifications')}</Text>
                <Switch aria-label={t('mobile.chat.muteNotifications')} checked={Boolean(selectedSettings?.isMuted)}
                  disabled={savingContactSettings || Boolean(selectedSessionId && !selectedSettings)}
                  onCheckedChange={value => void updateContactSettings({ isMuted: value })} />
              </div>
              <div className="contact-setting-row">
                <Text>{t('mobile.contacts.alertEnabled')}</Text>
                <Switch aria-label={t('mobile.contacts.alertEnabled')} checked={selectedSettings?.alertEnabled ?? true}
                  disabled={savingContactSettings || Boolean(selectedSessionId && !selectedSettings)}
                  onCheckedChange={value => void updateContactSettings({ alertEnabled: value })} />
              </div>
              <Button actionId="contact-profile-remark" fullWidth density="comfortable"
                availability={preferences.status !== 'ready'
                  ? { kind: 'disabled', reason: t('mobile.contacts.preferencesWait') } : undefined}
                onActivate={() => {
                  setNicknameDraft(preferences.contacts[selectedContact.peerPtid]?.nickname ?? '');
                  setNoteDraft(preferences.contacts[selectedContact.peerPtid]?.note ?? '');
                  setRemarkOpen(true);
                }}>{t('mobile.contacts.editRemark')}</Button>
              <Button
                actionId="contact-profile-open-chat"
                emphasis="primary"
                fullWidth
                execution={openingChat ? 'pending' : 'idle'}
                availability={selectedBlocked
                  ? { kind: 'disabled', reason: t('mobile.chat.blockedComposer') }
                  : undefined}
                onActivate={() => void openContactChat(selectedContact)}
              >
                {t('mobile.contacts.openChat')}
              </Button>
              {selectedBlocked ? (
                <Button
                  actionId="contact-profile-unblock"
                  fullWidth
                  leading={<Icon iconId="rotate-ccw" size={14} />}
                  onActivate={confirmUnblockSelectedContact}
                >{t('mobile.contacts.unblock')}</Button>
              ) : (
                <Button
                  actionId="contact-profile-block"
                  fullWidth
                  tone="danger"
                  leading={<Icon iconId="ban" size={14} />}
                  onActivate={confirmBlockSelectedContact}
                >{t('mobile.contacts.block')}</Button>
              )}
            </div>
          ) : (
            <Empty description={t('mobile.contacts.unavailable')} />
          )}
        </div>
        <BottomSheet open={remarkOpen} title={t('mobile.contacts.editRemark')}
          onDismiss={() => { if (!savingRemark) setRemarkOpen(false); }}>
          <ContactRemarkForm nickname={nicknameDraft} note={noteDraft} saving={savingRemark}
            error={localActionError} onNicknameChange={setNicknameDraft} onNoteChange={setNoteDraft}
            onSave={async () => {
              if (!selectedContact || savingRemark) return;
              const ptid = selectedContact.peerPtid;
              const scope = requestDecisionScope;
              const current = () => activeContactRef.current === ptid && contactScopeRef.current === scope && mountedRef.current;
              setSavingRemark(true);
              setLocalActionError('');
              try {
                const saved = await mobileContactPreferences.save(ptid, { nickname: nicknameDraft, note: noteDraft });
                if (saved && current()) setRemarkOpen(false);
              } catch {
                if (current()) setLocalActionError(t('mobile.contacts.preferencesSaveFailed'));
              } finally {
                if (current()) setSavingRemark(false);
              }
            }} />
        </BottomSheet>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="page-container" data-product-surface="contacts.list">
      {listHeader ?? <><header className="page-header">
        <h1 className="header-title">{t('mobile.contacts.title')}</h1>
        {searchEntry}
        <IconButton actionId="contacts.create-group" iconId="users" iconSize={20}
          density="comfortable" emphasis="quiet" label={t('mobile.group.create')}
          onActivate={() => onOpenOverlay({ routeId: 'overlay:create-group' })} />
        <IconButton actionId="contacts.add" iconId="user-plus" iconSize={20}
          density="comfortable" emphasis="quiet" label={t('mobile.contacts.findPeople')}
          onActivate={onFindPeople} />
      </header>

      <div className="chat-search-bar">
        <TextField
          appearance="search"
          value={contactQuery}
          className="contact-search-field"
          leading={<Icon iconId="search" size={16} className="chat-search-leading" />}
          clearable
          onClear={() => setContactQuery('')}
          placeholder={t('mobile.contacts.searchPlaceholder')}
          onValueChange={setContactQuery}
        />
      </div>
      </>}

      {localActionError ? <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice> : null}
      {error ? <MobileNotice onClose={clearSocialError}>{formatSocialError(error)}</MobileNotice> : null}

      <section className="contacts-body">
        <Spin active={loading && windowedContacts.length === 0 && inboundRequests.length === 0 && sentRequests.length === 0}>
          {/* --- Friend requests --- */}
          {inboundRequests.length > 0 ? (
            <div className="contact-section">
              <div className="section-header"><span>{t('mobile.contacts.friendRequests')}</span></div>
              <BoundedList surfaceKey="contacts:inbound" items={inboundRequests} itemKey={(request) => request.requestId}>
              {(rows) => rows.map((request) => {
                const decision = requestDecisionStates[request.requestId];
                const acceptPending = decision?.phase === 'pending' && decision.action === 'accept';
                const rejectPending = decision?.phase === 'pending' && decision.action === 'reject';
                return (
                  <div
                    key={request.requestId}
                    data-scroll-anchor-id={request.requestId}
                    data-request-decision-state={decision?.phase}
                    aria-busy={decision?.phase === 'pending'}
                    className="contact-item friend-request-item"
                  >
                    <div className="contact-item-meta">
                      <MobileAvatar src={request.senderAvatar}>{displayPeerName(request.senderDisplayName, request.senderPtid, t).slice(0, 1)}</MobileAvatar>
                      <span className="contact-item-copy">
                        <Text strong>{displayPeerName(request.senderDisplayName, request.senderPtid, t)}</Text>
                        <span className="contact-item-description">
                          {request.message || t('mobile.contacts.defaultRequestMessage')}
                        </span>
                      </span>
                    </div>
                    {decision ? (
                      <Tag tone={decision.phase === 'unknown' ? 'warning' : 'info'}>
                        {t(decision.phase === 'unknown'
                          ? 'mobile.recovery.command.state.unknown-outcome'
                          : 'mobile.recovery.command.state.pending')}
                      </Tag>
                    ) : null}
                    <span className="contact-item-actions">
                      <IconButton
                        actionId="contact-request-accept"
                        iconId="check"
                        iconSize={14}
                        label={t('mobile.contacts.acceptRequest')}
                        emphasis="primary"
                        execution={acceptPending ? 'pending' : 'idle'}
                        availability={Boolean(decision)
                        ? { kind: 'disabled', reason: t('mobile.recovery.command.state.pending') }
                          : undefined}
                        onActivate={() => void handleAcceptRequest(request.requestId)}
                      />
                      <IconButton
                        actionId="contact-request-reject"
                        iconId="close"
                        iconSize={14}
                        label={t('mobile.contacts.rejectRequest')}
                        execution={rejectPending ? 'pending' : 'idle'}
                        availability={Boolean(decision)
                        ? { kind: 'disabled', reason: t('mobile.recovery.command.state.pending') }
                          : undefined}
                        onActivate={() => void handleRejectRequest(request.requestId)}
                      />
                    </span>
                  </div>
                );
              })}
              </BoundedList>
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
                    {index === 0 || displayPeerName(contact.peerName, contact.peerPtid, t)[0]?.toUpperCase() !== displayPeerName(rows[index - 1].peerName, rows[index - 1].peerPtid, t)[0]?.toUpperCase()
                      ? <div className="contact-letter">{displayPeerName(contact.peerName, contact.peerPtid, t)[0]?.toUpperCase() || '?'}</div>
                      : null}
                      <div className="contact-item-row">
                        <Button actionId={`contacts.open.${contact.peerPtid}`} data-focus-id={contact.peerPtid}
                          fullWidth emphasis="quiet" density="comfortable"
                          onActivate={() => onOpenContact(contact.peerPtid)}>
                        <span className="conversation-avatar-frame">
                          <MobileAvatar src={contact.peerAvatar} size={44}>{displayPeerName(contact.peerName, contact.peerPtid, t).slice(0, 1)}</MobileAvatar>
                          {contact.peerOnline ? <span className="conversation-online-dot" aria-hidden="true" /> : null}
                        </span>
                        <div className="contact-info">
                          <Text strong>{displayPeerName(contact.peerName, contact.peerPtid, t)}</Text>
                          <Text tone="secondary">{contact.peerOnline ? t('mobile.social.online') : t('mobile.social.offline')}</Text>
                        </div>
                        </Button>
                      </div>
                  </div>
                ))}</BoundedList>
              </div>
            ) : contacts.length > 0 ? (
              <Empty description={t('mobile.contacts.noSearchResults')} />
            ) : (
              <Empty description={
                <div className="empty-copy">
                  <Text strong>{t('mobile.contacts.emptyTitle')}</Text>
                  <Text tone="secondary">{t('mobile.contacts.emptySubtitle')}</Text>
                  <Button
                    actionId="contacts-empty-find-people"
                    emphasis="primary"
                    leading={<Icon iconId="user-plus" size={16} />}
                    onActivate={onFindPeople}
                  >
                    {t('mobile.contacts.findPeople')}
                  </Button>
                </div>
              } />
            )}
          </div>

          {/* --- Sent requests --- */}
          {sentRequests.length > 0 ? (
            <div className="contact-section">
              <div className="section-header"><span>{t('mobile.contacts.sentRequests')}</span></div>
              <BoundedList surfaceKey="contacts:outbound" items={sentRequests} itemKey={(request) => request.requestId}>
              {(rows) => rows.map((request) => (
                <div key={request.requestId} data-scroll-anchor-id={request.requestId} className="contact-item">
                  <div className="contact-item-meta">
                    <MobileAvatar src={request.receiverAvatar}>{displayPeerName(request.receiverDisplayName, request.receiverPtid, t).slice(0, 1)}</MobileAvatar>
                    <span className="contact-item-copy">
                      <Text strong>{displayPeerName(request.receiverDisplayName, request.receiverPtid, t)}</Text>
                      <span className="contact-item-description">{t('mobile.contacts.waitingForAccept')}</span>
                    </span>
                  </div>
                  <Tag tone="info">{t('mobile.contacts.requestPending')}</Tag>
                </div>
              ))}
              </BoundedList>
            </div>
          ) : null}
        </Spin>
      </section>

      <BottomSheet
        title={t('mobile.group.create')}
        open={activeOverlay?.routeId === 'overlay:create-group'}
        onDismiss={closeCreateGroup}
        actions={[
          { id: 'create-group-cancel', label: t('common.action.cancel'), onActivate: closeCreateGroup },
          { id: 'create-group-submit', label: t('mobile.group.create'),
            availability: !groupName.trim()
              ? { kind: 'disabled', reason: t('mobile.group.nameRequired') }
              : selectedGroupMemberPtids.length === 0
                ? { kind: 'disabled', reason: t('mobile.group.initialMembersRequired') }
                : creatingGroup ? { kind: 'disabled', reason: t('mobile.recovery.command.state.pending') } : undefined,
            onActivate: () => void submitCreateGroup() },
        ]}
      >
        <div
          className="group-create-form"
          data-acceptance-id="create-group"
          data-product-surface="contacts.create-group"
        >
          {pendingGroupConversationId ? (
            <MobileNotice>
              {t('mobile.recovery.command.state.pending')}
            </MobileNotice>
          ) : null}
          {localActionError ? (
            <MobileNotice tone="error" onClose={() => setLocalActionError('')}>
              {localActionError}
            </MobileNotice>
          ) : null}
          <TextField
            value={groupName}
            placeholder={t('mobile.group.namePlaceholder')}
            disabled={creatingGroup}
            onValueChange={setGroupName}
          />
          <TextArea
            value={groupDescription}
            placeholder={t('mobile.group.descriptionPlaceholder')}
            minimumRows={2}
            maximumRows={4}
            disabled={creatingGroup}
            onValueChange={setGroupDescription}
          />
          <SectionTitle
            title={t('mobile.group.initialMembers')}
            count={selectedGroupMemberPtids.length}
          />
          {contacts.length > 0 && selectedGroupMemberPtids.length === 0 ? (
            <Text tone="secondary">{t('mobile.group.initialMembersRequired')}</Text>
          ) : null}
          {contacts.length > 0 ? (
            <BoundedList
              surfaceKey="contacts:create-group"
              items={contacts}
              itemKey={(contact) => contact.peerPtid}
            >
              {(rows) => rows.map((contact) => (
                <div key={contact.peerPtid} className="contact-item group-member-picker-row" data-scroll-anchor-id={contact.peerPtid}>
                  <div className="contact-item-meta">
                    <MobileAvatar src={contact.peerAvatar}>
                      {displayPeerName(contact.peerName, contact.peerPtid, t).slice(0, 1)}
                    </MobileAvatar>
                    <span className="contact-item-copy">
                      <Text strong>{displayPeerName(contact.peerName, contact.peerPtid, t)}</Text>
                      <span className="contact-item-description">
                        {contact.peerOnline
                          ? t('mobile.social.online')
                          : t('mobile.social.offline')}
                      </span>
                    </span>
                  </div>
                  <Checkbox
                    aria-label={displayPeerName(contact.peerName, contact.peerPtid, t)}
                    checked={selectedGroupMemberPtids.includes(contact.peerPtid)}
                    disabled={creatingGroup}
                    onCheckedChange={(checked) => toggleInitialGroupMember(
                      contact.peerPtid,
                      checked,
                    )}
                  />
                </div>
              ))}
            </BoundedList>
          ) : (
            <Empty description={t('mobile.group.noInitialMembers')} />
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components — pure renderers
// ---------------------------------------------------------------------------

function ProfileStat({ label, value }: { label: string; value: number }) {
  return <div className="contact-profile-stat"><Text strong>{value}</Text><Text tone="secondary">{label}</Text></div>;
}

function displayPeerName(
  name: string | undefined,
  actorPtid: string,
  t: (key: string) => string,
): string {
  return actorDisplayName(name, actorPtid) || t('mobile.contacts.unknownUser');
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="social-section-title">
      <Text strong>{title}</Text>
      <Text tone="secondary">{count}</Text>
    </div>
  );
}
