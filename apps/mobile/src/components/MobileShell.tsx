import { useCallback, useMemo, useRef } from 'react';
import { Badge } from 'antd';
import { Image, MessageCircle, User, Users } from 'lucide-react';

import { useMobileI18n } from '../app/mobileI18n';
import {
  activeMobileDetailRoute,
  navigationLocationKey,
  primaryTabDescriptors,
  requestSettingsExit,
  restoreFocusTarget,
  saveScrollPosition,
  saveFocusTarget,
  restoreScrollPosition,
  useMobileNavigationStore,
  type MobileDetailRoute,
  type MobileOverlayRoute,
  type MobilePrimaryRouteId,
} from '../app/navigation';
import { ChatPage } from '../pages/ChatPage';
import { ContactsPage } from '../pages/ContactsPage';
import { MomentsPage } from '../pages/MomentsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../features/auth/authStore';
import type { MobileAuthSession } from '../features/auth/authSession';
import { projectConversations, projectPendingInboundRequests } from '../features/social/socialProjection';
import { useSocialStore } from '../features/social/socialStore';
import type { StoredStationRegistry } from '../features/station/stationRegistry';
import {
  visibleChatUnread,
} from '../features/chat/chatActionState';
import { projectGroupConversations } from '../features/group/groupProjection';
import { useGroupStore } from '../features/group/groupStore';
import { MobileRouteBoundary } from './MobileRouteBoundary';

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

function detailRouteToTabId(route: MobileDetailRoute | null): TabId | null {
  switch (route?.routeId) {
    case 'detail:chat-conversation':
    case 'detail:group-conversation':
      return 'chat';
    case 'detail:contact-profile':
      return 'contacts';
    case 'detail:moment':
      return 'moments';
    case 'detail:setting':
      return 'settings';
    default:
      return null;
  }
}

function renderPage(
  tabId: TabId,
  props: MobileShellProps,
  authSession: MobileAuthSession | null,
  activeDetail: MobileDetailRoute | null,
  activeOverlay: MobileOverlayRoute | null,
  onOpenDetail: (route: MobileDetailRoute) => void,
  onOpenOverlay: (route: MobileOverlayRoute) => void,
  onCloseOverlay: () => void,
  onBack: () => void,
) {
  switch (tabId) {
    case 'chat':
      return (
        <ChatPage
          activeDetail={
            activeDetail?.routeId === 'detail:chat-conversation'
            || activeDetail?.routeId === 'detail:group-conversation'
              ? activeDetail
              : null
          }
          onBack={onBack}
          onOpenConversation={onOpenDetail}
        />
      );
    case 'moments':
      return (
        <MomentsPage
          activePostId={activeDetail?.routeId === 'detail:moment' ? activeDetail.postId : null}
          onOpenMoment={(postId) => onOpenDetail({
            routeId: 'detail:moment',
            postId,
          })}
          onBack={onBack}
        />
      );
    case 'contacts':
      return (
        <ContactsPage
          activeContactPtid={
            activeDetail?.routeId === 'detail:contact-profile'
              ? activeDetail.actorPtid
              : null
          }
          activeOverlay={activeOverlay}
          onOpenChat={onOpenDetail}
          onOpenContact={(actorPtid) => onOpenDetail({
            routeId: 'detail:contact-profile',
            actorPtid,
          })}
          onOpenOverlay={onOpenOverlay}
          onCloseOverlay={onCloseOverlay}
          onBack={onBack}
        />
      );
    case 'settings':
      return (
        <SettingsPage
          authSession={authSession}
          stationRegistry={props.stationRegistry}
          activeSettingId={
            activeDetail?.routeId === 'detail:setting'
              ? activeDetail.settingId
              : null
          }
          onOpenSetting={(settingId) => onOpenDetail({
            routeId: 'detail:setting',
            settingId,
          })}
          onBack={onBack}
          onChangeStation={props.onChangeStation}
          onLogout={props.onLogout}
        />
      );
  }
}

export interface MobileShellProps {
  stationRegistry: StoredStationRegistry;
  readonly onChangeStation: () => Promise<void>;
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
  const authSession = useAuthStore((state) => state.session);
  const primaryRouteId = useMobileNavigationStore(
    (state) => state.primaryRouteId,
  );
  const detailStack = useMobileNavigationStore((state) => state.detailStack);
  const activeOverlay = useMobileNavigationStore((state) => state.overlayRoute);
  const navigatePrimary = useMobileNavigationStore(
    (state) => state.navigatePrimary,
  );
  const pushDetail = useMobileNavigationStore((state) => state.pushDetail);
  const popDetail = useMobileNavigationStore((state) => state.popDetail);
  const openOverlay = useMobileNavigationStore((state) => state.openOverlay);
  const closeOverlay = useMobileNavigationStore((state) => state.closeOverlay);
  const contentRef = useRef<HTMLDivElement>(null);

  const sessions = useSocialStore((state) => state.sessions);
  const currentUserPtid = useSocialStore((state) => state.currentUserPtid);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const friendConversationSettings = useSocialStore((state) => state.conversationSettings);
  const groups = useGroupStore((state) => state.groups);
  const groupUnreadCounts = useGroupStore((state) => state.unreadCounts);
  const groupSettings = useGroupStore((state) => state.settings);
  const conversations = useMemo(
    () => projectConversations({ sessions, currentUserPtid, peerOnline }),
    [currentUserPtid, peerOnline, sessions],
  );
  const groupConversations = useMemo(
    () => projectGroupConversations({ groups, unreadCounts: groupUnreadCounts }),
    [groupUnreadCounts, groups],
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

  const activeDetail = activeMobileDetailRoute({ detailStack });
  const activeTab = routeIdToTabId(primaryRouteId) ?? 'chat';
  const renderedTab = detailRouteToTabId(activeDetail) ?? activeTab;

  const saveCurrentLocation = useCallback(() => {
    const state = useMobileNavigationStore.getState();
    const detail = activeMobileDetailRoute(state);
    const locationKey = navigationLocationKey(
      detail ?? state.primaryRouteId,
    );
    saveScrollPosition(locationKey, contentRef.current);
    saveFocusTarget(locationKey);
  }, []);

  const restoreLocation = useCallback((
    route: MobilePrimaryRouteId | MobileDetailRoute,
  ) => {
    requestAnimationFrame(() => {
      const locationKey = navigationLocationKey(route);
      restoreScrollPosition(locationKey, contentRef.current);
      restoreFocusTarget(locationKey, contentRef.current);
    });
  }, []);

  const switchTab = useCallback((tabId: TabId) => {
    const routeId = `tab:${tabId}` as MobilePrimaryRouteId;
    requestSettingsExit(() => {
      saveCurrentLocation();
      navigatePrimary(routeId);
      restoreLocation(routeId);
    });
  }, [navigatePrimary, restoreLocation, saveCurrentLocation]);

  const openDetail = useCallback((route: MobileDetailRoute) => {
    saveCurrentLocation();
    pushDetail(route);
    restoreLocation(route);
  }, [pushDetail, restoreLocation, saveCurrentLocation]);

  const closeDetail = useCallback(() => {
    saveCurrentLocation();
    popDetail();
    const state = useMobileNavigationStore.getState();
    const nextRoute = activeMobileDetailRoute(state) ?? state.primaryRouteId;
    restoreLocation(nextRoute);
  }, [popDetail, restoreLocation, saveCurrentLocation]);

  const hideTabbar = activeDetail !== null;

  return (
    <div className={`mobile-shell ${hideTabbar ? 'tabbar-hidden' : ''}`}>
      <div className="mobile-content" ref={contentRef}>
        <MobileRouteBoundary
          routeId={activeDetail?.routeId ?? primaryRouteId}
          onBack={closeDetail}
        >
          {renderPage(
            renderedTab,
            props,
            authSession,
            activeDetail,
            activeOverlay,
            openDetail,
            openOverlay,
            closeOverlay,
            closeDetail,
          )}
        </MobileRouteBoundary>
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
