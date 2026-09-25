import { create } from 'zustand';

import {
  findNavigationDescriptor,
  type NavigationDescriptor,
} from './navigationDescriptors';

export type MobilePrimaryRouteId =
  | 'tab:chat'
  | 'tab:moments'
  | 'tab:contacts'
  | 'tab:settings';

export type MobileSettingDetailId =
  | 'account-info'
  | 'notifications'
  | 'privacy-security'
  | 'safety-number'
  | 'blocked-users'
  | 'chat-settings'
  | 'chat-background'
  | 'station-connection'
  | 'encryption'
  | 'language'
  | 'about';

export type MobileDetailRoute =
  | {
      readonly routeId: 'detail:chat-conversation';
      readonly sessionUlid: string;
    }
  | {
      readonly routeId: 'detail:group-conversation';
      readonly groupUlid: string;
    }
  | {
      readonly routeId: 'detail:contact-profile';
      readonly actorPtid: string;
    }
  | {
      readonly routeId: 'detail:moment';
      readonly postId: string;
    }
  | {
      readonly routeId: 'detail:setting';
      readonly settingId: MobileSettingDetailId;
    };

export type MobileChatDetailRoute = Extract<
  MobileDetailRoute,
  {
    readonly routeId:
      | 'detail:chat-conversation'
      | 'detail:group-conversation';
  }
>;

export type MobileOverlayRoute =
  | {
      readonly routeId: 'overlay:add-friend';
    }
  | {
      readonly routeId: 'overlay:create-group';
    };

export type MobileNavigationIntent =
  | {
      readonly kind: 'primary';
      readonly routeId: MobilePrimaryRouteId;
    }
  | {
      readonly kind: 'detail.push';
      readonly route: MobileDetailRoute;
    }
  | {
      readonly kind: 'detail.pop';
    }
  | {
      readonly kind: 'overlay.open';
      readonly route: MobileOverlayRoute;
    }
  | {
      readonly kind: 'overlay.close';
    }
  | {
      readonly kind: 'reset';
    };

export interface MobileNavigationProjection {
  readonly primaryRouteId: MobilePrimaryRouteId;
  readonly detailKeys: readonly string[];
  readonly overlayRouteId: MobileOverlayRoute['routeId'] | null;
}

interface MobileNavigationState {
  readonly primaryRouteId: MobilePrimaryRouteId;
  readonly detailStack: readonly MobileDetailRoute[];
  readonly overlayRoute: MobileOverlayRoute | null;
  navigatePrimary: (routeId: MobilePrimaryRouteId) => void;
  pushDetail: (route: MobileDetailRoute) => void;
  popDetail: () => void;
  openOverlay: (route: MobileOverlayRoute) => void;
  closeOverlay: () => void;
  reset: () => void;
}

const INITIAL_PRIMARY_ROUTE: MobilePrimaryRouteId = 'tab:chat';

export const useMobileNavigationStore = create<MobileNavigationState>((set) => ({
  primaryRouteId: INITIAL_PRIMARY_ROUTE,
  detailStack: [],
  overlayRoute: null,

  navigatePrimary: (routeId) => {
    requireDescriptor(routeId, 'primary');
    set({
      primaryRouteId: routeId,
      detailStack: [],
      overlayRoute: null,
    });
  },

  pushDetail: (route) => {
    requireDescriptor(route.routeId, 'detail');
    set((state) => ({
      detailStack: [
        ...state.detailStack.filter(
          (entry) => navigationLocationKey(entry) !== navigationLocationKey(route),
        ),
        route,
      ],
      overlayRoute: null,
    }));
  },

  popDetail: () => {
    set((state) => ({
      detailStack: state.detailStack.slice(0, -1),
    }));
  },

  openOverlay: (route) => {
    requireDescriptor(route.routeId, 'overlay');
    set({ overlayRoute: route });
  },

  closeOverlay: () => {
    set({ overlayRoute: null });
  },

  reset: () => {
    set({
      primaryRouteId: INITIAL_PRIMARY_ROUTE,
      detailStack: [],
      overlayRoute: null,
    });
  },
}));

export function activeMobileDetailRoute(
  state: Pick<MobileNavigationState, 'detailStack'>,
): MobileDetailRoute | null {
  return state.detailStack.at(-1) ?? null;
}

export function navigationLocationKey(
  route: MobilePrimaryRouteId | MobileDetailRoute | MobileOverlayRoute,
): string {
  if (typeof route === 'string') return route;

  switch (route.routeId) {
    case 'detail:chat-conversation':
      return `${route.routeId}:${route.sessionUlid}`;
    case 'detail:group-conversation':
      return `${route.routeId}:${route.groupUlid}`;
    case 'detail:contact-profile':
      return `${route.routeId}:${route.actorPtid}`;
    case 'detail:moment':
      return `${route.routeId}:${route.postId}`;
    case 'detail:setting':
      return `${route.routeId}:${route.settingId}`;
    case 'overlay:add-friend':
    case 'overlay:create-group':
      return route.routeId;
  }
}

export function resetMobileNavigation(): void {
  useMobileNavigationStore.getState().reset();
}

export function readMobileNavigationProjection(): MobileNavigationProjection {
  const navigation = useMobileNavigationStore.getState();
  return {
    primaryRouteId: navigation.primaryRouteId,
    detailKeys: navigation.detailStack.map(navigationLocationKey),
    overlayRouteId: navigation.overlayRoute?.routeId ?? null,
  };
}

export function applyMobileNavigationIntent(
  intent: MobileNavigationIntent,
): MobileNavigationProjection {
  const navigation = useMobileNavigationStore.getState();
  switch (intent.kind) {
    case 'primary':
      navigation.navigatePrimary(intent.routeId);
      break;
    case 'detail.push':
      navigation.pushDetail(intent.route);
      break;
    case 'detail.pop':
      navigation.popDetail();
      break;
    case 'overlay.open':
      navigation.openOverlay(intent.route);
      break;
    case 'overlay.close':
      navigation.closeOverlay();
      break;
    case 'reset':
      navigation.reset();
      break;
  }
  return readMobileNavigationProjection();
}

function requireDescriptor(
  routeId: string,
  expectedLayout: NavigationDescriptor['layout'],
): NavigationDescriptor {
  const descriptor = findNavigationDescriptor(routeId);
  if (!descriptor || descriptor.layout !== expectedLayout) {
    throw new Error(`mobile.navigation.invalidRoute:${routeId}`);
  }
  return descriptor;
}
