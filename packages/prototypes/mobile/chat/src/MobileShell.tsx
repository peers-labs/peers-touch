import { useEffect, useState, type Dispatch, type ReactNode } from 'react';
import { Badge } from 'antd';
import { Image as ImageIcon, MessageCircle, User, Users } from 'lucide-react';
import type { TabId, Conversation, Contact, GroupItem, SettingEntry } from './types';
import { demoConversations } from './data';
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
  SocialRuntimeNotice,
  SocialUnavailablePage,
  type ShellEvidenceScenario,
} from './components/ExperienceRecovery';

export function MobileShell({
  stationLabel,
  onChangeStation,
  recoveryScenario,
  onRecoveryClose,
  socialScenario,
  socialDemo,
  dispatchSocialDemo,
  longLists = false,
  searchDemo,
}: {
  stationLabel: string;
  onChangeStation: () => void;
  recoveryScenario?: ShellEvidenceScenario;
  onRecoveryClose?: () => void;
  socialScenario?: SocialEvidenceScenario;
  socialDemo: SocialDemoState;
  dispatchSocialDemo: Dispatch<SocialDemoAction>;
  longLists?: boolean;
  searchDemo?: SearchDemoControl;
}) {
  const [listMemory] = useState(() => new PrototypeListMemory());
  const [activeTab, setActiveTab] = useState<TabId>(
    socialScenario && socialScenario !== 'social-unavailable' ? 'contacts' : 'chat',
  );
  const [findPeopleOpen, setFindPeopleOpen] = useState(
    socialScenario === 'find-people-member' || socialScenario === 'find-people-no-membership'
      || socialScenario === 'request-unknown',
  );
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<GroupItem | null>(null);
  const [selectedSetting, setSelectedSetting] = useState<SettingEntry | null>(null);
  const [shellToast, setShellToast] = useState<string | null>(null);
  const [shellToastKey, setShellToastKey] = useState(0);

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

  const tabs: { id: TabId; label: string; icon: typeof MessageCircle; badge?: number }[] = [
    { id: 'chat', label: 'Chats', icon: MessageCircle, badge: 7 },
    { id: 'moments', label: 'Moments', icon: ImageIcon },
    { id: 'contacts', label: 'Contacts', icon: Users },
    { id: 'profile', label: 'Me', icon: User },
  ];

  function handleConversationClick(conv: Conversation) {
    setSelectedConversation(conv);
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
    setFindPeopleOpen(true);
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
      return <SocialUnavailablePage
        title={copy[activeTab === 'chat' ? 'mobile.chat.title' : 'mobile.contacts.title']}
        runtime={socialDemo.runtime}
      />;
    }
    if (activeTab === 'chat' && selectedConversation) {
      return <ChatThread key={selectedConversation.key} conversation={selectedConversation}
        initialMessages={longLists ? longListMessages : selectedConversation.key.startsWith('demo-direct-') ? [] : undefined}
        listMemory={listMemory} searchDemo={searchDemo}
        onBack={handleBackToList} />;
    }
    if (activeTab === 'contacts' && selectedContact) {
      const direct = socialDemo.direct?.contactKey === selectedContact.key ? socialDemo.direct : null;
      if (direct?.status === 'ready' && direct.conversation) {
        return <ChatThread key={direct.conversation.key} conversation={direct.conversation}
          initialMessages={direct.conversation.key.startsWith('demo-direct-') ? [] : undefined}
          listMemory={listMemory}
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
      return <SettingDetailView setting={selectedSetting} onBack={() => setSelectedSetting(null)} />;
    }
    switch (activeTab) {
      case 'chat': return <ChatPage conversations={longLists ? longListConversations : socialDemo.conversations}
        listMemory={listMemory} onConversationClick={handleConversationClick} />;
      case 'moments': return <MomentsPage />;
      case 'contacts': return <ContactsPage contacts={longLists ? longListContacts : socialDemo.contacts}
        groups={longLists ? longListGroups : undefined} requests={longLists ? longListRequests : undefined}
        listMemory={listMemory} request={socialDemo.request}
        onContactClick={handleContactClick} onGroupClick={handleGroupClick} onAddContact={handleAddContact} />;
      case 'profile': return <ProfilePage onChangeStation={onChangeStation} onSettingClick={handleSettingClick} />;
    }
  }

  const showTabBar = !(activeTab === 'chat' && selectedConversation)
    && !(activeTab === 'contacts' && (selectedContact || selectedGroup))
    && !(activeTab === 'profile' && selectedSetting);

  return (
    <div className="mp-shell">
      <div className="mp-shell-content" inert={findPeopleOpen}>{renderPage()}</div>
      <SocialRuntimeNotice runtime={socialDemo.runtime}
        onRetry={() => dispatchSocialDemo({ type: 'retry-runtime' })} />
      {!findPeopleOpen && (
        <RequestRecoveryNotice request={socialDemo.request}
          onCheck={() => dispatchSocialDemo({ type: 'check-request' })} />
      )}
      {showTabBar && (
        <nav className="mp-tabbar" inert={findPeopleOpen}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`mp-tabbar-item ${isActive ? 'active' : ''}`}
                onClick={() => { dispatchSocialDemo({ type: 'close-direct' }); setFindPeopleOpen(false); setActiveTab(tab.id); setSelectedConversation(null); setSelectedContact(null); setSelectedGroup(null); setSelectedSetting(null); }}
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
      {recoveryScenario && (
        <ShellRecoverySheet
          scenario={recoveryScenario}
          onPrimary={() => handleRecoveryAction('primary')}
          onSecondary={() => handleRecoveryAction('secondary')}
        />
      )}
    </div>
  );
}
