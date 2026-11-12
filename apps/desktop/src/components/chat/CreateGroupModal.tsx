import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert as PtAlert,
  Button as PtButton,
  Checkbox as PtCheckbox,
  Dialog,
  Spin as PtSpin,
  TextField as PtTextField,
} from '@peers-touch/ui';
import { Search } from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import {
  chatActorIdentityMetadata,
  projectChatFriendContacts,
  type ChatActorIdentityProjection,
} from '../../store/friendshipProjection';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { imServiceV1 } from '../../services/im-service';
import { log } from '../../utils/logger';
import { ChatActorIdentityRow } from './ChatActorIdentityRow';
import { PresentedErrorAlert } from '../common/PresentedErrorAlert';
import { presentError, type PresentedError } from '../../services/errorPresenter';
import { mapChatError } from '../../services/errorMappings/chatErrorMapping';
import { notifyInfo, notifySuccess } from '../../ui/feedback';
import {
  useActiveChatFederationSlice,
  useActiveChatSessionSlice,
  useActiveSocialChatSlice,
} from './useActiveSocialChatStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

function getFirstLetter(name: string): string {
  if (!name) return '#';
  const first = name.trim().charAt(0).toUpperCase();
  if (/[A-Z]/.test(first)) return first;
  return '#';
}

export function CreateGroupModal({ open, onClose }: Props) {
  const { t } = useTranslation('chat');
  const {
    friendRequests,
    friendRequestsLoading,
    friendRequestsLoadedAt,
    friendRequestsError,
    currentUserPtid,
    conversationRecords,
    conversationMembers,
    groupMembers,
    peerProfiles,
    loadGroups,
    selectGroup,
    setActiveTab,
    getIMConversations,
    trackPendingGroupCreation,
  } = useActiveSocialChatSlice((s) => ({
    friendRequests: s.friendRequests,
    friendRequestsLoading: s.friendRequestsLoading,
    friendRequestsLoadedAt: s.friendRequestsLoadedAt,
    friendRequestsError: s.friendRequestsError,
    currentUserPtid: s.currentUserPtid,
    conversationRecords: s.conversations,
    conversationMembers: s.conversationMembers,
    groupMembers: s.groupMembers,
    peerProfiles: s.peerProfiles,
    loadGroups: s.loadGroups,
    selectGroup: s.selectGroup,
    setActiveTab: s.setActiveTab,
    getIMConversations: s.getIMConversations,
    trackPendingGroupCreation: s.trackPendingGroupCreation,
  }));
  const federations = useActiveChatFederationSlice((s) => s.federations);
  const sessionActorPtid = useActiveChatSessionSlice((s) => s.currentUser?.actorPtid ?? null);
  const ownDid = currentUserPtid || sessionActorPtid;
  const friendshipReady = Boolean(
    ownDid
    && friendRequestsLoadedAt,
  );

  const [searchText, setSearchText] = useState('');
  const [selectedDids, setSelectedDids] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [creationError, setCreationError] = useState<PresentedError | null>(null);
  const [draftConversationId, setDraftConversationId] = useState<string | null>(null);

  const contacts = useMemo(() => {
    if (!ownDid) return [];
    void conversationRecords;
    void conversationMembers;
    void groupMembers;
    return projectChatFriendContacts({
      conversations: getIMConversations(),
      friendRequests,
      peerProfiles,
      currentUserPtid: ownDid,
      federations,
    });
  }, [
    conversationMembers,
    conversationRecords,
    federations,
    friendRequests,
    getIMConversations,
    groupMembers,
    ownDid,
    peerProfiles,
    t,
  ]);

  const selectedContacts = useMemo(() => {
    return contacts.filter((contact) => selectedDids.has(contact.actorPtid));
  }, [contacts, selectedDids]);

  const filteredContacts = useMemo(() => {
    let result = contacts;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = contacts.filter(
        (contact) => [
          contact.displayName,
          contact.username,
          contact.actorPtid,
          contact.federatedHandle,
          contact.homeStationDomain,
          contact.homeStationPeerId,
          contact.federationId,
          contact.federationName,
        ].some((value) => value.toLowerCase().includes(q)),
      );
    }
    const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
    return [...result].sort((a, b) => {
      const letterA = getFirstLetter(a.displayName);
      const letterB = getFirstLetter(b.displayName);
      if (letterA === '#' && letterB !== '#') return 1;
      if (letterA !== '#' && letterB === '#') return -1;
      if (letterA !== letterB) return letterA.localeCompare(letterB);
      const nameOrder = collator.compare(a.displayName, b.displayName);
      return nameOrder || a.actorPtid.localeCompare(b.actorPtid);
    });
  }, [contacts, searchText]);

  const groupedContacts = useMemo(() => {
    const groups = new Map<string, ChatActorIdentityProjection[]>();
    for (const contact of filteredContacts) {
      const letter = getFirstLetter(contact.displayName);
      if (!groups.has(letter)) {
        groups.set(letter, []);
      }
      groups.get(letter)!.push(contact);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === '#' && b !== '#') return 1;
      if (a !== '#' && b === '#') return -1;
      return a.localeCompare(b);
    });
  }, [filteredContacts]);

  const toggleSelect = useCallback((did: string) => {
    setSelectedDids((prev) => {
      const next = new Set(prev);
      if (next.has(did)) {
        next.delete(did);
      } else {
        next.add(did);
      }
      return next;
    });
  }, []);

  const removeSelected = useCallback((did: string) => {
    setSelectedDids((prev) => {
      const next = new Set(prev);
      next.delete(did);
      return next;
    });
  }, []);

  const handleFinish = async () => {
    if (!ownDid) return;
    if (selectedDids.size === 0) return;
    setCreating(true);
    setCreationError(null);

    const memberPtids = Array.from(selectedDids).filter((did) => did !== ownDid);
    if (memberPtids.length === 0) { setCreating(false); return; }
    const selectedFederationIds = new Set(
      selectedContacts.map(contact => contact.federationId),
    );
    if (
      selectedContacts.length !== memberPtids.length
      || selectedContacts.some(contact => !contact.federationId)
      || selectedFederationIds.size !== 1
    ) {
      setCreating(false);
      setCreationError({
        code: 'chat.groupFederationUnavailable',
        title: t('chat.social.createGroup.failed'),
        message: t('chat.social.createGroup.invalidFederation'),
        severity: 'error',
        recoverable: true,
      });
      return;
    }
    const [federationId] = selectedFederationIds;

    const namesByDid = new Map(contacts.map((contact) => [
      contact.actorPtid,
      contact.displayName,
    ]));
    const groupName =
      memberPtids.length <= 3
        ? memberPtids.map((d) => namesByDid.get(d) ?? d.slice(0, 8)).join(', ')
        : t('chat.social.createGroup.defaultName', { count: memberPtids.length + 1 });

    const conversationId = draftConversationId ?? crypto.randomUUID();
    setDraftConversationId(conversationId);
    try {
      const created = await imServiceV1.messaging.createGroup(
        conversationId,
        groupName,
        memberPtids,
        federationId,
      );
      if (created.state === 'failed') {
        setCreationError({
          code: 'chat.createGroupFailed',
          title: t('chat.social.createGroup.failed'),
          message: t('chat.social.createGroup.failed'),
          severity: 'error',
          recoverable: true,
        });
        return;
      }
      useSocialChatStore.getState().setGroupSecurityState(conversationId, 'establishing');
      trackPendingGroupCreation(conversationId, created.commandId);
      setActiveTab('group');
      selectGroup(conversationId);
      handleClose();
      void loadGroups().then(() => {
        const projectionReady = useSocialChatStore.getState().conversations.some(
          conversation => conversation.conversationId === conversationId,
        );
        if (projectionReady) {
          notifySuccess(t('chat.social.createGroup.success'));
        }
      }).catch((error) => {
        log.warn('chat', 'createGroup accepted; projection reconcile pending', {
          conversationId,
          error,
        });
      });
      if (created.state === 'pending') {
        notifyInfo(t('chat.social.createGroup.accepted'));
      }
    } catch (err) {
      log.error('chat', 'createGroup failed', { conversationId, error: err });
      setCreationError(presentError(err, {
        mode: 'inline',
        mapper: mapChatError,
        context: { operation: 'createGroup' },
      }));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setSearchText('');
    setSelectedDids(new Set());
    setCreationError(null);
    setDraftConversationId(null);
    onClose();
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onDismiss={() => {
        if (!creating) handleClose();
      }}
      title={t('chat.social.createGroup.title')}
      width={640}
      closeLabel={t('common.action.cancel', { ns: 'common' })}
      dismissOutside
      contentStyle={{ padding: 0, height: '72vh', maxHeight: 580 }}
      footer={
        <>
          <PtButton
            actionId="create-group-cancel"
            data-chat-create-group-close
            onActivate={handleClose}
            availability={creating
              ? { kind: 'disabled', reason: t('common.state.loading', { ns: 'common' }) }
              : undefined}
          >
            {t('common.action.cancel', { ns: 'common' })}
          </PtButton>
          <PtButton
            actionId="create-group-submit"
            data-chat-create-group-submit
            data-chat-create-group-retry={creationError ? 'true' : 'false'}
            emphasis="primary"
            execution={creating ? 'pending' : 'idle'}
            onActivate={handleFinish}
            availability={selectedDids.size === 0
              ? { kind: 'disabled', reason: t('chat.social.createGroup.selectHint') }
              : undefined}
          >
            {creationError
              ? t('chat.social.createGroup.retry')
              : t('chat.social.createGroup.finish')}
          </PtButton>
        </>
      }
    >
      <div
        className="sc-create-group"
        data-chat-create-group
        data-chat-friendship-state={
          friendRequestsError ? 'error' : friendshipReady ? 'ready' : 'loading'
        }
        data-chat-create-group-state={
          creating ? 'creating' : creationError ? 'failed' : 'editing'
        }
      >
        {/* Left panel — contacts */}
        <div className="sc-create-group__contacts">
          <div className="sc-create-group__search">
            <PtTextField
              data-chat-create-group-search
              leading={<Search size={14} />}
              clearable
              onClear={() => setSearchText('')}
              placeholder={t('chat.social.createGroup.searchContacts')}
              value={searchText}
              onValueChange={setSearchText}
              aria-label={t('chat.social.createGroup.searchContacts')}
            />
          </div>

          <div className="sc-create-group__list">
            {friendRequestsError ? (
              <div className="sc-create-group__alert">
                <PtAlert tone="danger" title={t('chat.social.findPeople.friendshipUnavailable')} />
              </div>
            ) : !friendshipReady && friendRequestsLoading ? (
              <div className="sc-create-group__center">
                <PtSpin size="small" />
              </div>
            ) : filteredContacts.length === 0 ? (
              <div className="sc-create-group__center">
                <span className="sc-create-group__hint">{t('chat.social.createGroup.noContacts')}</span>
              </div>
            ) : (
              groupedContacts.map(([letter, items]) => (
                <div key={letter}>
                  <div className="sc-create-group__letter">{letter}</div>
                  {items.map((contact) => {
                    const selected = selectedDids.has(contact.actorPtid);
                    return (
                      <label
                        key={contact.actorPtid}
                        className={`sc-create-group__contact${selected ? ' is-selected' : ''}`}
                        data-chat-create-group-contact={contact.actorPtid}
                        data-chat-contact-ptid={contact.actorPtid}
                        data-chat-contact-federated-handle={contact.federatedHandle}
                        data-chat-contact-home-station-domain={contact.homeStationDomain}
                        data-chat-contact-home-station-peer-id={contact.homeStationPeerId}
                        data-chat-contact-federation-id={contact.federationId}
                        data-chat-contact-avatar-src={contact.avatarUrl}
                      >
                        <PtCheckbox
                          className="sc-create-group__check"
                          checked={selected}
                          aria-label={`${contact.displayName}, ${chatActorIdentityMetadata(contact)}`}
                          onCheckedChange={() => toggleSelect(contact.actorPtid)}
                        />
                        <ChatActorIdentityRow
                          identity={contact}
                          avatarSize={34}
                        />
                      </label>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right panel — selected participants */}
        <div className="sc-create-group__panel">
          <div className="sc-create-group__selected">
            {creationError ? (
              <div className="sc-create-group__error" data-chat-create-group-error>
                <PresentedErrorAlert
                  error={creationError}
                  onClose={() => setCreationError(null)}
                />
              </div>
            ) : null}
            {selectedContacts.length === 0 ? (
              <div className="sc-create-group__center">
                <span className="sc-create-group__hint">{t('chat.social.createGroup.selectHint')}</span>
              </div>
            ) : (
              <div className="sc-create-group__chips">
                {selectedContacts.map((contact) => (
                  <div
                    key={contact.actorPtid}
                    className="sc-create-group__chip"
                    title={chatActorIdentityMetadata(contact)}
                  >
                    <div
                      className="sc-create-group__chip-remove"
                      onClick={() => removeSelected(contact.actorPtid)}
                    >
                      <UserSquareAvatar
                        remoteUrl={contact.avatarUrl}
                        name={contact.displayName}
                        size={42}
                        radius={4}
                      />
                    </div>
                    <span className="sc-create-group__chip-name">{contact.displayName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
