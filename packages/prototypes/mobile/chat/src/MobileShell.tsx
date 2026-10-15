import { useEffect, useState, type Dispatch, type ReactNode } from 'react';
import { Badge } from 'antd';
import { Image as ImageIcon, MessageCircle, User, Users } from 'lucide-react';
import type { TabId, Conversation, Contact, GroupItem, MobileUiEvidence, SettingEntry } from './types';
import {
  deliveryRecoveryMessages,
  demoConversations,
  demoContacts,
  demoGroups,
  directDemoMessages,
  unknownOutcomeMessages,
  contentProjectionConversations,
  contentProjectionMessages,
} from './data';
import {
  projectMessage,
  projectConversationLastMessage,
} from './contentProjection';
import {
  longListContacts, longListConversations, longListGroups, longListMembers,
  longListMessages, longListRequests,
} from './longListDemo';
import { PrototypeListMemory } from './listPresentation';
import copy from '../../../../locales/en/common.json';
import type { SocialDemoAction, SocialDemoState, SocialEvidenceScenario } from './socialDemo';
import type { SearchDemoControl } from './searchDemo';
import { ChatPage } from './pages/ChatPage';
import { ChatThread } from './pages/ChatThread';
import { MomentsPage } from './pages/MomentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ContactDetailView } from './components/ContactDetailView';
import { GroupDetailView } from './components/GroupDetailView';
import { SettingDetailView } from './components/SettingDetailView';
import { FindPeopleSheet } from './components/FindPeopleSheet';
import {
  RequestRecoveryNotice,
  ShellRecoverySheet,
  SocialUnavailablePage,
  type ShellEvidenceScenario,
} from './components/ExperienceRecovery';
import { MobileCallSurface } from './components/MobileCallSurface';
import {
  createInitialMobileSettingsState,
  type MobileSettingsState,
} from './settingsState';
import {
  createInitialMomentsPageState,
  type MomentsPageState,
} from './momentsState';
import { mobileSettingGroups } from './settingsModel';
import {
  callSnapshotForScenario,
  type PrototypeCallMediaKind,
  type PrototypeCallScenario,
  type PrototypeCallSnapshot,
} from './callPrototype';
import type { DesignThemeMode } from '../../../shared/design-tokens';

export function MobileShell({
  stationLabel,
  onChangeStation,
  themeMode,
  onThemeModeChange,
  recoveryScenario,
  onRecoveryClose,
  socialScenario,
  socialDemo,
  dispatchSocialDemo,
  longLists = false,
  focusChatJourney = false,
  deliveryRecovery = false,
  contentProjection = false,
  uiEvidence,
  callScenario,
  searchDemo,
}: {
  stationLabel: string;
  onChangeStation: () => void;
  themeMode: DesignThemeMode;
  onThemeModeChange: (theme: DesignThemeMode) => void;
  recoveryScenario?: ShellEvidenceScenario;
  onRecoveryClose?: () => void;
  socialScenario?: SocialEvidenceScenario;
  socialDemo: SocialDemoState;
  dispatchSocialDemo: Dispatch<SocialDemoAction>;
  longLists?: boolean;
  focusChatJourney?: boolean;
  deliveryRecovery?: boolean;
  contentProjection?: boolean;
  uiEvidence: MobileUiEvidence;
  callScenario?: PrototypeCallScenario;
  searchDemo?: SearchDemoControl;
}) {
  const [listMemory] = useState(() => new PrototypeListMemory());
  const [activeTab, setActiveTab] = useState<TabId>(
    socialScenario
      && socialScenario !== 'social-unavailable'
      && socialScenario !== 'social-detail-unavailable'
      ? 'contacts'
      : 'chat',
  );
  const [findPeopleOpen, setFindPeopleOpen] = useState(
    socialScenario === 'find-people-member' || socialScenario === 'find-people-no-membership'
      || socialScenario === 'request-unknown',
  );
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(() => (
    callScenario
      ? demoConversations.find((conversation) => conversation.key === 'alice') ?? null
      : focusChatJourney
        || socialScenario === 'social-detail-unavailable'
        || uiEvidence.chatThreadState !== 'ready'
        ? demoConversations.find((conversation) => conversation.key === 'dev-team') ?? null
      : null
  ));
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [blockedContactKeys, setBlockedContactKeys] = useState<Set<string>>(new Set());
  const [removedContactKeys, setRemovedContactKeys] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [removedGroupKeys, setRemovedGroupKeys] = useState<Set<string>>(new Set());
  const [momentAuthor, setMomentAuthor] = useState<
    { kind: 'contact'; contact: Contact } | { kind: 'group'; group: GroupItem } | null
  >(null);
  const [socialDetailOpen, setSocialDetailOpen] = useState(false);
  const [selectedSetting, setSelectedSetting] = useState<SettingEntry | null>(null);
  const [settingsState, setSettingsState] = useState<MobileSettingsState>(
    createInitialMobileSettingsState,
  );
  const [momentsState, setMomentsState] = useState<MomentsPageState>(
    createInitialMomentsPageState,
  );
  const [momentComposerRequest, setMomentComposerRequest] = useState(0);
  const [shellToast, setShellToast] = useState<string | null>(null);
  const [shellToastKey, setShellToastKey] = useState(0);
  const [callSnapshot, setCallSnapshot] = useState<PrototypeCallSnapshot | null>(
    () => callScenario ? callSnapshotForScenario(callScenario) : null,
  );

  useEffect(() => {
    if (shellToast) {
      const timer = setTimeout(() => setShellToast(null), 2100);
      return () => clearTimeout(timer);
    }
  }, [shellToast, shellToastKey]);

  function showShellToast(msg: string) {
    setShellToast(msg);
    setShellToastKey((k) => k + 1);
  }

  const baseConversations = contentProjection
    ? contentProjectionConversations
    : longLists
      ? longListConversations
      : socialDemo.conversations;
  const conversations = (uiEvidence.longContent
    ? baseConversations.map((conversation, index) => index === 0 ? {
      ...conversation,
      name: 'International Product Architecture Working Group',
      lastMessage: 'Morgen besprechen wir die gerateubergreifende Wiederherstellung nach einem unterbrochenen Stationswechsel.',
    } : conversation)
    : baseConversations
  ).map((conversation) => {
    if (!contentProjection) return conversation;
    return { ...conversation, lastMessage: projectConversationLastMessage(conversation.lastMessage) };
  });
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unread, 0);

  const tabs: { id: TabId; label: string; icon: typeof MessageCircle; badge?: number }[] = [
    { id: 'chat', label: 'Chats', icon: MessageCircle, badge: unreadCount },
    { id: 'moments', label: 'Moments', icon: ImageIcon },
    { id: 'contacts', label: 'Contacts', icon: Users },
    { id: 'profile', label: 'Me', icon: User },
  ];

  function handleConversationClick(conv: Conversation) {
    setSelectedConversation(conv);
  }

  function handleStartCall(
    conversation: Conversation,
    mediaKind: PrototypeCallMediaKind,
  ) {
    if (conversation.isGroup) return;
    setCallSnapshot({
      state: 'outgoing',
      mediaKind,
      peerName: conversation.name,
      peerInitials: conversation.avatar,
    });
  }

  function handleBackToList() {
    setSelectedConversation(null);
  }

  function handleContactClick(contact: Contact) {
    dispatchSocialDemo({ type: 'close-direct' });
    setSelectedContact(contact);
  }

  function handleGroupClick(group: GroupItem) {
    setSelectedGroup(group);
  }

  // Moments authors resolve to the same Contact/Group detail surfaces used in
  // Contacts, opened cross-tab; Back returns to the Moments feed.
  function openMomentAuthor(name: string) {
    setSocialDetailOpen(false);
    const contact = demoContacts.find((entry) => entry.name === name);
    if (contact) {
      setMomentAuthor({ kind: 'contact', contact });
      return;
    }
    const group = demoGroups.find((entry) => entry.name === name);
    if (group) setMomentAuthor({ kind: 'group', group });
  }

  function openMomentAuthorContact(contact: Contact) {
    setMomentAuthor({ kind: 'contact', contact });
  }

  function handleSettingClick(setting: SettingEntry) {
    setSelectedSetting(setting);
  }

  function handleSettingCommand(command: 'Open Chats' | 'New Post' | 'Switch Station') {
    setSelectedSetting(null);
    if (command === 'Open Chats') {
      setActiveTab('chat');
      return;
    }
    if (command === 'New Post') {
      setActiveTab('moments');
      setMomentComposerRequest((current) => current + 1);
      return;
    }
    setActiveTab('profile');
    setSelectedSetting(
      mobileSettingGroups
        .flatMap((group) => group.items)
        .find((entry) => entry.id === 'federation') ?? null,
    );
  }

  function handleContactMessage(contact: Contact) {
    dispatchSocialDemo({ type: 'open-direct', contactKey: contact.key });
  }

  function handleRemoveContact(contact: Contact) {
    setRemovedContactKeys((current) => new Set(current).add(contact.key));
  }

  function handleBlockedChange(contactKey: string, blocked: boolean) {
    setBlockedContactKeys((current) => {
      const next = new Set(current);
      if (blocked) next.add(contactKey);
      else next.delete(contactKey);
      return next;
    });
  }

  function handleExitGroup(group: GroupItem) {
    setRemovedGroupKeys((current) => new Set(current).add(group.key));
  }

  function handleContactCall(contact: Contact, mediaKind: PrototypeCallMediaKind) {
    handleStartCall({
      key: contact.key,
      name: contact.name,
      avatar: contact.avatar,
      avatarUrl: contact.avatarUrl,
      avatarGradient: contact.avatarGradient,
      lastMessage: '',
      time: '',
      unread: 0,
      online: contact.online,
    }, mediaKind);
  }

  function handleGroupMessage(group: GroupItem) {
    const conversation = conversations.find((entry) => entry.key === group.key)
      ?? demoConversations.find((entry) => entry.key === group.key);
    if (!conversation) return;
    setSelectedGroup(null);
    setMomentAuthor(null);
    setActiveTab('chat');
    setSelectedConversation(conversation);
  }

  function handleAddContact() {
    setFindPeopleOpen(true);
  }

  function refreshMomentsProjection() {
    setMomentsState((current) => ({
      ...current,
      moments: current.moments.map((moment) => ({ ...moment })),
      refreshRevision: current.refreshRevision + 1,
      lastRefreshedAt: Date.now(),
    }));
  }

  function handleRecoveryAction(action: 'primary' | 'secondary') {
    if (recoveryScenario === 'draft-restored' && action === 'primary') {
      setSelectedConversation(demoConversations[0]);
      showShellToast('Draft ready to continue');
    } else if (recoveryScenario === 'draft-restored') {
      showShellToast('Draft discarded');
    } else if (recoveryScenario === 'unknown-write' && action === 'primary') {
      showShellToast('Checking message status');
    } else if (recoveryScenario === 'unknown-write') {
      showShellToast('Draft kept on this device');
    } else if (recoveryScenario === 'ledger-full' && action === 'primary') {
      showShellToast('Pending actions ready for review');
    } else {
      showShellToast('Read-only mode remains available');
    }
    onRecoveryClose?.();
  }

  function renderPage(): ReactNode {
    if ((activeTab === 'chat' || activeTab === 'contacts' || activeTab === 'moments')
      && socialDemo.runtime !== 'ready') {
      const conversationUnavailable = activeTab === 'chat' && selectedConversation;
      return <SocialUnavailablePage
        title={copy[conversationUnavailable
          ? 'mobile.nav.chatConversation'
          : activeTab === 'chat'
            ? 'mobile.chat.title'
            : activeTab === 'contacts'
              ? 'mobile.contacts.title'
              : 'mobile.moments.title']}
        runtime={socialDemo.runtime}
        onRetry={() => dispatchSocialDemo({ type: 'retry-runtime' })}
        onBack={conversationUnavailable ? handleBackToList : undefined}
      />;
    }
    if (activeTab === 'chat' && selectedConversation) {
      const projectedThreadMessages = contentProjection
        ? contentProjectionMessages.map((message) => {
            if (!message.text) return message;
            const projected = projectMessage(message);
            return projected.label === message.text ? message : { ...message, text: projected.label };
          })
        : undefined;
      const initialMessages = contentProjection
        ? projectedThreadMessages
        : longLists
        ? longListMessages
        : deliveryRecovery
          ? deliveryRecoveryMessages
          : uiEvidence.chatThreadState === 'unknown-outcome'
            ? unknownOutcomeMessages
            : selectedConversation.key.startsWith('demo-direct-')
              ? []
              : selectedConversation.key === 'dev-team'
                ? undefined
                : directDemoMessages;
      return <ChatThread key={selectedConversation.key} conversation={selectedConversation}
        initialMessages={initialMessages}
        listMemory={listMemory} searchDemo={searchDemo} uiEvidence={uiEvidence}
        blocked={blockedContactKeys.has(selectedConversation.key)}
        onBlockedChange={(blocked) => handleBlockedChange(selectedConversation.key, blocked)}
        onStartCall={(mediaKind) => handleStartCall(selectedConversation, mediaKind)}
        onBack={handleBackToList} />;
    }
    if (activeTab === 'contacts' && selectedContact) {
      const direct = socialDemo.direct?.contactKey === selectedContact.key ? socialDemo.direct : null;
      if (direct?.status === 'ready' && direct.conversation) {
        return <ChatThread key={direct.conversation.key} conversation={direct.conversation}
          initialMessages={direct.conversation.key.startsWith('demo-direct-') ? [] : undefined}
          listMemory={listMemory} uiEvidence={uiEvidence}
          blocked={blockedContactKeys.has(selectedContact.key)}
          onBlockedChange={(blocked) => handleBlockedChange(selectedContact.key, blocked)}
          onStartCall={(mediaKind) => handleStartCall(direct.conversation!, mediaKind)}
          onBack={() => dispatchSocialDemo({ type: 'close-direct' })} />;
      }
      return <ContactDetailView contact={selectedContact}
        directStatus={direct?.status}
        canMessage={!longLists && socialDemo.federations.length > 0}
        messageUnavailableText={longLists ? copy['mobile.launch.unavailable'] : undefined}
        blocked={blockedContactKeys.has(selectedContact.key)}
        onBlockedChange={(blocked) => handleBlockedChange(selectedContact.key, blocked)}
        onBack={() => { dispatchSocialDemo({ type: 'close-direct' }); setSelectedContact(null); }}
        onMessage={handleContactMessage}
        onStartCall={handleContactCall}
        onRemove={longLists ? undefined : handleRemoveContact} />;
    }
    if (activeTab === 'contacts' && selectedGroup) {
      return <GroupDetailView key={selectedGroup.key} group={selectedGroup}
        members={longLists ? longListMembers : undefined} listMemory={listMemory}
        sampleOnly={longLists} onMemberClick={longLists ? handleContactClick : undefined}
        onOpenChat={handleGroupMessage}
        onExit={longLists ? undefined : handleExitGroup}
        onBack={() => setSelectedGroup(null)} />;
    }
    if (activeTab === 'moments' && momentAuthor) {
      if (momentAuthor.kind === 'group') {
        return <GroupDetailView key={momentAuthor.group.key} group={momentAuthor.group}
          listMemory={listMemory}
          onMemberClick={openMomentAuthorContact}
          onOpenChat={handleGroupMessage}
          onExit={longLists ? undefined : handleExitGroup}
          onBack={() => setMomentAuthor(null)} />;
      }
      const { contact } = momentAuthor;
      return <ContactDetailView contact={contact}
        canMessage={!longLists && socialDemo.federations.length > 0}
        messageUnavailableText={longLists ? copy['mobile.launch.unavailable'] : undefined}
        blocked={blockedContactKeys.has(contact.key)}
        onBlockedChange={(blocked) => handleBlockedChange(contact.key, blocked)}
        onBack={() => setMomentAuthor(null)}
        onStartCall={handleContactCall}
        onRemove={longLists ? undefined : handleRemoveContact}
        onMessage={(target) => {
          setMomentAuthor(null);
          setActiveTab('contacts');
          handleContactClick(target);
        }} />;
    }
    if (activeTab === 'profile' && selectedSetting) {
      return <SettingDetailView
        setting={selectedSetting}
        settingsState={settingsState}
        onSettingsStateChange={setSettingsState}
        themeMode={themeMode}
        onThemeModeChange={onThemeModeChange}
        onCommand={handleSettingCommand}
        onBack={() => setSelectedSetting(null)}
        onChangeStation={onChangeStation}
      />;
    }
    switch (activeTab) {
      case 'chat': return <ChatPage conversations={conversations}
        listMemory={listMemory} uiEvidence={uiEvidence} onConversationClick={handleConversationClick} />;
      case 'moments': return <MomentsPage
        avatarState={uiEvidence.avatarState}
        state={momentsState}
        onStateChange={setMomentsState}
        listMemory={listMemory}
        onRefresh={refreshMomentsProjection}
        composerRequest={momentComposerRequest}
        defaultAudience={settingsState.defaultVisibility}
        onComposerRequestHandled={() => setMomentComposerRequest(0)}
        onOpenAuthor={openMomentAuthor}
        onDetailChange={setSocialDetailOpen}
      />;
      case 'contacts': return <ContactsPage contacts={(longLists ? longListContacts : socialDemo.contacts)
        .filter((contact) => !removedContactKeys.has(contact.key))}
        groups={(longLists ? longListGroups : demoGroups)
          .filter((group) => !removedGroupKeys.has(group.key))}
        requests={longLists ? longListRequests : undefined}
        listMemory={listMemory} request={socialDemo.request}
        avatarState={uiEvidence.avatarState}
        onContactClick={handleContactClick} onGroupClick={handleGroupClick} onAddContact={handleAddContact} />;
      case 'profile': return <ProfilePage avatarState={uiEvidence.avatarState}
        settingsState={settingsState}
        themeMode={themeMode}
        onChangeStation={onChangeStation} onSettingClick={handleSettingClick} />;
    }
  }

  const showTabBar = !(activeTab === 'chat' && selectedConversation)
    && !(activeTab === 'contacts' && (selectedContact || selectedGroup))
    && !(activeTab === 'moments' && momentAuthor)
    && !(activeTab === 'moments' && socialDetailOpen)
    && !(activeTab === 'profile' && selectedSetting);
  const overlayOpen = findPeopleOpen || Boolean(callSnapshot);

  return (
    <div className="mp-shell">
      <div className="mp-shell-content" inert={overlayOpen}>{renderPage()}</div>
      {!overlayOpen && (
        <RequestRecoveryNotice request={socialDemo.request}
          onCheck={() => dispatchSocialDemo({ type: 'check-request' })} />
      )}
      {showTabBar && (
        <nav className="mp-tabbar" inert={overlayOpen}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            const unread = socialDemo.runtime === 'ready' ? tab.badge ?? 0 : 0;
            return (
              <button
                key={tab.id}
                type="button"
                className={`mp-tabbar-item ${isActive ? 'active' : ''}`}
                data-tab-id={tab.id}
                aria-label={unread > 0 ? `${tab.label}, ${unread} unread` : tab.label}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => {
                  dispatchSocialDemo({ type: 'close-direct' });
                  setFindPeopleOpen(false);
                  setActiveTab(tab.id);
                  setSelectedConversation(null);
                  setSelectedContact(null);
                  setSelectedGroup(null);
                  setMomentAuthor(null);
                  setSocialDetailOpen(false);
                  setSelectedSetting(null);
                }}
              >
                <Badge count={unread} size="small" offset={[4, -2]}>
                  <Icon size={24} strokeWidth={isActive ? 2.2 : 1.7} />
                </Badge>
              </button>
            );
          })}
        </nav>
      )}
      {shellToast && (
        <div key={shellToastKey} className="mp-toast" role="status" aria-live="polite">
          {shellToast}
        </div>
      )}
      {findPeopleOpen && socialDemo.runtime === 'ready' && (
        <FindPeopleSheet state={socialDemo} dispatch={dispatchSocialDemo}
          onClose={() => setFindPeopleOpen(false)} />
      )}
      {recoveryScenario && (
        <ShellRecoverySheet
          scenario={recoveryScenario}
          onPrimary={() => handleRecoveryAction('primary')}
          onSecondary={() => handleRecoveryAction('secondary')}
        />
      )}
      {callSnapshot ? (
        <MobileCallSurface
          snapshot={callSnapshot}
          onChange={setCallSnapshot}
          onDismiss={() => setCallSnapshot(null)}
        />
      ) : null}
    </div>
  );
}
