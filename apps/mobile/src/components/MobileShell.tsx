import { useState } from 'react';
import { Badge } from 'antd';
import { Bell, MessageCircle, Users, Settings } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import { ChatPage } from '../pages/ChatPage';
import { ContactsPage } from '../pages/ContactsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../features/auth/authStore';
import type { MobileAuthSession } from '../features/auth/authSession';
import {
  selectPendingInboundFriendRequests,
  selectSocialConversations,
  selectUnreadSocialNotificationCount,
} from '../features/social/socialSelectors';
import { useSocialStore } from '../features/social/socialStore';
import { useSocialRuntime } from '../features/social/useSocialRuntime';
import type { StoredStationRegistry } from '../features/station/stationRegistry';
import { MobileNotificationCenter } from './MobileNotificationCenter';

type TabId = 'chat' | 'contacts' | 'settings';

interface TabDef {
  id: TabId;
  labelKey: string;
  icon: typeof MessageCircle;
}

const tabs: TabDef[] = [
  { id: 'chat', labelKey: 'mobile.tab.chat', icon: MessageCircle },
  { id: 'contacts', labelKey: 'mobile.tab.contacts', icon: Users },
  { id: 'settings', labelKey: 'mobile.tab.settings', icon: Settings },
];

function renderPage(tabId: TabId, props: MobileShellProps, authSession: MobileAuthSession | null, onOpenChat: () => void) {
  switch (tabId) {
    case 'chat':
      return <ChatPage />;
    case 'contacts':
      return <ContactsPage onOpenChat={onOpenChat} />;
    case 'settings':
      return (
        <SettingsPage
          authSession={authSession}
          stationRegistry={props.stationRegistry}
          onChangeStation={props.onChangeStation}
          onLogout={props.onLogout}
        />
      );
  }
}

export interface MobileShellProps {
  stationRegistry: StoredStationRegistry;
  onChangeStation: () => void;
  onLogout: () => Promise<void>;
}

export function MobileShell(props: MobileShellProps) {
  const { t } = useMobileI18n();
  const authSession = useAuthStore((state) => state.session);
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [notificationOpen, setNotificationOpen] = useState(false);
  useSocialRuntime(authSession);

  const conversations = useSocialStore(selectSocialConversations);
  const inboundRequests = useSocialStore(selectPendingInboundFriendRequests);
  const notificationBadge = useSocialStore(selectUnreadSocialNotificationCount);
  const chatBadge = conversations.reduce((total, conversation) => total + conversation.unread, 0);
  const contactBadge = inboundRequests.length;

  const switchTab = (tabId: TabId) => {
    setActiveTab(tabId);
    if (tabId === 'contacts') {
      void useSocialStore.getState().reconcile();
    }
  };

  return (
    <div className="mobile-shell">
      <button
        className="shell-notification-button"
        type="button"
        onClick={() => setNotificationOpen(true)}
        aria-label={t('mobile.notifications.title')}
      >
        <Badge count={notificationBadge} size="small" offset={[-2, 2]}>
          <Bell size={20} />
        </Badge>
      </button>
      <div className="mobile-content">{renderPage(activeTab, props, authSession, () => switchTab('chat'))}</div>
      <MobileNotificationCenter
        open={notificationOpen}
        onClose={() => setNotificationOpen(false)}
        onOpenChat={() => switchTab('chat')}
        onOpenContacts={() => switchTab('contacts')}
      />

      <nav className="mobile-tabbar">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const badgeCount = tab.id === 'chat' ? chatBadge : tab.id === 'contacts' ? contactBadge : 0;
          return (
            <button
              key={tab.id}
              className={`tabbar-item ${isActive ? 'active' : ''}`}
              onClick={() => switchTab(tab.id)}
              type="button"
            >
              <Badge count={badgeCount} size="small" offset={[4, 0]}>
                <Icon size={22} strokeWidth={isActive ? 2.2 : 1.6} />
              </Badge>
              <span className="tabbar-label">{t(tab.labelKey)}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
