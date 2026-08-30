import { useMemo, useState } from 'react';
import { Badge } from 'antd';
import { Image, MessageCircle, Users, Settings } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import { ChatPage } from '../pages/ChatPage';
import { ContactsPage } from '../pages/ContactsPage';
import { MomentsPage } from '../pages/MomentsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../features/auth/authStore';
import type { MobileAuthSession } from '../features/auth/authSession';
import { projectConversations, projectPendingInboundRequests } from '../features/social/socialProjection';
import { useSocialStore } from '../features/social/socialStore';
import { useSocialRuntime } from '../features/social/useSocialRuntime';
import type { StoredStationRegistry } from '../features/station/stationRegistry';
import {
  visibleChatUnread,
} from '../features/chat/chatActionState';
import { projectGroupConversations } from '../features/group/groupProjection';
import { useGroupStore } from '../features/group/groupStore';

type TabId = 'chat' | 'moments' | 'contacts' | 'settings';

interface TabDef {
  id: TabId;
  labelKey: string;
  icon: typeof MessageCircle;
}

const tabs: TabDef[] = [
  { id: 'chat', labelKey: 'mobile.tab.chat', icon: MessageCircle },
  { id: 'moments', labelKey: 'mobile.tab.moments', icon: Image },
  { id: 'contacts', labelKey: 'mobile.tab.contacts', icon: Users },
  { id: 'settings', labelKey: 'mobile.tab.settings', icon: Settings },
];

function renderPage(tabId: TabId, props: MobileShellProps, authSession: MobileAuthSession | null, onOpenChat: () => void) {
  switch (tabId) {
    case 'chat':
      return <ChatPage />;
    case 'moments':
      return <MomentsPage />;
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
  useSocialRuntime(authSession);

  const activeSessionUlid = useSocialStore((state) => state.activeSessionUlid);
  const sessions = useSocialStore((state) => state.sessions);
  const messages = useSocialStore((state) => state.messages);
  const currentUserPtid = useSocialStore((state) => state.currentUserPtid);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const friendConversationSettings = useSocialStore((state) => state.conversationSettings);
  const activeGroupUlid = useGroupStore((state) => state.activeGroupUlid);
  const groups = useGroupStore((state) => state.groups);
  const groupMessages = useGroupStore((state) => state.messages);
  const groupUnreadCounts = useGroupStore((state) => state.unreadCounts);
  const groupSettings = useGroupStore((state) => state.settings);
  const conversations = useMemo(
    () => projectConversations({ sessions, messages, currentUserPtid, peerOnline }),
    [currentUserPtid, messages, peerOnline, sessions],
  );
  const groupConversations = useMemo(
    () => projectGroupConversations({ groups, messages: groupMessages, unreadCounts: groupUnreadCounts }),
    [groupMessages, groupUnreadCounts, groups],
  );
  const inboundRequests = useMemo(
    () => projectPendingInboundRequests(friendRequests, currentUserPtid),
    [currentUserPtid, friendRequests],
  );
  const chatBadge = conversations.reduce(
    (total, conversation) =>
      total + visibleChatUnread(conversation.unread, {
        muted: Boolean(friendConversationSettings[conversation.session.ulid]?.isMuted),
        alertEnabled: friendConversationSettings[conversation.session.ulid]?.alertEnabled !== false,
      }),
    0,
  ) + groupConversations.reduce(
    (total, conversation) =>
      total + visibleChatUnread(conversation.unread, {
        muted: Boolean(groupSettings[conversation.group.ulid]?.isMuted),
        alertEnabled: groupSettings[conversation.group.ulid]?.alertEnabled !== false,
      }),
    0,
  );
  const contactBadge = inboundRequests.length;

  const switchTab = (tabId: TabId) => {
    setActiveTab(tabId);
  };
  const hideTabbar = activeTab === 'chat' && Boolean(activeSessionUlid || activeGroupUlid);

  return (
    <div className={`mobile-shell ${hideTabbar ? 'tabbar-hidden' : ''}`}>
      <div className="mobile-content">{renderPage(activeTab, props, authSession, () => switchTab('chat'))}</div>

      {!hideTabbar ? <nav className="mobile-tabbar">
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
      </nav> : null}
    </div>
  );
}
