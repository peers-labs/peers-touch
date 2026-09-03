import { useCallback, useMemo, useRef, useState } from 'react';
import { Badge } from 'antd';
import { Image, MessageCircle, User, Users } from 'lucide-react';

import { useLifecyclePhase } from '../app/lifecycle';
import { useMobileI18n } from '../app/mobileI18n';
import { primaryTabDescriptors } from '../app/navigation';
import {
  saveScrollPosition,
  restoreScrollPosition,
  clearAllScrollPositions,
} from '../app/navigation/scrollRestoration';
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

const TAB_ICON_MAP: Record<TabId, typeof MessageCircle> = {
  chat: MessageCircle,
  moments: Image,
  contacts: Users,
  settings: User,
};

/** Map navigation descriptor route IDs to local tab IDs. */
function routeIdToTabId(routeId: string): TabId | null {
  const suffix = routeId.replace('tab:', '');
  if (suffix === 'chat' || suffix === 'moments' || suffix === 'contacts' || suffix === 'settings') {
    return suffix;
  }
  return null;
}

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

/**
 * MobileShell — the main tab-based shell rendered after authentication.
 *
 * Receives lifecycle phase from the kernel to gate rendering.
 * Tab definitions come from navigation descriptors; scroll positions
 * are saved/restored through the externalized scroll restoration module.
 */
export function MobileShell(props: MobileShellProps) {
  const { t } = useMobileI18n();
  const lifecyclePhase = useLifecyclePhase();
  const authSession = useAuthStore((state) => state.session);
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const contentRef = useRef<HTMLDivElement>(null);
  const previousTabRef = useRef<TabId>(activeTab);
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

  const switchTab = useCallback((tabId: TabId) => {
    // Save scroll position of the tab we're leaving
    const previousRouteId = `tab:${previousTabRef.current}`;
    saveScrollPosition(previousRouteId, contentRef.current);

    setActiveTab(tabId);
    previousTabRef.current = tabId;

    // Restore scroll position of the tab we're entering (deferred to next frame)
    requestAnimationFrame(() => {
      const nextRouteId = `tab:${tabId}`;
      restoreScrollPosition(nextRouteId, contentRef.current);
    });
  }, []);

  // Clear scroll positions when lifecycle transitions away from ACTIVE
  // (e.g. during teardown or suspend)
  if (lifecyclePhase !== 'ACTIVE' && lifecyclePhase !== 'RESUMING') {
    clearAllScrollPositions();
  }

  const hideTabbar = activeTab === 'chat' && Boolean(activeSessionUlid || activeGroupUlid);

  return (
    <div className={`mobile-shell ${hideTabbar ? 'tabbar-hidden' : ''}`}>
      <div className="mobile-content" ref={contentRef}>
        {renderPage(activeTab, props, authSession, () => switchTab('chat'))}
      </div>

      {!hideTabbar ? <nav className="mobile-tabbar">
        {primaryTabDescriptors.map((descriptor) => {
          const tabId = routeIdToTabId(descriptor.routeId);
          if (!tabId) return null;
          const Icon = TAB_ICON_MAP[tabId];
          const isActive = activeTab === tabId;
          const badgeCount = tabId === 'chat' ? chatBadge : tabId === 'contacts' ? contactBadge : 0;
          return (
            <button
              key={tabId}
              className={`tabbar-item ${isActive ? 'active' : ''}`}
              onClick={() => switchTab(tabId)}
              type="button"
            >
              <Badge count={badgeCount} size="small" offset={[4, -2]}>
                <Icon size={24} strokeWidth={isActive ? 2.2 : 1.7} />
              </Badge>
              <span className="tabbar-label">{t(descriptor.labelKey)}</span>
            </button>
          );
        })}
      </nav> : null}
    </div>
  );
}
