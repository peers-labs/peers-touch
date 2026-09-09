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
    };

export type MobileChatDetailRoute = Extract<
  MobileDetailRoute,
  {
    readonly routeId:
      | 'detail:chat-conversation'
      | 'detail:group-conversation';
  }
>;

interface MobileNavigationState {
  readonly primaryRouteId: MobilePrimaryRouteId;
  readonly detailStack: readonly MobileDetailRoute[];
  navigatePrimary: (routeId: MobilePrimaryRouteId) => void;
  pushDetail: (route: MobileDetailRoute) => void;
  popDetail: () => void;
  reset: () => void;
}

const INITIAL_PRIMARY_ROUTE: MobilePrimaryRouteId = 'tab:chat';

export const useMobileNavigationStore = create<MobileNavigationState>((set) => ({
  primaryRouteId: INITIAL_PRIMARY_ROUTE,
  detailStack: [],

  navigatePrimary: (routeId) => {
    requireDescriptor(routeId, 'primary');
    set({
      primaryRouteId: routeId,
      detailStack: [],
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
    }));
  },

  popDetail: () => {
    set((state) => ({
      detailStack: state.detailStack.slice(0, -1),
    }));
  },

  reset: () => {
    set({
      primaryRouteId: INITIAL_PRIMARY_ROUTE,
      detailStack: [],
    });
  },
}));

export function activeMobileDetailRoute(
  state: Pick<MobileNavigationState, 'detailStack'>,
): MobileDetailRoute | null {
  return state.detailStack.at(-1) ?? null;
}

export function navigationLocationKey(
  route: MobilePrimaryRouteId | MobileDetailRoute,
): string {
  if (typeof route === 'string') return route;

  switch (route.routeId) {
    case 'detail:chat-conversation':
      return `${route.routeId}:${route.sessionUlid}`;
    case 'detail:group-conversation':
      return `${route.routeId}:${route.groupUlid}`;
    case 'detail:contact-profile':
      return `${route.routeId}:${route.actorPtid}`;
  }
}

export function resetMobileNavigation(): void {
  useMobileNavigationStore.getState().reset();
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
