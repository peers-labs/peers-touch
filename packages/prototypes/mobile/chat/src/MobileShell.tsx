import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from 'antd';
import { Image as ImageIcon, MessageCircle, User, Users } from 'lucide-react';
import type { TabId, Conversation, Contact, GroupItem, SettingEntry } from './types';
import { demoConversations } from './data';
import { ChatPage } from './pages/ChatPage';
import { ChatThread } from './pages/ChatThread';
import { MomentsPage } from './pages/MomentsPage';
import { ContactsPage } from './pages/ContactsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ContactDetailView } from './components/ContactDetailView';
import { GroupDetailView } from './components/GroupDetailView';
import { SettingDetailView } from './components/SettingDetailView';
import {
  ShellRecoverySheet,
  type ShellEvidenceScenario,
} from './components/ExperienceRecovery';

export function MobileShell({
  stationLabel,
  onChangeStation,
  recoveryScenario,
  onRecoveryClose,
}: {
  stationLabel: string;
  onChangeStation: () => void;
  recoveryScenario?: ShellEvidenceScenario;
  onRecoveryClose?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>('chat');
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
    setSelectedContact(contact);
  }

  function handleGroupClick(group: GroupItem) {
    setSelectedGroup(group);
  }

  function handleSettingClick(setting: SettingEntry) {
    setSelectedSetting(setting);
  }

  function handleContactMessage(contact: Contact) {
    // Navigate to chat with this contact
    const existingConv = demoConversations.find((c) => c.key === contact.key);
    if (existingConv) {
      setSelectedConversation(existingConv);
    } else {
      // Create a temporary conversation entry
      const tempConv: Conversation = {
        key: contact.key,
        name: contact.name,
        avatar: contact.avatar,
        avatarGradient: contact.avatarGradient,
        lastMessage: '',
        time: 'now',
        unread: 0,
        online: contact.online,
      };
      setSelectedConversation(tempConv);
    }
    setSelectedContact(null);
    setActiveTab('chat');
  }

  function handleAddContact() {
    showShellToast('Add contact feature coming soon');
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
    if (activeTab === 'chat' && selectedConversation) {
      return <ChatThread conversation={selectedConversation} onBack={handleBackToList} />;
    }
    if (activeTab === 'contacts' && selectedContact) {
      return <ContactDetailView contact={selectedContact} onBack={() => setSelectedContact(null)} onMessage={handleContactMessage} />;
    }
    if (activeTab === 'contacts' && selectedGroup) {
      return <GroupDetailView group={selectedGroup} onBack={() => setSelectedGroup(null)} />;
    }
    if (activeTab === 'profile' && selectedSetting) {
      return <SettingDetailView setting={selectedSetting} onBack={() => setSelectedSetting(null)} />;
    }
    switch (activeTab) {
      case 'chat': return <ChatPage onConversationClick={handleConversationClick} />;
      case 'moments': return <MomentsPage />;
      case 'contacts': return <ContactsPage onContactClick={handleContactClick} onGroupClick={handleGroupClick} onAddContact={handleAddContact} />;
      case 'profile': return <ProfilePage onChangeStation={onChangeStation} onSettingClick={handleSettingClick} />;
    }
  }

  const showTabBar = !(activeTab === 'chat' && selectedConversation)
    && !(activeTab === 'contacts' && (selectedContact || selectedGroup))
    && !(activeTab === 'profile' && selectedSetting);

  return (
    <div className="mp-shell">
      <div className="mp-shell-content">{renderPage()}</div>
      {showTabBar && (
        <nav className="mp-tabbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`mp-tabbar-item ${isActive ? 'active' : ''}`}
                onClick={() => { setActiveTab(tab.id); setSelectedConversation(null); setSelectedContact(null); setSelectedGroup(null); setSelectedSetting(null); }}
              >
                <Badge count={tab.badge ?? 0} size="small" offset={[4, -2]}>
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
