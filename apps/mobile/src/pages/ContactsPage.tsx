/**
 * ContactsPage.tsx — Pure renderer for the contacts tab.
 *
 * W6A contract: this page renders narrow selectors and dispatches typed
 * commands only.  It handles duplicate / no-result / unavailable /
 * role-denied states.  All visible text uses i18n.  Contact and group
 * lists are bounded.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Empty, Input, List, Modal, Spin, Tag, Typography } from 'antd';
import { AlertCircle, Ban, Check, ChevronRight, RotateCcw, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import { MobileAvatar } from '../components/MobileAvatar';
import { MobileNotice } from '../components/MobileNotice';
import { useGroupStore } from '../features/group/groupStore';
import { projectGroupConversations, type GroupConversation } from '../features/group/groupProjection';
import { formatSocialError, useSocialStore } from '../features/social/socialStore';
import { projectConversations, projectOutgoingRequests, projectPendingInboundRequests } from '../features/social/socialProjection';
import type { ActorSearchResult, SocialConversation } from '../features/social/socialTypes';
import {
  dispatchSendFriendRequest,
  dispatchAcceptFriendRequest,
  dispatchRejectFriendRequest,
  dispatchCreateGroup,
} from '../features/social/contactCommands';
import { dispatchBlockUser, dispatchUnblockUser } from '../features/chat/chatCommands';

const { Text } = Typography;
/** Maximum contacts to render before windowing trims. */
const CONTACT_WINDOW_SIZE = 100;

interface ContactsPageProps {
  onOpenChat?: () => void;
}

export function ContactsPage({ onOpenChat }: ContactsPageProps) {
  const { t } = useMobileI18n();

  // --- Local UI state ---
  const [addOpen, setAddOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedGroupMemberPtids, setSelectedGroupMemberPtids] = useState<string[]>([]);
  const [selectedContact, setSelectedContact] = useState<SocialConversation | null>(null);
  const [localActionError, setLocalActionError] = useState('');

  // --- Narrow store selectors ---
  const currentUserPtid = useSocialStore((s) => s.currentUserPtid);
  const friendRequests = useSocialStore((s) => s.friendRequests);
  const loading = useSocialStore((s) => s.loading);
  const error = useSocialStore((s) => s.error);
  const clearSocialError = useSocialStore((s) => s.clearError);
  const selectSession = useSocialStore((s) => s.selectSession);
  const loadPeerProfile = useSocialStore((s) => s.loadPeerProfile);
  const loadFriendshipStatus = useSocialStore((s) => s.loadFriendshipStatus);
  const peerProfiles = useSocialStore((s) => s.peerProfiles);
  const peerProfileLoading = useSocialStore((s) => s.peerProfileLoading);
  const peerProfileErrors = useSocialStore((s) => s.peerProfileErrors);
  const friendshipStatus = useSocialStore((s) => s.friendshipStatus);
  const peopleResults = useSocialStore((s) => s.peopleSearchResults);
  const peopleSearching = useSocialStore((s) => s.peopleSearchLoading);
  const peopleError = useSocialStore((s) => s.peopleSearchError);
  const searchPeople = useSocialStore((s) => s.searchPeople);
  const clearPeopleSearch = useSocialStore((s) => s.clearPeopleSearch);
  const selectGroup = useGroupStore((s) => s.selectGroup);
  const groupLoading = useGroupStore((s) => s.loading);
  const groupError = useGroupStore((s) => s.error);
  const clearGroupError = useGroupStore((s) => s.clearError);

  // --- Projection data ---
  const sessions = useSocialStore((s) => s.sessions);
  const messages = useSocialStore((s) => s.messages);
  const peerOnline = useSocialStore((s) => s.peerOnline);
  const groupItems = useGroupStore((s) => s.groups);
  const groupMessages = useGroupStore((s) => s.messages);
  const groupUnreadCounts = useGroupStore((s) => s.unreadCounts);

  const contacts = useMemo(
    () => projectConversations({ sessions, messages, currentUserPtid, peerOnline }),
    [currentUserPtid, messages, peerOnline, sessions],
  );
  const groups = useMemo(
    () => projectGroupConversations({ groups: groupItems, messages: groupMessages, unreadCounts: groupUnreadCounts }),
    [groupItems, groupMessages, groupUnreadCounts],
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
    () => new Set(friendRequests.map((r) => r.receiverPtid || r.senderPtid).filter(Boolean)),
    [friendRequests],
  );
  const contactPtids = useMemo(
    () => new Set(contacts.map((c) => c.peerPtid).filter(Boolean)),
    [contacts],
  );

  // --- Bounded windowing ---
  const windowedContacts = filteredContacts.length > CONTACT_WINDOW_SIZE ? filteredContacts.slice(0, CONTACT_WINDOW_SIZE) : filteredContacts;
  const windowedGroups = filteredGroups.length > CONTACT_WINDOW_SIZE ? filteredGroups.slice(0, CONTACT_WINDOW_SIZE) : filteredGroups;

  // --- Alphabetical grouping for contacts ---
  const groupedContacts = useMemo(() => {
    const map = new Map<string, SocialConversation[]>();
    windowedContacts.forEach((c) => {
      const letter = (c.peerName || '?')[0].toUpperCase();
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [windowedContacts]);

  // --- Selected contact profile ---
  const selectedProfile = selectedContact ? peerProfiles[selectedContact.peerPtid] : null;
  const selectedProfileLoading = selectedContact ? Boolean(peerProfileLoading[selectedContact.peerPtid]) : false;
  const selectedProfileError = selectedContact ? peerProfileErrors[selectedContact.peerPtid] : null;
  const selectedBlocked = selectedContact ? Boolean(friendshipStatus[selectedContact.peerPtid]?.blocked) : false;

  // --- Side effects ---
  useEffect(() => {
    if (selectedContact?.peerPtid) {
      void loadPeerProfile(selectedContact.peerPtid);
      void loadFriendshipStatus(selectedContact.peerPtid).catch(() => undefined);
    }
  }, [loadFriendshipStatus, loadPeerProfile, selectedContact?.peerPtid]);

  // --- Command dispatchers ---
  const closeFindPeople = () => { setAddOpen(false); setPeopleQuery(''); clearPeopleSearch(); };

  const sendRequestToResult = async (result: ActorSearchResult) => {
    const receiverPtid = result.ptid;
    if (!receiverPtid) return;
    setLocalActionError('');
    try {
      await dispatchSendFriendRequest(receiverPtid, '');
      await searchPeople(peopleQuery);
    } catch (err) {
      setLocalActionError(t('mobile.contacts.requestFailed'));
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    setLocalActionError('');
    try { await dispatchAcceptFriendRequest(requestId); } catch { setLocalActionError(t('mobile.contacts.requestFailed')); }
  };

  const handleRejectRequest = async (requestId: string) => {
    setLocalActionError('');
    try { await dispatchRejectFriendRequest(requestId); } catch { setLocalActionError(t('mobile.contacts.requestFailed')); }
  };

  const openContactChat = async (contact: SocialConversation) => {
    await selectGroup(null);
    await selectSession(contact.session.ulid);
    setSelectedContact(null);
    onOpenChat?.();
  };

  const openGroupChat = async (group: GroupConversation) => {
    await selectSession(null);
    await selectGroup(group.group.ulid);
    onOpenChat?.();
  };

  const confirmBlockSelectedContact = () => {
    if (!selectedContact) return;
    Modal.confirm({
      title: t('mobile.contacts.blockConfirmTitle'), content: t('mobile.contacts.blockConfirmBody'),
      okText: t('mobile.contacts.block'), cancelText: t('common.action.cancel'), okButtonProps: { danger: true },
      onOk: async () => { await dispatchBlockUser(selectedContact.peerPtid); setSelectedContact(null); },
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

  const closeCreateGroup = () => { setCreateGroupOpen(false); setGroupName(''); setGroupDescription(''); setSelectedGroupMemberPtids([]); };

  const toggleInitialGroupMember = (ptid: string, checked: boolean) => {
    setSelectedGroupMemberPtids((current) => checked ? [...new Set([...current, ptid])] : current.filter((i) => i !== ptid));
  };

  const submitCreateGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    setLocalActionError('');
    try {
      const groupUlid = await dispatchCreateGroup({
        name, description: groupDescription.trim(), initialMemberPtids: selectedGroupMemberPtids,
      });
      closeCreateGroup();
      if (groupUlid) {
        await selectSession(null);
        await selectGroup(groupUlid);
        onOpenChat?.();
      }
    } catch {
      setLocalActionError(t('mobile.group.operationCreateFailed'));
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="header-title">{t('mobile.contacts.title')}</h1>
        <button className="header-action" type="button" onClick={() => setAddOpen(true)} aria-label={t('mobile.contacts.findPeople')}>
          <UserPlus size={20} />
        </button>
      </header>

      <div className="chat-search-bar">
        <Input value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} prefix={<Search size={16} color="#9ca0ab" />} placeholder={t('mobile.contacts.searchPlaceholder')} allowClear />
      </div>

      {localActionError ? <MobileNotice onClose={() => setLocalActionError('')}>{localActionError}</MobileNotice> : null}
      {error ? <MobileNotice onClose={clearSocialError}>{formatSocialError(error)}</MobileNotice> : null}
      {groupError ? <MobileNotice onClose={clearGroupError}>{formatSocialError(groupError)}</MobileNotice> : null}

      <section className="contacts-body">
        <Spin spinning={(loading || groupLoading) && windowedContacts.length === 0 && windowedGroups.length === 0 && inboundRequests.length === 0 && sentRequests.length === 0}>
          {/* --- Friend requests --- */}
          {inboundRequests.length > 0 ? (
            <div className="contact-section">
              <div className="section-header"><span>{t('mobile.contacts.friendRequests')}</span></div>
              <List dataSource={inboundRequests} renderItem={(request) => (
                <List.Item className="contact-item friend-request-item" actions={[
                  <Button key="accept" type="primary" icon={<Check size={14} />} onClick={() => handleAcceptRequest(request.requestId)} />,
                  <Button key="reject" icon={<X size={14} />} onClick={() => handleRejectRequest(request.requestId)} />,
                ]}>
                  <List.Item.Meta
                    avatar={<MobileAvatar src={request.senderAvatar}>{displayPeerName(request.senderDisplayName, t).slice(0, 1)}</MobileAvatar>}
                    title={<Text strong>{displayPeerName(request.senderDisplayName, t)}</Text>}
                    description={request.message || t('mobile.contacts.defaultRequestMessage')}
                  />
                </List.Item>
              )} />
            </div>
          ) : null}

          {/* --- Groups section (prototype order: groups before contacts) --- */}
          {windowedGroups.length > 0 ? (
            <div className="contact-section">
              <div className="section-header"><span>{t('mobile.group.title')}</span></div>
              <div className="group-list">
                {windowedGroups.map((group) => (
                  <div key={group.group.ulid} className="group-item" onClick={() => openGroupChat(group)}>
                    <MobileAvatar src={group.group.avatarCid} size={44} icon={<Users size={16} />}>{group.group.name.slice(0, 1)}</MobileAvatar>
                    <div className="group-info">
                      <Text strong>{group.group.name}</Text>
                      <Text type="secondary">{t('mobile.group.memberCount', { count: group.group.memberCount })}</Text>
                    </div>
                    <ChevronRight size={18} color="#9ca0ab" />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* --- Contacts section with alphabetical letter grouping --- */}
          <div className="contact-section">
            <div className="section-header"><span>{t('mobile.contacts.friends')}</span></div>
            {groupedContacts.length > 0 ? (
              <div className="contact-list">
                {groupedContacts.map(([letter, letterContacts]) => (
                  <div key={letter}>
                    <div className="contact-letter">{letter}</div>
                    {letterContacts.map((contact) => (
                      <div key={contact.session.ulid} className="contact-item-row" onClick={() => setSelectedContact(contact)}>
                        <span className="conversation-avatar-frame">
                          <MobileAvatar src={contact.peerAvatar} size={44}>{contact.peerName.slice(0, 1)}</MobileAvatar>
                          {contact.peerOnline ? <span className="conversation-online-dot" aria-hidden="true" /> : null}
                        </span>
                        <div className="contact-info">
                          <Text strong>{contact.peerName}</Text>
                          <Text type="secondary">{contact.peerOnline ? t('mobile.social.online') : t('mobile.social.offline')}</Text>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
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
              <List dataSource={sentRequests} renderItem={(request) => (
                <List.Item className="contact-item">
                  <List.Item.Meta
                    avatar={<MobileAvatar src={request.receiverAvatar}>{displayPeerName(request.receiverDisplayName, t).slice(0, 1)}</MobileAvatar>}
                    title={<Text strong>{displayPeerName(request.receiverDisplayName, t)}</Text>}
                    description={t('mobile.contacts.waitingForAccept')}
                  />
                  <Tag color="processing">{t('mobile.contacts.requestPending')}</Tag>
                </List.Item>
              )} />
            </div>
          ) : null}
        </Spin>
      </section>

      {/* --- Find People modal --- */}
      <Modal title={t('mobile.contacts.findPeople')} open={addOpen} footer={null} onCancel={closeFindPeople} destroyOnClose>
        <div className="find-people-modal">
          <Input.Search
            value={peopleQuery}
            onChange={(e) => { setPeopleQuery(e.target.value); if (!e.target.value.trim()) clearPeopleSearch(); }}
            onSearch={searchPeople}
            placeholder={t('mobile.contacts.findPeoplePlaceholder')}
            enterButton={t('mobile.contacts.search')}
            loading={peopleSearching}
            allowClear
          />
          {peopleError ? <MobileNotice onClose={clearPeopleSearch}>{formatSocialError(peopleError)}</MobileNotice> : null}
          <Spin spinning={peopleSearching && peopleResults.length === 0}>
            <div className="people-result-list">
              {peopleResults.length > 0 ? (
                peopleResults.map((result) => {
                  const receiverPtid = result.ptid;
                  const isSelf = !!currentUserPtid && receiverPtid === currentUserPtid;
                  const alreadyPending = pendingTargetPtids.has(receiverPtid);
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
                      <Button type="primary" size="small" disabled={isSelf || alreadyPending || alreadyFriend} onClick={() => sendRequestToResult(result)}>
                        {isSelf ? t('mobile.contacts.self')
                          : alreadyFriend ? t('mobile.contacts.alreadyFriend')
                          : alreadyPending ? t('mobile.contacts.requestSent')
                          : t('mobile.contacts.sendRequest')}
                      </Button>
                    </div>
                  );
                })
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={
                  peopleQuery
                    ? t('mobile.contacts.noPeopleResults')
                    : t('mobile.contacts.findPeopleHint')
                } />
              )}
            </div>
          </Spin>
        </div>
      </Modal>

      {/* --- Create Group modal --- */}
      <Modal title={t('mobile.group.create')} open={createGroupOpen} onCancel={closeCreateGroup}
        onOk={submitCreateGroup} okText={t('mobile.group.create')} cancelText={t('common.action.cancel')}
        okButtonProps={{ disabled: !groupName.trim() }} destroyOnClose>
        <div className="group-create-form">
          <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t('mobile.group.namePlaceholder')} />
          <Input.TextArea value={groupDescription} onChange={(e) => setGroupDescription(e.target.value)} placeholder={t('mobile.group.descriptionPlaceholder')} autoSize={{ minRows: 2, maxRows: 4 }} />
          <SectionTitle title={t('mobile.group.initialMembers')} count={selectedGroupMemberPtids.length} />
          {contacts.length > 0 ? (
            <List dataSource={contacts} renderItem={(contact) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<MobileAvatar src={contact.peerAvatar}>{contact.peerName.slice(0, 1)}</MobileAvatar>}
                  title={<Text strong>{contact.peerName}</Text>}
                  description={<Text type="secondary" copyable>{contact.peerPtid}</Text>}
                />
                <Checkbox checked={selectedGroupMemberPtids.includes(contact.peerPtid)} onChange={(e) => toggleInitialGroupMember(contact.peerPtid, e.target.checked)} />
              </List.Item>
            )} />
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noInitialMembers')} />}
        </div>
      </Modal>

      {/* --- Contact profile modal --- */}
      <Modal title={t('mobile.contacts.profile')} open={Boolean(selectedContact)} onCancel={() => setSelectedContact(null)} footer={null} destroyOnClose>
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
            <Button type="primary" block disabled={selectedBlocked} onClick={() => openContactChat(selectedContact)}>
              {t('mobile.contacts.openChat')}
            </Button>
            {selectedBlocked ? (
              <Button block icon={<RotateCcw size={14} />} onClick={confirmUnblockSelectedContact}>{t('mobile.contacts.unblock')}</Button>
            ) : (
              <Button block danger icon={<Ban size={14} />} onClick={confirmBlockSelectedContact}>{t('mobile.contacts.block')}</Button>
            )}
          </div>
        ) : null}
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
