import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Icon, IconButton, Menu, MobileTabBar, Segmented, Spin, TextField, useMobileTabSwipe } from '@peers-touch/ui';
import type { IconId } from '@peers-touch/ui';

import { useMobileI18n } from '../app/mobileI18n';
import {
  activeMobileDetailRoute,
  navigationLocationKey,
  primaryNavigationLocationKey,
  primaryTabDescriptors,
  requestSettingsExit,
  saveScrollPosition,
  saveFocusTarget,
  clearAllScrollPositions,
  useMobileNavigationStore,
  type MobileDetailRoute,
  type MobileOverlayRoute,
  type MobilePrimaryRouteId,
  type MobileMessagePaneId,
  type MobileMomentsPaneId,
  type MobileMomentsFeedScope,
} from '../app/navigation';
import { ChatPage } from '../pages/ChatPage';
import { ContactsPage } from '../pages/ContactsPage';
import { FindPeoplePage } from '../pages/FindPeoplePage';
import { MomentsPage } from '../pages/MomentsPage';
import { SocialCircleDetailPage } from '../pages/moments/SocialCircleDetailPage';
import { SocialCircleMemberPickerPage } from '../pages/moments/SocialCircleMemberPickerPage';
import { SocialCirclesPage } from '../pages/moments/SocialCirclesPage';
import { SocialProfilePage } from '../pages/moments/SocialProfilePage';
import { SocialSearchPage } from '../pages/moments/SocialSearchPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useAuthStore } from '../features/auth/authStore';
import type { MobileAuthSession } from '../features/auth/authSession';
import { projectConversations, projectPendingInboundRequests } from '../features/social/socialProjection';
import { useSocialStore } from '../features/social/socialStore';
import type {
  MobileStationRouteCandidate,
  StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  visibleChatUnread,
} from '../features/chat/chatActionState';
import { MobileRouteBoundary } from './MobileRouteBoundary';
import { MobileCallSurface } from './call/MobileCallSurface';
import { MobileGroupCallSurface } from './call/MobileGroupCallSurface';
import { MobileNotificationCenter } from './MobileNotificationCenter';
import { useMobilePlatform } from '../services/platform/PlatformContext';
import { mobileSearchActions } from '../runtimes/searchRuntime';
import { SearchEntry } from './SearchEntry';
import { MobileNavigationHost } from './MobileNavigationHost';
import { mobileAuthScopeKey } from '../features/auth/mobileAuthIdentity';

const SearchPage = lazy(() => import('../pages/SearchPage').then(module => ({ default: module.SearchPage })));

type TabId = 'chat' | 'moments' | 'settings';

const TAB_ICON_MAP: Record<TabId, IconId> = {
  chat: 'message-circle',
  moments: 'sparkles',
  settings: 'circle-user',
};

/** Map navigation descriptor route IDs to local tab IDs. */
function routeIdToTabId(routeId: string): TabId | null {
  const suffix = routeId.replace('tab:', '');
  if (suffix === 'chat' || suffix === 'moments' || suffix === 'settings') {
    return suffix;
  }
  return null;
}

function detailRouteToTabId(route: MobileDetailRoute | null): TabId | null {
  switch (route?.routeId) {
    case 'detail:chat-conversation':
    case 'detail:group-conversation':
    case 'detail:contact-profile':
    case 'detail:find-people':
      return 'chat';
    case 'detail:moment':
    case 'detail:social-search':
    case 'detail:social-profile':
    case 'detail:social-circles':
    case 'detail:social-circle':
    case 'detail:social-circle-members':
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
  onStartConversation: () => void,
  onOpenDetail: (route: MobileDetailRoute) => void,
  onOpenOverlay: (route: MobileOverlayRoute) => void,
  onCloseOverlay: () => void,
  onBack: () => void,
  onMomentsImmersiveVisibilityChange: (visible: boolean) => void,
  onOpenSearch: (conversationId?: string) => void,
  messagePane: MobileMessagePaneId,
  messageHeader: ReactNode,
  onMomentsPaneChange: (pane: MobileMomentsPaneId, scope?: MobileMomentsFeedScope) => void,
  onOpenNotifications: () => void,
) {
  if (activeDetail?.routeId === 'detail:search') {
    return <Suspense fallback={<div className="mobile-route-state" role="status"><Spin active /></div>}>
      <SearchPage onBack={onBack} onOpenDetail={onOpenDetail} />
    </Suspense>;
  }
  const searchEntry = <SearchEntry onOpen={() => onOpenSearch()} />;
  if (activeDetail?.routeId === 'detail:find-people') {
    return <FindPeoplePage onBack={onBack} />;
  }
  switch (tabId) {
    case 'chat':
      if (!activeDetail) return <MessagesPage
        activeOverlay={activeOverlay}
        onStartConversation={onStartConversation} onOpenDetail={onOpenDetail}
        onOpenOverlay={onOpenOverlay} onCloseOverlay={onCloseOverlay}
        onBack={onBack}
        onOpenSearch={onOpenSearch} messagePane={messagePane} messageHeader={messageHeader}
      />;
      if (activeDetail?.routeId === 'detail:contact-profile') {
        return <ContactsPage
          activeContactPtid={activeDetail?.routeId === 'detail:contact-profile' ? activeDetail.actorPtid : null}
          activeOverlay={activeOverlay}
          onOpenChat={onOpenDetail}
          onOpenContact={(actorPtid) => onOpenDetail({ routeId: 'detail:contact-profile', actorPtid })}
          onFindPeople={() => onOpenDetail({ routeId: 'detail:find-people' })}
          onOpenOverlay={onOpenOverlay}
          onCloseOverlay={onCloseOverlay}
          onBack={onBack}
          listHeader={messageHeader}
        />;
      }
      return (
        <ChatPage
          activeDetail={
            activeDetail?.routeId === 'detail:chat-conversation'
            || activeDetail?.routeId === 'detail:group-conversation'
              ? activeDetail
              : null
          }
          onStartConversation={onStartConversation}
          onBack={onBack}
          onOpenConversation={onOpenDetail}
          searchEntry={searchEntry}
          onOpenSearch={onOpenSearch}
          listHeader={messageHeader}
        />
      );
    case 'moments':
      if (activeDetail?.routeId === 'detail:social-search') {
        return (
          <SocialSearchPage
            onBack={onBack}
            onOpenProfile={onOpenDetail}
          />
        );
      }
      if (activeDetail?.routeId === 'detail:social-circles') {
        return (
          <SocialCirclesPage
            onBack={onBack}
            onOpenCircle={onOpenDetail}
          />
        );
      }
      if (activeDetail?.routeId === 'detail:social-circle') {
        return (
          <SocialCircleDetailPage
            circleId={activeDetail.circleId}
            onBack={onBack}
            onOpenMembers={onOpenDetail}
          />
        );
      }
      if (activeDetail?.routeId === 'detail:social-circle-members') {
        return (
          <SocialCircleMemberPickerPage
            circleId={activeDetail.circleId}
            onBack={onBack}
          />
        );
      }
      if (activeDetail?.routeId === 'detail:social-profile') {
        return (
          <SocialProfilePage
            actorPtid={activeDetail.actorPtid}
            federationId={activeDetail.federationId}
            onBack={onBack}
            onOpenChat={onOpenDetail}
            onOpenMoment={(postId) => onOpenDetail({
              routeId: 'detail:moment',
              postId,
            })}
          />
        );
      }
      return (
        <MomentsPage
          activePostId={activeDetail?.routeId === 'detail:moment' ? activeDetail.postId : null}
          activeCommentId={activeDetail?.routeId === 'detail:moment' ? activeDetail.commentId : undefined}
          activeReadSource={activeDetail?.routeId === 'detail:moment' ? activeDetail.readSource : undefined}
          onOpenProfile={(actorPtid, federationId) => onOpenDetail({
            routeId: 'detail:social-profile',
            actorPtid,
            federationId,
          })}
          onOpenSearch={() => onOpenDetail({
            routeId: 'detail:social-search',
          })}
          onOpenCircle={onOpenDetail}
          onPaneChange={onMomentsPaneChange}
          onOpenNotifications={onOpenNotifications}
          onOpenGlobalSearch={() => onOpenSearch()}
          onImmersiveVisibilityChange={onMomentsImmersiveVisibilityChange}
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
          onChangeStationRoute={props.onChangeStationRoute}
          onLogout={props.onLogout}
          onOpenNotifications={onOpenNotifications}
        />
      );
  }
}

function MessagesPage(options: {
  activeOverlay: MobileOverlayRoute | null;
  onStartConversation: () => void;
  onOpenDetail: (route: MobileDetailRoute) => void;
  onOpenOverlay: (route: MobileOverlayRoute) => void;
  onCloseOverlay: () => void;
  onBack: () => void;
  onOpenSearch: (conversationId?: string) => void;
  messagePane: MobileMessagePaneId;
  messageHeader: ReactNode;
}) {
  const {
    activeOverlay, onOpenDetail, onOpenOverlay, onCloseOverlay, onBack,
    onStartConversation, onOpenSearch, messagePane, messageHeader,
  } = options;
  const content = messagePane === 'contacts'
    ? <ContactsPage activeContactPtid={null} activeOverlay={activeOverlay}
        onOpenChat={onOpenDetail}
        onOpenContact={actorPtid => onOpenDetail({ routeId: 'detail:contact-profile', actorPtid })}
        onFindPeople={onStartConversation} onOpenOverlay={onOpenOverlay}
        onCloseOverlay={onCloseOverlay} onBack={onBack} listHeader={<></>} />
    : <ChatPage activeDetail={null} onStartConversation={onStartConversation}
        onBack={onBack} onOpenConversation={onOpenDetail}
        searchEntry={<SearchEntry onOpen={() => onOpenSearch()} />}
        onOpenSearch={onOpenSearch} listHeader={<></>} />;
  return <div className="mobile-messages-page">
    {messageHeader}
    <MobileNavigationHost primary={{ key: `tab:chat:${messagePane}`, content }} />
  </div>;
}

export interface MobileShellProps {
  stationRegistry: StoredStationRegistry;
  readonly onChangeStation: () => Promise<void>;
  readonly onChangeStationRoute: (
    stationPeerId: string,
    route: MobileStationRouteCandidate,
  ) => Promise<void>;
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
  const { t, language } = useMobileI18n();
  const platform = useMobilePlatform();
  const authSession = useAuthStore((state) => state.session);
  const identityKey = authSession
    ? `${mobileAuthScopeKey(authSession)}|${authSession.sessionId}`
    : 'signed-out';
  const previousIdentity = useRef(identityKey);
  if (previousIdentity.current !== identityKey) {
    clearAllScrollPositions();
    previousIdentity.current = identityKey;
  }
  const primaryRouteId = useMobileNavigationStore(
    (state) => state.primaryRouteId,
  );
  const detailStack = useMobileNavigationStore((state) => state.detailStack);
  const messagePane = useMobileNavigationStore((state) => state.messagePane);
  const activeOverlay = useMobileNavigationStore((state) => state.overlayRoute);
  const navigatePrimary = useMobileNavigationStore(
    (state) => state.navigatePrimary,
  );
  const navigateMessages = useMobileNavigationStore((state) => state.navigateMessages);
  const navigateMoments = useMobileNavigationStore((state) => state.navigateMoments);
  const setMomentsFeedScope = useMobileNavigationStore((state) => state.setMomentsFeedScope);
  const pushDetail = useMobileNavigationStore((state) => state.pushDetail);
  const popDetail = useMobileNavigationStore((state) => state.popDetail);
  const openOverlay = useMobileNavigationStore((state) => state.openOverlay);
  const closeOverlay = useMobileNavigationStore((state) => state.closeOverlay);
  const contentRef = useRef<HTMLDivElement>(null);
  const [momentsImmersive, setMomentsImmersive] = useState(false);

  const sessions = useSocialStore((state) => state.sessions);
  const currentUserPtid = useSocialStore((state) => state.currentUserPtid);
  const peerOnline = useSocialStore((state) => state.peerOnline);
  const friendRequests = useSocialStore((state) => state.friendRequests);
  const friendConversationSettings = useSocialStore((state) => state.conversationSettings);
  const messagingConversations = useSocialStore((state) => state.messagingConversations);
  const conversationSummaries = useSocialStore((state) => state.conversationSummaries);
  const conversations = useMemo(
    () => projectConversations({ sessions, currentUserPtid, peerOnline }),
    [currentUserPtid, peerOnline, sessions],
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
  ) + messagingConversations.reduce(
    (total, conversation) => conversation.kind === 2 && conversation.active
      ? total + visibleChatUnread(
          conversationSummaries[conversation.conversationId]?.unreadCount ?? 0,
          {
            muted: Boolean(friendConversationSettings[conversation.conversationId]?.isMuted),
            alertEnabled: friendConversationSettings[conversation.conversationId]?.alertEnabled !== false,
          },
        )
      : total,
    0,
  );
  const contactBadge = inboundRequests.length;

  const activeDetail = activeMobileDetailRoute({ detailStack });
  const activeTab = routeIdToTabId(primaryRouteId) ?? 'chat';

  const saveCurrentLocation = useCallback(() => {
    const state = useMobileNavigationStore.getState();
    const detail = activeMobileDetailRoute(state);
    const locationKey = detail ? navigationLocationKey(detail) : primaryNavigationLocationKey(state);
    saveScrollPosition(locationKey, contentRef.current);
    saveFocusTarget(locationKey);
  }, []);

  const switchTab = useCallback((tabId: TabId) => {
    const routeId = `tab:${tabId}` as MobilePrimaryRouteId;
    requestSettingsExit(() => {
      saveCurrentLocation();
      navigatePrimary(routeId);
    });
  }, [navigatePrimary, saveCurrentLocation]);

  const startConversation = useCallback(() => {
    requestSettingsExit(() => {
      saveCurrentLocation();
      pushDetail({ routeId: 'detail:find-people' });
    });
  }, [pushDetail, saveCurrentLocation]);

  const switchMessagePane = useCallback((pane: MobileMessagePaneId) => {
    saveCurrentLocation();
    navigateMessages(pane);
  }, [navigateMessages, saveCurrentLocation]);

  const switchMomentsPane = useCallback((pane: MobileMomentsPaneId, scope?: MobileMomentsFeedScope) => {
    saveCurrentLocation();
    navigateMoments(pane);
    if (scope) setMomentsFeedScope(scope);
  }, [navigateMoments, saveCurrentLocation, setMomentsFeedScope]);

  const openNotifications = useCallback(() => {
    requestSettingsExit(() => openOverlay({ routeId: 'overlay:notifications' }));
  }, [openOverlay]);

  const openMessageOverlay = useCallback((route: MobileOverlayRoute) => {
    saveCurrentLocation();
    navigateMessages('contacts');
    openOverlay(route);
  }, [navigateMessages, openOverlay, saveCurrentLocation]);

  const openDetail = useCallback((route: MobileDetailRoute) => {
    saveCurrentLocation();
    pushDetail(route);
  }, [pushDetail, saveCurrentLocation]);

  const closeDetail = useCallback(() => {
    saveCurrentLocation();
    popDetail();
  }, [popDetail, saveCurrentLocation]);

  const openSearch = useCallback((conversationId = '') => {
    requestSettingsExit(() => {
      mobileSearchActions.prepare(conversationId, language);
      openDetail({ routeId: 'detail:search' });
    });
  }, [language, openDetail]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => Promise<void>) | null = null;
    void platform.subscribeSystemBack(() => {
      const state = useMobileNavigationStore.getState();
      if (state.overlayRoute !== null) {
        state.closeOverlay();
        return;
      }
      if (activeMobileDetailRoute(state) !== null) {
        requestSettingsExit(closeDetail);
        return;
      }
      if (state.primaryRouteId === 'tab:chat' && state.messageSearchOpen) {
        state.setMessageSearchOpen(false);
        state.setMessageQuery(state.messagePane, '');
        return;
      }
      if (state.primaryRouteId === 'tab:moments' && state.momentsSearchOpen) {
        state.setMomentsSearchOpen(false);
        state.setMomentsQuery(state.momentsPane, '');
        return;
      }
      void platform.systemActions.execute({ kind: 'return_to_system' })
        .catch(() => undefined);
    }).then((release) => {
      if (disposed) {
        void release();
        return;
      }
      unsubscribe = release;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      if (unsubscribe) void unsubscribe();
    };
  }, [closeDetail, platform]);

  const hideTabbar = activeDetail !== null || activeOverlay !== null || momentsImmersive;
  const swipeTabs = useMemo(() => primaryTabDescriptors.map(descriptor =>
    routeIdToTabId(descriptor.routeId)!,
  ), []);
  useMobileTabSwipe({
    root: contentRef, enabled: !hideTabbar, items: swipeTabs, value: activeTab,
    onValueChange: switchTab,
  });
  const messageHeader = <MessagesHeader
    pane={messagePane} contactBadge={contactBadge} onPaneChange={switchMessagePane}
    onOpenOverlay={openMessageOverlay} onFindPeople={startConversation}
    onGlobalSearch={() => openSearch()} onOpenNotifications={openNotifications} />;
  const page = (tab: TabId, detail: MobileDetailRoute | null) => (
    <MobileRouteBoundary routeId={detail?.routeId ?? `tab:${tab}`} onBack={closeDetail}>
      {renderPage(tab, props, authSession, detail, activeOverlay,
        startConversation, openDetail, openOverlay, closeOverlay, closeDetail,
        setMomentsImmersive, openSearch, messagePane, messageHeader,
        switchMomentsPane, openNotifications)}
    </MobileRouteBoundary>
  );

  return (
    <div
      className={`mobile-shell ${hideTabbar ? 'tabbar-hidden' : ''}`}
      data-product-surface={activeTab === 'chat' && messagePane === 'contacts'
        ? 'shell.contacts-pane' : `shell.${activeTab}-tab`}
      data-message-pane={activeTab === 'chat' ? messagePane : undefined}
    >
      <div className="mobile-content" ref={contentRef}>
        <MobileNavigationHost key={identityKey}
          primary={{ key: primaryRouteId,
            locationKey: primaryNavigationLocationKey(useMobileNavigationStore.getState()),
            content: page(activeTab, null) }}
          details={detailStack.map(detail => ({
            key: navigationLocationKey(detail),
            content: page(detailRouteToTabId(detail) ?? activeTab, detail),
          }))} />
      </div>

      <div className="mobile-tabbar-host" hidden={hideTabbar}><MobileTabBar
        value={activeTab}
        ariaLabel={t('mobile.navigation.primary')}
        items={primaryTabDescriptors.map((descriptor) => {
          const id = routeIdToTabId(descriptor.routeId)!;
          return { id, routeId: descriptor.routeId, label: t(descriptor.labelKey),
            icon: TAB_ICON_MAP[id], badgeCount: id === 'chat' ? chatBadge + contactBadge : 0 };
        })}
        onValueChange={(id) => switchTab(id as TabId)}
      /></div>
      <MobileCallSurface />
      <MobileGroupCallSurface />
      {activeOverlay?.routeId === 'overlay:notifications' ? (
        <MobileNotificationCenter
          key={`${authSession?.sessionId}:${authSession?.lifecycleGeneration}`}
          open
          onClose={closeOverlay}
          onOpenDetail={openDetail}
          onOpenContacts={() => switchMessagePane('contacts')}
        />
      ) : null}
    </div>
  );
}

/** Same header band owns both scopes; searching replaces only its controls. */
function MessagesHeader({ pane, contactBadge, onPaneChange, onOpenOverlay, onFindPeople, onGlobalSearch, onOpenNotifications }: {
  pane: MobileMessagePaneId;
  contactBadge: number;
  onPaneChange: (pane: MobileMessagePaneId) => void;
  onOpenOverlay: (route: MobileOverlayRoute) => void;
  onFindPeople: () => void;
  onGlobalSearch: () => void;
  onOpenNotifications: () => void;
}) {
  const { t } = useMobileI18n();
  const searchOpen = useMobileNavigationStore((state) => state.messageSearchOpen);
  const query = useMobileNavigationStore((state) => state.messageQueries[pane]);
  const setQuery = useMobileNavigationStore((state) => state.setMessageQuery);
  const setSearchOpen = useMobileNavigationStore((state) => state.setMessageSearchOpen);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    setQuery(pane, '');
    setSearchOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  };
  return <header className="mobile-messages-header" data-rail-search={searchOpen ? 'active' : 'idle'}>
    <h1 className="visually-hidden">{t('mobile.tab.chat')}</h1>
    {searchOpen ? <>
      <div className="mobile-messages-search">
        <TextField appearance="search" reveal density="comfortable"
          data-focus-id={`messages.search.${pane}`}
          leading={<Icon iconId="search" size={18} />}
          value={query} onValueChange={(value) => setQuery(pane, value)}
          placeholder={t(pane === 'contacts' ? 'mobile.contacts.searchPlaceholder' : 'mobile.chat.searchPlaceholder')}
          aria-label={t(pane === 'contacts' ? 'mobile.contacts.searchPlaceholder' : 'mobile.chat.searchPlaceholder')}
          onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }} />
      </div>
      <Button actionId="messages.search.cancel" emphasis="quiet" density="comfortable" onActivate={closeSearch}>
        {t('common.action.cancel')}
      </Button>
    </> : <>
      <div className="mobile-messages-scopes">
        <Segmented<MobileMessagePaneId> label={t('mobile.messages.scope')} density="comfortable"
          value={pane} onValueChange={(value) => { if (value) onPaneChange(value); }}
          options={[
            { value: 'chats', label: t('mobile.chat.title'),
              attributes: { 'data-message-pane-target': 'chats' } as React.HTMLAttributes<HTMLButtonElement> },
            { value: 'contacts', label: <Badge count={contactBadge}>{t('mobile.tab.contacts')}</Badge>,
              attributes: { 'data-message-pane-target': 'contacts' } as React.HTMLAttributes<HTMLButtonElement> },
          ]} />
      </div>
      <IconButton ref={trigger} actionId="messages.search.open" iconId="search" iconSize={19}
        label={t('search.label')} emphasis="quiet" density="comfortable" data-focus-id="messages.search.open"
        onActivate={() => setSearchOpen(true)} />
      <Menu placement="bottom" actions={[
        { id: 'messages.add-friend', label: t('mobile.contacts.findPeople'), leading: <Icon iconId="user-plus" size={18} />,
          onActivate: onFindPeople },
        { id: 'messages.create-group', label: t('mobile.group.create'), leading: <Icon iconId="users" size={18} />,
          onActivate: () => onOpenOverlay({ routeId: 'overlay:create-group' }) },
        { id: 'messages.global-search', label: t('mobile.search.global'), leading: <Icon iconId="search" size={18} />,
          onActivate: onGlobalSearch },
        { id: 'messages.notifications', label: t('mobile.notifications.title'), leading: <Icon iconId="bell" size={18} />,
          onActivate: onOpenNotifications },
      ]}>
        <IconButton actionId="messages.new" iconId="plus" iconSize={22} label={t('mobile.chat.startConversation')}
          emphasis="quiet" density="comfortable" />
      </Menu>
    </>}
  </header>;
}
