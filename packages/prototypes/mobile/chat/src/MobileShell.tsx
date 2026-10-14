import { useEffect, useState, type Dispatch, type ReactNode } from 'react';
import { Badge } from 'antd';
import { Image as ImageIcon, MessageCircle, User, Users } from 'lucide-react';
import type { TabId, Conversation, Contact, GroupItem, MobileUiEvidence, SettingEntry } from './types';
import {
  deliveryRecoveryMessages,
  demoConversations,
  directDemoMessages,
  unknownOutcomeMessages,
} from './data';
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
import { MomentsPage, type MomentsEvidenceScenario } from './pages/MomentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ContactDetailView } from './components/ContactDetailView';
import { GroupDetailView } from './components/GroupDetailView';
import { SettingDetailView } from './components/SettingDetailView';
import { FindPeopleSheet } from './components/FindPeopleSheet';
import { CreateGroupSheet } from './components/CreateGroupSheet';
import {
  RequestRecoveryNotice,
  ShellRecoverySheet,
  SocialUnavailablePage,
  type ShellEvidenceScenario,
} from './components/ExperienceRecovery';
import { MobileCallSurface } from './components/MobileCallSurface';
import {
  callSnapshotForScenario,
  type PrototypeCallMediaKind,
  type PrototypeCallScenario,
  type PrototypeCallSnapshot,
} from './callPrototype';

export function MobileShell({
  stationLabel,
  onChangeStation,
  recoveryScenario,
  onRecoveryClose,
  socialScenario,
  momentsScenario,
  socialDemo,
  dispatchSocialDemo,
  longLists = false,
  focusChatJourney = false,
  deliveryRecovery = false,
  uiEvidence,
  callScenario,
  searchDemo,
}: {
  stationLabel: string;
  onChangeStation: () => void;
  recoveryScenario?: ShellEvidenceScenario;
  onRecoveryClose?: () => void;
  socialScenario?: SocialEvidenceScenario;
  momentsScenario?: MomentsEvidenceScenario;
  socialDemo: SocialDemoState;
  dispatchSocialDemo: Dispatch<SocialDemoAction>;
  longLists?: boolean;
  focusChatJourney?: boolean;
  deliveryRecovery?: boolean;
  uiEvidence: MobileUiEvidence;
  callScenario?: PrototypeCallScenario;
  searchDemo?: SearchDemoControl;
}) {
  const [listMemory] = useState(() => new PrototypeListMemory());
  const [activeTab, setActiveTab] = useState<TabId>(
    momentsScenario
      ? 'moments'
      : socialScenario
        && socialScenario !== 'social-unavailable'
        && socialScenario !== 'social-detail-unavailable'
        ? 'contacts'
        : 'chat',
  );
  const [findPeopleOpen, setFindPeopleOpen] = useState(
    socialScenario === 'find-people-member' || socialScenario === 'find-people-no-membership'
      || socialScenario === 'request-unknown',
  );
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
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
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [selectedSetting, setSelectedSetting] = useState<SettingEntry | null>(null);
  const [shellToast, setShellToast] = useState<string | null>(null);
  const [shellToastKey, setShellToastKey] = useState(0);
  const [momentsImmersiveOpen, setMomentsImmersiveOpen] = useState(false);
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

  const baseConversations = longLists ? longListConversations : socialDemo.conversations;
  const conversations = uiEvidence.longContent
    ? baseConversations.map((conversation, index) => index === 0 ? {
      ...conversation,
      name: 'International Product Architecture Working Group',
      lastMessage: 'Morgen besprechen wir die gerateubergreifende Wiederherstellung nach einem unterbrochenen Stationswechsel.',
    } : conversation)
    : baseConversations;
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

  function handleSettingClick(setting: SettingEntry) {
    setSelectedSetting(setting);
  }

  function handleContactMessage(contact: Contact) {
    dispatchSocialDemo({ type: 'open-direct', contactKey: contact.key });
  }

  function handleAddContact() {
    setCreateGroupOpen(false);
    setFindPeopleOpen(true);
  }

  function handleCreateGroup() {
    setFindPeopleOpen(false);
    setCreateGroupOpen(true);
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
    if ((activeTab === 'chat' || activeTab === 'contacts') && socialDemo.runtime !== 'ready') {
      const conversationUnavailable = activeTab === 'chat' && selectedConversation;
      return <SocialUnavailablePage
        title={copy[conversationUnavailable
          ? 'mobile.nav.chatConversation'
          : activeTab === 'chat'
            ? 'mobile.chat.title'
            : 'mobile.contacts.title']}
        runtime={socialDemo.runtime}
        onRetry={() => dispatchSocialDemo({ type: 'retry-runtime' })}
        onBack={conversationUnavailable ? handleBackToList : undefined}
      />;
    }
    if (activeTab === 'chat' && selectedConversation) {
      const initialMessages = longLists
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
        onStartCall={(mediaKind) => handleStartCall(selectedConversation, mediaKind)}
        onBack={handleBackToList} />;
    }
    if (activeTab === 'contacts' && selectedContact) {
      const direct = socialDemo.direct?.contactKey === selectedContact.key ? socialDemo.direct : null;
      if (direct?.status === 'ready' && direct.conversation) {
        return <ChatThread key={direct.conversation.key} conversation={direct.conversation}
          initialMessages={direct.conversation.key.startsWith('demo-direct-') ? [] : undefined}
          listMemory={listMemory} uiEvidence={uiEvidence}
          onStartCall={(mediaKind) => handleStartCall(direct.conversation!, mediaKind)}
          onBack={() => dispatchSocialDemo({ type: 'close-direct' })} />;
      }
      return <ContactDetailView contact={selectedContact}
        directStatus={direct?.status}
        canMessage={!longLists && socialDemo.federations.length > 0}
        messageUnavailableText={longLists ? copy['mobile.launch.unavailable'] : undefined}
        onBack={() => { dispatchSocialDemo({ type: 'close-direct' }); setSelectedContact(null); }}
        onMessage={handleContactMessage} />;
    }
    if (activeTab === 'contacts' && selectedGroup) {
      return <GroupDetailView key={selectedGroup.key} group={selectedGroup}
        members={longLists ? longListMembers : undefined} listMemory={listMemory}
        sampleOnly={longLists} onMemberClick={longLists ? handleContactClick : undefined}
        onBack={() => setSelectedGroup(null)} />;
    }
    if (activeTab === 'profile' && selectedSetting) {
      return (
        <SettingDetailView
          setting={selectedSetting}
          onBack={() => setSelectedSetting(null)}
          onChangeStation={onChangeStation}
        />
      );
    }
    switch (activeTab) {
      case 'chat': return <ChatPage conversations={conversations}
        listMemory={listMemory} uiEvidence={uiEvidence} onConversationClick={handleConversationClick} />;
      case 'moments': return <MomentsPage
        scenario={momentsScenario}
        onImmersiveVisibilityChange={setMomentsImmersiveOpen}
      />;
      case 'contacts': return <ContactsPage contacts={longLists ? longListContacts : socialDemo.contacts}
        groups={longLists ? longListGroups : undefined} requests={longLists ? longListRequests : undefined}
        listMemory={listMemory} request={socialDemo.request}
        avatarState={uiEvidence.avatarState}
        onContactClick={handleContactClick} onGroupClick={handleGroupClick}
        onAddContact={handleAddContact} onCreateGroup={handleCreateGroup} />;
      case 'profile': return <ProfilePage avatarState={uiEvidence.avatarState}
        onChangeStation={onChangeStation} onSettingClick={handleSettingClick} />;
    }
  }

  const showTabBar = !(activeTab === 'chat' && selectedConversation)
    && !(activeTab === 'contacts' && (selectedContact || selectedGroup))
    && !(activeTab === 'profile' && selectedSetting)
    && !(activeTab === 'moments' && momentsImmersiveOpen);
  const overlayOpen = findPeopleOpen || createGroupOpen || Boolean(callSnapshot);

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
            return (
              <button
                key={tab.id}
                type="button"
                className={`mp-tabbar-item ${isActive ? 'active' : ''}`}
                onClick={() => { dispatchSocialDemo({ type: 'close-direct' }); setFindPeopleOpen(false); setCreateGroupOpen(false); setActiveTab(tab.id); setSelectedConversation(null); setSelectedContact(null); setSelectedGroup(null); setSelectedSetting(null); }}
              >
                <Badge count={socialDemo.runtime === 'ready' ? tab.badge ?? 0 : 0} size="small" offset={[4, -2]}>
                  <Icon size={24} strokeWidth={isActive ? 2.2 : 1.7} />
                </Badge>
                <span className="mp-tabbar-label">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      )}
      {/* Shell-level toast */}
      {shellToast && <div key={shellToastKey} className="mp-toast">{shellToast}</div>}
      {findPeopleOpen && socialDemo.runtime === 'ready' && (
        <FindPeopleSheet state={socialDemo} dispatch={dispatchSocialDemo}
          onClose={() => setFindPeopleOpen(false)} />
      )}
      {createGroupOpen && socialDemo.runtime === 'ready' && (
        <CreateGroupSheet
          contacts={socialDemo.contacts}
          onClose={() => setCreateGroupOpen(false)}
          onCreate={(name) => {
            setCreateGroupOpen(false);
            showShellToast(`${name} ${copy['mobile.group.create'].toLowerCase()}`);
          }}
        />
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
