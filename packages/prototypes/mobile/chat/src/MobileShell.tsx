import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useT } from './i18n';
import { Badge, Icon, IconButton } from '@peers-touch/ui';
import type {
  Contact,
  Conversation,
  GroupItem,
  IconName,
  Message,
  MobileUiEvidence,
  SettingEntry,
  TabId,
} from './types';
import {
  deliveryRecoveryMessages,
  demoConversations,
  demoMessages,
  directDemoMessages,
  unknownOutcomeMessages,
} from './data';
import {
  longListContacts,
  longListConversations,
  longListGroups,
  longListMembers,
  longListMessages,
  longListRequests,
} from './longListDemo';
import { PrototypeListMemory } from './listPresentation';
import {
  RequestRecoveryNotice,
  ShellRecoverySheet,
  SocialUnavailablePage,
  type ShellEvidenceScenario,
} from './components/ExperienceRecovery';
import { ChatPage } from './pages/ChatPage';
import { ChatThread } from './pages/ChatThread';
import {
  MomentsPage,
  preparedMoments,
  type MomentsEvidenceScenario,
} from './pages/MomentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { ProfilePage } from './pages/ProfilePage';
import { SearchPage, type SearchPresentation, type SearchTarget, type SocialSearchTarget } from './pages/SearchPage';
import { SettingDetailView } from './components/SettingDetailView';
import { FindPeopleSheet } from './components/FindPeopleSheet';
import { CreateGroupSheet } from './components/CreateGroupSheet';
import { ContactDetailView } from './components/ContactDetailView';
import { GroupDetailView } from './components/GroupDetailView';
import { MobileCallSurface } from './components/MobileCallSurface';
import type { SocialDemoAction, SocialDemoState } from './socialDemo';
import type { SearchDemoControl } from './searchDemo';
import {
  callSnapshotForScenario,
  type PrototypeCallMediaKind,
  type PrototypeCallScenario,
  type PrototypeCallSnapshot,
} from './callPrototype';

export function MobileShell({
  onChangeStation,
  recoveryScenario,
  socialScenario,
  momentsScenario,
  searchDemo,
  socialDemo,
  dispatchSocialDemo,
  longLists = false,
  uiEvidence,
  deliveryRecovery = false,
  callScenario,
  onRecoveryClose,
}: {
  stationLabel: string;
  onChangeStation: () => void;
  recoveryScenario?: ShellEvidenceScenario;
  socialScenario?: string;
  momentsScenario?: MomentsEvidenceScenario;
  searchDemo?: SearchDemoControl;
  socialDemo: SocialDemoState;
  dispatchSocialDemo: Dispatch<SocialDemoAction>;
  longLists?: boolean;
  focusChatJourney?: boolean;
  uiEvidence: MobileUiEvidence;
  deliveryRecovery?: boolean;
  onRecoveryClose?: () => void;
  callScenario?: PrototypeCallScenario;
}) {
  const t = useT();
  const [listMemory] = useState(() => new PrototypeListMemory());
  // Social evidence scenarios open straight onto the contacts surface; only the
  // chat-runtime failure scenario starts on the conversation list.
  const [activeTab, setActiveTab] = useState<TabId>(
    socialScenario && socialScenario !== 'social-unavailable' ? 'contacts' : 'chat',
  );
  const [findPeopleOpen, setFindPeopleOpen] = useState(
    socialScenario === 'find-people-member'
      || socialScenario === 'find-people-no-membership'
      || socialScenario === 'request-unknown',
  );
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(
    callScenario ? demoConversations.find((conversation) => conversation.key === 'alice') ?? null : null,
  );
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [selectedSetting, setSelectedSetting] = useState<SettingEntry | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchOrigin, setSearchOrigin] = useState<{ tab: TabId; conversation: Conversation | null }>({ tab: 'chat', conversation: null });
  const [searchView, setSearchView] = useState<SearchPresentation>({
    query: '', filter: 'all', conversationKey: '', submitted: false,
  });
  const [socialSearchTarget, setSocialSearchTarget] = useState<SocialSearchTarget | null>(null);
  const [momentsImmersiveOpen, setMomentsImmersiveOpen] = useState(false);
  const [callSnapshot, setCallSnapshot] = useState<PrototypeCallSnapshot | null>(null);
  const [shellToast, setShellToast] = useState<string | null>(null);
  const [shellToastKey, setShellToastKey] = useState(0);
  const [conversationMessages, setConversationMessages] = useState<Record<string, Message[]>>({});
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  // One-shot back intent: a thread entered from a search result returns to the
  // search overlay on its first Back, then follows normal list navigation.
  const [threadReturnToSearch, setThreadReturnToSearch] = useState(false);

  const baseConversations = longLists ? longListConversations : socialDemo.conversations;
  const conversations = uiEvidence.longContent
    ? baseConversations.map((conversation, index) => (index === 0 ? {
      ...conversation,
      name: 'International Product Architecture Working Group',
      lastMessage: 'Morgen besprechen wir die gerateubergreifende Wiederherstellung nach einem unterbrochenen Stationswechsel.',
    } : conversation))
    : baseConversations;
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unread, 0);
  const searchMoments = preparedMoments();

  function initialMessages(conversation: Conversation): Message[] {
    if (longLists) return longListMessages;
    if (conversation.key.startsWith('demo-direct-')) return [];
    if (deliveryRecovery) return deliveryRecoveryMessages;
    if (uiEvidence.chatThreadState === 'unknown-outcome') return unknownOutcomeMessages;
    return conversation.key === 'dev-team' ? demoMessages : directDemoMessages;
  }

  function readMessages(conversation: Conversation): Message[] {
    return conversationMessages[conversation.key] ?? initialMessages(conversation);
  }

  function updateMessages(conversation: Conversation, next: SetStateAction<Message[]>) {
    setConversationMessages((current) => ({
      ...current,
      [conversation.key]: typeof next === 'function'
        ? (next as (prev: Message[]) => Message[])(current[conversation.key] ?? initialMessages(conversation))
        : next,
    }));
  }

  useEffect(() => {
    if (!shellToast) return;
    const timer = window.setTimeout(() => setShellToast(null), 2100);
    return () => window.clearTimeout(timer);
  }, [shellToast, shellToastKey]);

  function showShellToast(msg: string) {
    setShellToast(msg);
    setShellToastKey((k) => k + 1);
  }

  function openSearch(conversationKey = '') {
    setSearchOrigin({ tab: activeTab, conversation: selectedConversation });
    // Reopening within the same conversation restores the last submitted query
    // and its result surface; a different conversation starts a clean scope.
    setSearchView((previous) => (previous.submitted && previous.conversationKey === conversationKey
      ? previous
      : { query: '', filter: 'all', conversationKey, submitted: false }));
    // Bind the controlled search lifecycle to this surface so submit tickets
    // are accepted while the page is open.
    searchDemo?.dispatch({ type: 'open', owner: 'global-search' });
    setSearchOpen(true);
  }

  function leaveSearch() {
    searchDemo?.dispatch({ type: 'close', owner: 'global-search' });
    setSearchOpen(false);
    setSearchTarget(null);
    setSocialSearchTarget(null);
  }

  function handleStartCall(conversation: Conversation, mediaKind: PrototypeCallMediaKind) {
    if (conversation.isGroup) return;
    setCallSnapshot({
      state: 'outgoing',
      mediaKind,
      peerName: conversation.name,
      peerInitials: conversation.avatar,
    });
  }

  function handleConversationClick(conv: Conversation) {
    setSocialSearchTarget(null);
    setSelectedConversation(conv);
  }

  function handleContactClick(contact: Contact) {
    dispatchSocialDemo({ type: 'close-direct' });
    setSelectedContact(contact);
  }

  function handleGroupClick(group: GroupItem) {
    setSelectedGroup(group);
  }

  function handleContactMessage(contact: Contact) {
    dispatchSocialDemo({ type: 'open-direct', contactKey: contact.key });
  }

  // Direct lifecycle: open the prepared conversation on the chat surface when
  // the demo resolves ready.
  useEffect(() => {
    if (socialDemo.direct?.status !== 'ready' || !selectedContact) return;
    if (socialDemo.direct.contactKey !== selectedContact.key) return;
    const conv = socialDemo.direct.conversation;
    if (conv) {
      setActiveTab('chat');
      setSelectedConversation(conv);
    }
    setSelectedContact(null);
  }, [socialDemo.direct, selectedContact]);

  useEffect(() => {
    if (callScenario) setCallSnapshot(callSnapshotForScenario(callScenario));
  }, [callScenario]);

  const showTabBar = !searchOpen && !(activeTab === 'chat' && selectedConversation)
    && !(activeTab === 'contacts' && (selectedContact || selectedGroup))
    && !(activeTab === 'profile' && selectedSetting)
    && !(activeTab === 'moments' && momentsImmersiveOpen);

  const overlayOpen = findPeopleOpen || createGroupOpen || Boolean(callSnapshot) || Boolean(recoveryScenario);

  function renderPage(): ReactNode {
    if (searchOpen) {
      const targets = conversations.flatMap((conversation) => {
        const messages = readMessages(conversation);
        return messages.flatMap((message) => {
          const entries: { conversation: Conversation; message: Message; root?: Message }[] = [
            { conversation, message },
          ];
          (message.threadReplies ?? []).forEach((reply) => entries.push({ conversation, message: reply, root: message }));
          return entries;
        });
      });
      return (
        <SearchPage
          view={searchView}
          onChange={setSearchView}
          targets={targets}
          socialTargets={searchMoments.flatMap((moment) => [
            { moment },
            ...moment.comments.map((comment) => ({ moment, comment })),
          ])}
          memory={listMemory}
          demo={searchDemo}
          onBack={() => {
            leaveSearch();
            setThreadReturnToSearch(false);
            setActiveTab(searchOrigin.tab);
          }}
          onOpen={(target) => {
            leaveSearch();
            setActiveTab('chat');
            setSelectedConversation(target.conversation);
            setSearchTarget(target);
            setThreadReturnToSearch(true);
          }}
          onSetting={(setting) => {
            leaveSearch();
            setActiveTab('profile');
            setSelectedSetting(setting);
          }}
          onOpenSocial={(target) => {
            leaveSearch();
            setActiveTab('moments');
            setSocialSearchTarget(target);
          }}
        />
      );
    }

    if ((activeTab === 'chat' || activeTab === 'contacts') && socialDemo.runtime !== 'ready') {
      const conversationUnavailable = activeTab === 'chat' && selectedConversation;
      return (
        <SocialUnavailablePage
          title={conversationUnavailable ? t('mobile.chat.thread') : t('mobile.chat.title')}
          runtime={socialDemo.runtime}
          onRetry={() => dispatchSocialDemo({ type: 'retry-runtime' })}
          onBack={conversationUnavailable ? () => setSelectedConversation(null) : undefined}
        />
      );
    }

    if (activeTab === 'chat') {
      if (selectedConversation) {
        return (
          <ChatThread
            key={selectedConversation.key}
            conversation={selectedConversation}
            messages={readMessages(selectedConversation)}
            onMessagesChange={(next) => updateMessages(selectedConversation, next)}
            listMemory={listMemory}
            uiEvidence={uiEvidence}
            messageId={searchTarget?.message.id}
            threadRootMessageId={searchTarget?.root?.id}
            onSearch={() => openSearch(selectedConversation.key)}
            onTargetConsumed={() => setSearchTarget(null)}
            onBack={() => {
              if (threadReturnToSearch) {
                setThreadReturnToSearch(false);
                openSearch(selectedConversation.key);
              } else {
                setSelectedConversation(null);
              }
            }}
            onStartCall={(mediaKind) => handleStartCall(selectedConversation, mediaKind)}
          />
        );
      }
      return (
        <ChatPage
          conversations={conversations}
          listMemory={listMemory}
          uiEvidence={uiEvidence}
          onConversationClick={handleConversationClick}
          onCompose={() => setCreateGroupOpen(true)}
        />
      );
    }

    if (activeTab === 'moments') {
      return (
        <MomentsPage
          scenario={momentsScenario ?? 'social-parity'}
          searchTarget={socialSearchTarget ? {
            postId: socialSearchTarget.moment.id,
            commentId: socialSearchTarget.comment?.id,
          } : undefined}
          onTargetConsumed={() => setSocialSearchTarget(null)}
          onImmersiveVisibilityChange={setMomentsImmersiveOpen}
        />
      );
    }

    if (activeTab === 'contacts') {
      if (selectedContact) {
        const direct = socialDemo.direct?.contactKey === selectedContact.key ? socialDemo.direct : null;
        return (
          <ContactDetailView
            key={selectedContact.key}
            contact={selectedContact}
            directStatus={direct?.status}
            canMessage={!longLists && socialDemo.federations.length > 0}
            messageUnavailableText={longLists ? t('mobile.launch.unavailable') : undefined}
            onBack={() => {
              dispatchSocialDemo({ type: 'close-direct' });
              setSelectedContact(null);
            }}
            onMessage={handleContactMessage}
          />
        );
      }
      if (selectedGroup) {
        return (
          <GroupDetailView
            key={selectedGroup.key}
            group={selectedGroup}
            members={longLists ? longListMembers : undefined}
            listMemory={listMemory}
            sampleOnly={longLists}
            onMemberClick={longLists ? handleContactClick : undefined}
            onBack={() => setSelectedGroup(null)}
          />
        );
      }
      return (
        <ContactsPage
          contacts={longLists ? longListContacts : socialDemo.contacts}
          groups={longLists ? longListGroups : undefined}
          requests={longLists ? longListRequests : undefined}
          listMemory={listMemory}
          request={socialDemo.request}
          avatarState={uiEvidence.avatarState}
          onContactClick={handleContactClick}
          onGroupClick={handleGroupClick}
          onAddContact={() => setFindPeopleOpen(true)}
          onCreateGroup={() => setCreateGroupOpen(true)}
        />
      );
    }

    if (activeTab === 'profile') {
      return selectedSetting ? (
        <SettingDetailView
          setting={selectedSetting}
          onBack={() => setSelectedSetting(null)}
          onChangeStation={() => {
            setSelectedSetting(null);
            onChangeStation();
          }}
        />
      ) : (
        <ProfilePage
          avatarState={uiEvidence.avatarState}
          onChangeStation={onChangeStation}
          onSettingClick={setSelectedSetting}
        />
      );
    }
  }

  const tabItems: ReadonlyArray<{ id: TabId; label: string; iconId: IconName; badge?: number }> = [
    { id: 'chat', label: t('mobile.tab.chat'), iconId: 'message-circle', badge: unreadCount },
    { id: 'moments', label: t('mobile.tab.moments'), iconId: 'image' },
    { id: 'contacts', label: t('mobile.tab.contacts'), iconId: 'users-round' },
    { id: 'profile', label: t('mobile.tab.settings'), iconId: 'circle-user' },
  ];

  return (
    <div className="mp-shell">
      <div className="mp-shell-content" inert={overlayOpen || undefined}>{renderPage()}</div>

      {!overlayOpen && (
        <RequestRecoveryNotice
          request={socialDemo.request}
          onCheck={() => dispatchSocialDemo({ type: 'check-request' })}
        />
      )}
      {showTabBar && (
        <nav className="mp-tabbar" aria-label={t('mobile.shell.primaryNav')}>
          {tabItems.map(({ id, label, iconId, badge }) => (
            <button
              key={id}
              type="button"
              className={`mp-tabbar-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => {
                dispatchSocialDemo({ type: 'close-direct' });
                setFindPeopleOpen(false);
                setCreateGroupOpen(false);
                setSocialSearchTarget(null);
                setActiveTab(id);
                setSelectedContact(null);
                setSelectedGroup(null);
                setSelectedSetting(null);
              }}
            >
              <Badge count={badge}>
                <Icon iconId={iconId} size={22} />
              </Badge>
              <span className="mp-tabbar-label">{label}</span>
            </button>
          ))}
        </nav>
      )}

      {shellToast && <div key={shellToastKey} className="mp-toast">{shellToast}</div>}

      {findPeopleOpen && socialDemo.runtime === 'ready' && (
        <FindPeopleSheet
          state={socialDemo}
          dispatch={dispatchSocialDemo}
          onClose={() => setFindPeopleOpen(false)}
        />
      )}

      {createGroupOpen && (
        <CreateGroupSheet
          contacts={socialDemo.contacts}
          onClose={() => setCreateGroupOpen(false)}
          onCreate={(name) => {
            setCreateGroupOpen(false);
            showShellToast(`${name} created`);
          }}
        />
      )}

      {recoveryScenario && (
        <ShellRecoverySheet
          scenario={recoveryScenario}
          onPrimary={() => {
            showShellToast(recoveryScenario === 'draft-restored' ? 'Draft ready to continue' : 'Pending actions ready for review');
            onRecoveryClose?.();
          }}
          onSecondary={() => showShellToast('Read-only mode remains available')}
        />
      )}

      {callSnapshot && (
        <MobileCallSurface
          snapshot={callSnapshot}
          onChange={setCallSnapshot}
          onDismiss={() => setCallSnapshot(null)}
        />
      )}
    </div>
  );
}
