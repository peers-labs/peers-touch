import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Empty, Input, List, Modal, Spin, Tag, Typography } from 'antd';
import { Ban, Check, RotateCcw, Search, ShieldCheck, UserPlus, Users, X } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import { MobileAvatar } from '../components/MobileAvatar';
import { MobileNotice } from '../components/MobileNotice';
import { useGroupStore } from '../features/group/groupStore';
import { projectGroupConversations, type GroupConversation } from '../features/group/groupProjection';
import {
  formatSocialError,
  useSocialStore,
} from '../features/social/socialStore';
import { projectConversations, projectOutgoingRequests, projectPendingInboundRequests } from '../features/social/socialProjection';
import type { ActorSearchResult, SocialConversation } from '../features/social/socialTypes';

const { Text } = Typography;

interface ContactsPageProps {
  onOpenChat?: () => void;
}

export function ContactsPage({ onOpenChat }: ContactsPageProps) {
  const { t } = useMobileI18n();
  const [addOpen, setAddOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [selectedGroupMemberDids, setSelectedGroupMemberDids] = useState<string[]>([]);
  const [selectedContact, setSelectedContact] = useState<SocialConversation | null>(null);
  const currentUserDid = useSocialStore((state) => state.currentUserDid);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const loading = useSocialStore((state) => state.loading);
  const error = useSocialStore((state) => state.error);
  const clearSocialError = useSocialStore((state) => state.clearError);
  const acceptFriendRequest = useSocialStore((state) => state.acceptFriendRequest);
  const rejectFriendRequest = useSocialStore((state) => state.rejectFriendRequest);
  const sendFriendRequest = useSocialStore((state) => state.sendFriendRequest);
  const selectSession = useSocialStore((state) => state.selectSession);
  const loadPeerProfile = useSocialStore((state) => state.loadPeerProfile);
  const loadFriendshipStatus = useSocialStore((state) => state.loadFriendshipStatus);
  const blockUser = useSocialStore((state) => state.blockUser);
  const unblockUser = useSocialStore((state) => state.unblockUser);
  const peerProfiles = useSocialStore((state) => state.peerProfiles);
  const peerProfileLoading = useSocialStore((state) => state.peerProfileLoading);
  const peerProfileErrors = useSocialStore((state) => state.peerProfileErrors);
  const friendshipStatus = useSocialStore((state) => state.friendshipStatus);
  const peopleResults = useSocialStore((state) => state.peopleSearchResults);
  const peopleSearching = useSocialStore((state) => state.peopleSearchLoading);
  const peopleError = useSocialStore((state) => state.peopleSearchError);
  const searchPeople = useSocialStore((state) => state.searchPeople);
  const clearPeopleSearch = useSocialStore((state) => state.clearPeopleSearch);
  const selectGroup = useGroupStore((state) => state.selectGroup);
  const createGroup = useGroupStore((state) => state.createGroup);
  const groupLoading = useGroupStore((state) => state.loading);
  const groupError = useGroupStore((state) => state.error);
  const clearGroupError = useGroupStore((state) => state.clearError);
  const sessions = useSocialStore((state) => state.sessions);
  const messages = useSocialStore((state) => state.messages);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const groupItems = useGroupStore((state) => state.groups);
  const groupMessages = useGroupStore((state) => state.messages);
  const groupUnreadCounts = useGroupStore((state) => state.unreadCounts);
  const contacts = useMemo(
    () => projectConversations({ sessions, messages, currentUserDid, peerOnline }),
    [currentUserDid, messages, peerOnline, sessions],
  );
  const groups = useMemo(
    () => projectGroupConversations({ groups: groupItems, messages: groupMessages, unreadCounts: groupUnreadCounts }),
    [groupItems, groupMessages, groupUnreadCounts],
  );
  const inboundRequests = useMemo(
    () => projectPendingInboundRequests(friendRequests, currentUserDid),
    [currentUserDid, friendRequests],
  );
  const sentRequests = useMemo(
    () => projectOutgoingRequests(friendRequests, currentUserDid),
    [currentUserDid, friendRequests],
  );
  const filteredContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter((contact) =>
      `${contact.peerName} ${contact.peerDid}`.toLowerCase().includes(query),
    );
  }, [contactQuery, contacts]);
  const filteredGroups = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) =>
      `${group.group.name} ${group.group.ulid} ${group.lastMessage?.content ?? ''}`.toLowerCase().includes(query),
    );
  }, [contactQuery, groups]);
  const pendingTargetDids = useMemo(
    () => new Set(friendRequests.map((request) => request.receiverDid || request.senderDid).filter(Boolean)),
    [friendRequests],
  );
  const contactDids = useMemo(
    () => new Set(contacts.map((contact) => contact.peerDid).filter(Boolean)),
    [contacts],
  );
  const selectedProfile = selectedContact ? peerProfiles[selectedContact.peerDid] : null;
  const selectedProfileLoading = selectedContact ? Boolean(peerProfileLoading[selectedContact.peerDid]) : false;
  const selectedProfileError = selectedContact ? peerProfileErrors[selectedContact.peerDid] : null;
  const selectedBlocked = selectedContact ? Boolean(friendshipStatus[selectedContact.peerDid]?.blocked) : false;

  useEffect(() => {
    if (selectedContact?.peerDid) {
      void loadPeerProfile(selectedContact.peerDid);
      void loadFriendshipStatus(selectedContact.peerDid).catch(() => undefined);
    }
  }, [loadFriendshipStatus, loadPeerProfile, selectedContact?.peerDid]);

  const closeFindPeople = () => {
    setAddOpen(false);
    setPeopleQuery('');
    clearPeopleSearch();
  };

  const sendRequestToResult = async (result: ActorSearchResult) => {
    const receiverDid = result.actorId || result.id;
    if (!receiverDid) return;
    await sendFriendRequest(receiverDid, '');
    await searchPeople(peopleQuery);
  };

  const openContactChat = async (contact: SocialConversation) => {
    await selectGroup(null);
    await selectSession(contact.session.ulid);
    setSelectedContact(null);
    onOpenChat?.();
  };

  const confirmBlockSelectedContact = () => {
    if (!selectedContact) return;
    Modal.confirm({
      title: t('mobile.contacts.blockConfirmTitle'),
      content: t('mobile.contacts.blockConfirmBody'),
      okText: t('mobile.contacts.block'),
      cancelText: t('common.action.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await blockUser(selectedContact.peerDid);
        setSelectedContact(null);
      },
    });
  };

  const confirmUnblockSelectedContact = () => {
    if (!selectedContact) return;
    Modal.confirm({
      title: t('mobile.contacts.unblockConfirmTitle'),
      content: t('mobile.contacts.unblockConfirmBody'),
      okText: t('mobile.contacts.unblock'),
      cancelText: t('common.action.cancel'),
      onOk: async () => {
        await unblockUser(selectedContact.peerDid);
      },
    });
  };

  const openGroupChat = async (group: GroupConversation) => {
    await selectSession(null);
    await selectGroup(group.group.ulid);
    onOpenChat?.();
  };

  const closeCreateGroup = () => {
    setCreateGroupOpen(false);
    setGroupName('');
    setGroupDescription('');
    setSelectedGroupMemberDids([]);
  };

  const toggleInitialGroupMember = (did: string, checked: boolean) => {
    setSelectedGroupMemberDids((current) =>
      checked ? [...new Set([...current, did])] : current.filter((item) => item !== did),
    );
  };

  const submitCreateGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    const groupUlid = await createGroup({
      name,
      description: groupDescription.trim(),
      initialMemberDids: selectedGroupMemberDids,
    });
    closeCreateGroup();
    if (groupUlid) {
      await selectSession(null);
      await selectGroup(groupUlid);
      onOpenChat?.();
    }
  };

  return (
    <div className="page-container">
      <header className="page-header">
        <h1 className="header-title">{t('mobile.contacts.title')}</h1>
      </header>

      <div className="contacts-toolbar">
        <Input
          className="contacts-search-input"
          value={contactQuery}
          onChange={(event) => setContactQuery(event.target.value)}
          prefix={<Search size={16} />}
          placeholder={t('mobile.contacts.searchPlaceholder')}
          allowClear
        />
        <button className="contacts-add-button" type="button" onClick={() => setCreateGroupOpen(true)} aria-label={t('mobile.group.create')}>
          <Users size={20} />
        </button>
        <button className="contacts-add-button" type="button" onClick={() => setAddOpen(true)} aria-label={t('mobile.contacts.findPeople')}>
          <UserPlus size={20} />
        </button>
      </div>

      {error ? (
        <MobileNotice onClose={clearSocialError}>{formatSocialError(error)}</MobileNotice>
      ) : null}
      {groupError ? (
        <MobileNotice onClose={clearGroupError}>{formatSocialError(groupError)}</MobileNotice>
      ) : null}

      <section className="social-list-panel">
        <Spin spinning={(loading || groupLoading) && filteredContacts.length === 0 && filteredGroups.length === 0 && inboundRequests.length === 0 && sentRequests.length === 0}>
          <SectionTitle title={t('mobile.contacts.friendRequests')} count={inboundRequests.length} />
          {inboundRequests.length > 0 ? (
            <List
              dataSource={inboundRequests}
              renderItem={(request) => (
                <List.Item
                  className="contact-item friend-request-item"
                  actions={[
                    <Button
                      key="accept"
                      type="primary"
                      icon={<Check size={14} />}
                      onClick={() => acceptFriendRequest(request.requestId)}
                    />,
                    <Button key="reject" icon={<X size={14} />} onClick={() => rejectFriendRequest(request.requestId)} />,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<MobileAvatar src={request.senderAvatar}>{displayPeerName(request.senderDisplayName, t).slice(0, 1)}</MobileAvatar>}
                    title={<Text strong>{displayPeerName(request.senderDisplayName, t)}</Text>}
                    description={request.message || t('mobile.contacts.defaultRequestMessage')}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.contacts.noFriendRequests')} />
          )}

          <SectionTitle title={t('mobile.contacts.friends')} count={contacts.length} />
          {filteredContacts.length > 0 ? (
            <List
              dataSource={filteredContacts}
              renderItem={(contact) => (
                <List.Item className="contact-item" onClick={() => setSelectedContact(contact)}>
                  <List.Item.Meta
                    avatar={<MobileAvatar src={contact.peerAvatar}>{contact.peerName.slice(0, 1)}</MobileAvatar>}
                    title={<Text strong>{contact.peerName}</Text>}
                    description={contact.peerOnline ? t('mobile.social.online') : t('mobile.social.offline')}
                  />
                </List.Item>
              )}
            />
          ) : contacts.length > 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.contacts.noSearchResults')} />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div className="empty-copy">
                  <Text strong>{t('mobile.contacts.emptyTitle')}</Text>
                  <Text type="secondary">{t('mobile.contacts.emptySubtitle')}</Text>
                </div>
              }
            />
          )}

          <SectionTitle title={t('mobile.group.title')} count={groups.length} />
          {filteredGroups.length > 0 ? (
            <List
              dataSource={filteredGroups}
              renderItem={(group) => (
                <List.Item className="contact-item" onClick={() => openGroupChat(group)}>
                  <List.Item.Meta
                    avatar={
                      <MobileAvatar src={group.group.avatarCid} icon={<Users size={16} />}>
                        {group.group.name.slice(0, 1)}
                      </MobileAvatar>
                    }
                    title={<Text strong>{group.group.name}</Text>}
                    description={t('mobile.group.memberCount', { count: group.group.memberCount })}
                  />
                </List.Item>
              )}
            />
          ) : groups.length > 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noSearchResults')} />
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div className="empty-copy">
                  <Text strong>{t('mobile.group.emptyTitle')}</Text>
                  <Text type="secondary">{t('mobile.group.emptySubtitle')}</Text>
                </div>
              }
            />
          )}

          {sentRequests.length > 0 ? (
            <>
              <SectionTitle title={t('mobile.contacts.sentRequests')} count={sentRequests.length} />
              <List
                dataSource={sentRequests}
                renderItem={(request) => (
                  <List.Item className="contact-item">
                    <List.Item.Meta
                      avatar={<MobileAvatar src={request.receiverAvatar}>{displayPeerName(request.receiverDisplayName, t).slice(0, 1)}</MobileAvatar>}
                      title={<Text strong>{displayPeerName(request.receiverDisplayName, t)}</Text>}
                      description={t('mobile.contacts.waitingForAccept')}
                    />
                  </List.Item>
                )}
              />
            </>
          ) : null}
        </Spin>
      </section>

      <Modal
        title={t('mobile.contacts.findPeople')}
        open={addOpen}
        footer={null}
        onCancel={closeFindPeople}
        destroyOnClose
      >
        <div className="find-people-modal">
          <Input.Search
            value={peopleQuery}
            onChange={(event) => {
              setPeopleQuery(event.target.value);
              if (!event.target.value.trim()) clearPeopleSearch();
            }}
            onSearch={searchPeople}
            placeholder={t('mobile.contacts.findPeoplePlaceholder')}
            enterButton={t('mobile.contacts.search')}
            loading={peopleSearching}
            allowClear
          />
          {peopleError ? (
            <MobileNotice onClose={clearPeopleSearch}>{formatSocialError(peopleError)}</MobileNotice>
          ) : null}
          <Spin spinning={peopleSearching && peopleResults.length === 0}>
            <div className="people-result-list">
              {peopleResults.length > 0 ? (
                peopleResults.map((result) => {
                  const receiverDid = result.actorId || result.id;
                  const isSelf = !!currentUserDid && receiverDid === currentUserDid;
                  const alreadyPending = pendingTargetDids.has(receiverDid);
                  const alreadyFriend = contactDids.has(receiverDid);
                  return (
                    <div className="people-result-card" key={receiverDid || result.username}>
                      <MobileAvatar src={result.avatar} size={42}>
                        {(result.displayName || result.username || receiverDid).slice(0, 1)}
                      </MobileAvatar>
                      <div className="people-result-copy">
                        <div className="people-result-title">
                          <Text strong ellipsis>{result.displayName || result.username || receiverDid}</Text>
                          {result.federation ? (
                            <Tag color="success" icon={<ShieldCheck size={11} />}>
                              {t('mobile.contacts.verified')}
                            </Tag>
                          ) : null}
                        </div>
                        <Text type="secondary" ellipsis>
                          {result.federation?.handle || result.username || receiverDid}
                        </Text>
                      </div>
                      <Button
                        type="primary"
                        size="small"
                        disabled={isSelf || alreadyPending || alreadyFriend}
                        onClick={() => sendRequestToResult(result)}
                      >
                        {isSelf
                          ? t('mobile.contacts.self')
                          : alreadyFriend
                            ? t('mobile.contacts.alreadyFriend')
                            : alreadyPending
                              ? t('mobile.contacts.requestSent')
                              : t('mobile.contacts.sendRequest')}
                      </Button>
                    </div>
                  );
                })
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={peopleQuery ? t('mobile.contacts.noPeopleResults') : t('mobile.contacts.findPeopleHint')}
                />
              )}
            </div>
          </Spin>
        </div>
      </Modal>

      <Modal
        title={t('mobile.group.create')}
        open={createGroupOpen}
        onCancel={closeCreateGroup}
        onOk={submitCreateGroup}
        okText={t('mobile.group.create')}
        cancelText={t('common.action.cancel')}
        okButtonProps={{ disabled: !groupName.trim() }}
        destroyOnClose
      >
        <div className="group-create-form">
          <Input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder={t('mobile.group.namePlaceholder')}
          />
          <Input.TextArea
            value={groupDescription}
            onChange={(event) => setGroupDescription(event.target.value)}
            placeholder={t('mobile.group.descriptionPlaceholder')}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <SectionTitle title={t('mobile.group.initialMembers')} count={selectedGroupMemberDids.length} />
          {contacts.length > 0 ? (
            <List
              dataSource={contacts}
              renderItem={(contact) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<MobileAvatar src={contact.peerAvatar}>{contact.peerName.slice(0, 1)}</MobileAvatar>}
                    title={<Text strong>{contact.peerName}</Text>}
                    description={<Text type="secondary" copyable>{contact.peerDid}</Text>}
                  />
                  <Checkbox
                    checked={selectedGroupMemberDids.includes(contact.peerDid)}
                    onChange={(event) => toggleInitialGroupMember(contact.peerDid, event.target.checked)}
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('mobile.group.noInitialMembers')} />
          )}
        </div>
      </Modal>

      <Modal
        title={t('mobile.contacts.profile')}
        open={Boolean(selectedContact)}
        onCancel={() => setSelectedContact(null)}
        footer={null}
        destroyOnClose
      >
        {selectedContact ? (
          <div className="contact-profile-card">
            <Spin spinning={selectedProfileLoading}>
              <MobileAvatar src={selectedProfile?.avatar || selectedContact.peerAvatar} size={64}>
                {(selectedProfile?.displayName || selectedContact.peerName).slice(0, 1)}
              </MobileAvatar>
            </Spin>
            <div className="contact-profile-copy">
              <Text strong className="contact-profile-name">{selectedProfile?.displayName || selectedContact.peerName}</Text>
              {selectedProfile?.acct || selectedProfile?.username ? (
                <Text type="secondary">{selectedProfile.acct || selectedProfile.username}</Text>
              ) : null}
              <Text type="secondary" copyable>{selectedContact.peerDid}</Text>
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
              <div className="contact-profile-tags">
                {selectedProfile.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
              </div>
            ) : null}
            {selectedProfileError ? <Text type="danger">{formatSocialError(selectedProfileError)}</Text> : null}
            {selectedBlocked ? <Tag color="error">{t('mobile.contacts.blocked')}</Tag> : null}
            <Button type="primary" block disabled={selectedBlocked} onClick={() => openContactChat(selectedContact)}>
              {t('mobile.contacts.openChat')}
            </Button>
            {selectedBlocked ? (
              <Button block icon={<RotateCcw size={14} />} onClick={confirmUnblockSelectedContact}>
                {t('mobile.contacts.unblock')}
              </Button>
            ) : (
              <Button block danger icon={<Ban size={14} />} onClick={confirmBlockSelectedContact}>
                {t('mobile.contacts.block')}
              </Button>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function ProfileStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="contact-profile-stat">
      <Text strong>{value}</Text>
      <Text type="secondary">{label}</Text>
    </div>
  );
}

function displayPeerName(name: string | undefined, t: (key: string) => string): string {
  return name?.trim() || t('mobile.contacts.unknownUser');
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="social-section-title">
      <Text strong>{title}</Text>
      <Text type="secondary">{count}</Text>
    </div>
  );
}
