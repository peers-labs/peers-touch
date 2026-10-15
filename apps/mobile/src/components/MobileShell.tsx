import { useCallback, useRef, useState } from 'react';
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
  type MobilePrimaryRouteId,
} from '../app/navigation';
import { useAuthStore } from '../features/auth/authStore';
import { useSocialStore } from '../features/social/socialStore';
import type { StoredStationRegistry } from '../features/station/stationRegistry';
import {
  selectChatNavigationBadge,
  selectContactsNavigationBadge,
} from '../features/social/navigationBadgeProjection';
import { MobilePageHost, mobileDetailTab, type MobileTabId } from './MobilePageHost';
import { MobileRouteBoundary } from './MobileRouteBoundary';
import { MobileCallSurface } from './call/MobileCallSurface';

const TAB_ICON_MAP: Record<MobileTabId, typeof MessageCircle> = {
  chat: MessageCircle,
  moments: Image,
  contacts: Users,
  settings: User,
};

/** Map navigation descriptor route IDs to local tab IDs. */
function routeIdToTabId(routeId: string): MobileTabId | null {
  const suffix = routeId.replace('tab:', '');
  if (suffix === 'chat' || suffix === 'moments' || suffix === 'contacts' || suffix === 'settings') {
    return suffix;
  }
  return null;
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
  const [momentsImmersive, setMomentsImmersive] = useState(false);

  const chatBadge = useSocialStore(selectChatNavigationBadge);
  const contactBadge = useSocialStore(selectContactsNavigationBadge);

  const activeDetail = activeMobileDetailRoute({ detailStack });
  const activeTab = routeIdToTabId(primaryRouteId) ?? 'chat';
  const renderedTab = mobileDetailTab(activeDetail) ?? activeTab;

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

  const switchTab = useCallback((tabId: MobileTabId) => {
    const routeId = `tab:${tabId}` as MobilePrimaryRouteId;
    requestSettingsExit(() => {
      saveCurrentLocation();
      navigatePrimary(routeId);
      restoreLocation(routeId);
    });
  }, [navigatePrimary, restoreLocation, saveCurrentLocation]);

  const startConversation = useCallback(() => {
    const routeId: MobilePrimaryRouteId = 'tab:contacts';
    requestSettingsExit(() => {
      saveCurrentLocation();
      navigatePrimary(routeId);
      openOverlay({ routeId: 'overlay:add-friend' });
      restoreLocation(routeId);
    });
  }, [navigatePrimary, openOverlay, restoreLocation, saveCurrentLocation]);

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

  const hideTabbar = activeDetail !== null || momentsImmersive;

  return (
    <div
      className={`mobile-shell ${hideTabbar ? 'tabbar-hidden' : ''}`}
      data-product-surface={`shell.${activeTab}-tab`}
    >
      <div className="mobile-content" ref={contentRef}>
        <MobileRouteBoundary
          routeId={activeDetail?.routeId ?? primaryRouteId}
          onBack={closeDetail}
        >
          <MobilePageHost
            {...props}
            tabId={renderedTab}
            authSession={authSession}
            activeDetail={activeDetail}
            activeOverlay={activeOverlay}
            onStartConversation={startConversation}
            onOpenDetail={openDetail}
            onOpenOverlay={openOverlay}
            onCloseOverlay={closeOverlay}
            onBack={closeDetail}
            onMomentsImmersiveVisibilityChange={setMomentsImmersive}
          />
        </MobileRouteBoundary>
      </div>

      <div
        className="mobile-shell-status-slot"
        data-recovery-status-slot
      />

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
              data-route-id={descriptor.routeId}
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
      <MobileCallSurface />
    </div>
  );
}
