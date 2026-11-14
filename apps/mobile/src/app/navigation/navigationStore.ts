import { create } from 'zustand';

import {
  findNavigationDescriptor,
  type NavigationDescriptor,
} from './navigationDescriptors';

export type MobilePrimaryRouteId =
  | 'tab:chat'
  | 'tab:moments'
  | 'tab:settings';

export type MobileMessagePaneId = 'chats' | 'contacts';
export type MobileMomentsPaneId = 'feed' | 'circles';
export type MobileMomentsFeedScope = 'home' | 'explore';

export type MobileSettingDetailId =
  | 'account-info'
  | 'credentials'
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
      readonly messageId?: string;
      readonly threadRootMessageId?: string;
    }
  | {
      readonly routeId: 'detail:group-conversation';
      readonly groupUlid: string;
      readonly messageId?: string;
      readonly threadRootMessageId?: string;
    }
  | {
      readonly routeId: 'detail:search';
    }
  | {
      readonly routeId: 'detail:find-people';
    }
  | {
      readonly routeId: 'detail:contact-profile';
      readonly actorPtid: string;
    }
  | {
      readonly routeId: 'detail:moment';
      readonly postId: string;
      readonly commentId?: string;
      readonly readSource?: 'device' | 'station';
    }
  | {
      readonly routeId: 'detail:social-search';
    }
  | {
      readonly routeId: 'detail:social-profile';
      readonly actorPtid: string;
      readonly federationId: string;
    }
  | {
      readonly routeId: 'detail:social-circles';
    }
  | {
      readonly routeId: 'detail:social-circle';
      readonly circleId: string;
    }
  | {
      readonly routeId: 'detail:social-circle-members';
      readonly circleId: string;
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
      readonly routeId: 'overlay:notifications';
    }
  | {
      readonly routeId: 'overlay:create-group';
    };

export type MobileNavigationIntent =
  | {
      readonly kind: 'moments';
      readonly pane: MobileMomentsPaneId;
    }
  | {
      readonly kind: 'moments.search';
      readonly pane: MobileMomentsPaneId;
      readonly query: string;
      readonly open: boolean;
    }
  | {
      readonly kind: 'messages.search';
      readonly pane: MobileMessagePaneId;
      readonly query: string;
      readonly open: boolean;
    }
  | {
      readonly kind: 'messages';
      readonly pane: MobileMessagePaneId;
    }
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
  readonly messagePane: MobileMessagePaneId;
  readonly momentsPane: MobileMomentsPaneId;
  readonly detailKeys: readonly string[];
  readonly overlayRouteId: MobileOverlayRoute['routeId'] | null;
}

interface MobileNavigationState {
  readonly primaryRouteId: MobilePrimaryRouteId;
  readonly messagePane: MobileMessagePaneId;
  readonly messageSearchOpen: boolean;
  readonly messageQueries: Readonly<Record<MobileMessagePaneId, string>>;
  readonly momentsPane: MobileMomentsPaneId;
  readonly momentsFeedScope: MobileMomentsFeedScope;
  readonly momentsSearchOpen: boolean;
  readonly momentsQueries: Readonly<Record<MobileMomentsPaneId, string>>;
  readonly detailStack: readonly MobileDetailRoute[];
  readonly overlayRoute: MobileOverlayRoute | null;
  navigatePrimary: (routeId: MobilePrimaryRouteId) => void;
  navigateMessages: (pane: MobileMessagePaneId) => void;
  setMessageSearchOpen: (open: boolean) => void;
  setMessageQuery: (pane: MobileMessagePaneId, query: string) => void;
  navigateMoments: (pane: MobileMomentsPaneId) => void;
  setMomentsFeedScope: (scope: MobileMomentsFeedScope) => void;
  setMomentsSearchOpen: (open: boolean) => void;
  setMomentsQuery: (pane: MobileMomentsPaneId, query: string) => void;
  pushDetail: (route: MobileDetailRoute) => void;
  popDetail: () => void;
  openOverlay: (route: MobileOverlayRoute) => void;
  closeOverlay: () => void;
  reset: () => void;
}

const INITIAL_PRIMARY_ROUTE: MobilePrimaryRouteId = 'tab:chat';

export const useMobileNavigationStore = create<MobileNavigationState>((set) => ({
  primaryRouteId: INITIAL_PRIMARY_ROUTE,
  messagePane: 'chats',
  messageSearchOpen: false,
  messageQueries: { chats: '', contacts: '' },
  momentsPane: 'feed',
  momentsFeedScope: 'home',
  momentsSearchOpen: false,
  momentsQueries: { feed: '', circles: '' },
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

  navigateMessages: (messagePane) => {
    set({
      primaryRouteId: 'tab:chat',
      messagePane,
      messageSearchOpen: false,
      detailStack: [],
      overlayRoute: null,
    });
  },

  setMessageSearchOpen: (messageSearchOpen) => set({ messageSearchOpen }),
  setMessageQuery: (pane, query) => set((state) => ({
    messageQueries: { ...state.messageQueries, [pane]: query },
  })),

  navigateMoments: (momentsPane) => set({
    primaryRouteId: 'tab:moments', momentsPane, momentsSearchOpen: false,
    detailStack: [], overlayRoute: null,
  }),
  setMomentsFeedScope: (momentsFeedScope) => set({ momentsFeedScope }),
  setMomentsSearchOpen: (momentsSearchOpen) => set({ momentsSearchOpen }),
  setMomentsQuery: (pane, query) => set(state => ({
    momentsQueries: { ...state.momentsQueries, [pane]: query },
  })),

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
      messagePane: 'chats',
      messageSearchOpen: false,
      messageQueries: { chats: '', contacts: '' },
      momentsPane: 'feed',
      momentsFeedScope: 'home',
      momentsSearchOpen: false,
      momentsQueries: { feed: '', circles: '' },
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
      return `${route.routeId}:${route.sessionUlid}${route.messageId ? `:${route.messageId}` : ''}`;
    case 'detail:group-conversation':
      return `${route.routeId}:${route.groupUlid}${route.messageId ? `:${route.messageId}` : ''}`;
    case 'detail:search':
    case 'detail:find-people':
      return route.routeId;
    case 'detail:contact-profile':
      return `${route.routeId}:${route.actorPtid}`;
    case 'detail:moment':
      return `${route.routeId}:${route.postId}${route.commentId ? `:${route.commentId}` : ''}${route.readSource ? `:${route.readSource}` : ''}`;
    case 'detail:social-search':
      return route.routeId;
    case 'detail:social-profile':
      return `${route.routeId}:${route.actorPtid}:${route.federationId}`;
    case 'detail:social-circles':
      return route.routeId;
    case 'detail:social-circle':
    case 'detail:social-circle-members':
      return `${route.routeId}:${route.circleId}`;
    case 'detail:setting':
      return `${route.routeId}:${route.settingId}`;
    case 'overlay:create-group':
    case 'overlay:notifications':
      return route.routeId;
  }
}

/** Primary panes retain independent scroll and focus contexts. */
export function primaryNavigationLocationKey(
  state: Pick<MobileNavigationState, 'primaryRouteId' | 'messagePane'>
    & Partial<Pick<MobileNavigationState, 'momentsPane' | 'momentsFeedScope'>>,
): string {
  if (state.primaryRouteId === 'tab:chat') return `tab:chat:${state.messagePane}`;
  if (state.primaryRouteId === 'tab:moments') {
    return `tab:moments:${state.momentsPane ?? 'feed'}:${state.momentsFeedScope ?? 'home'}`;
  }
  return state.primaryRouteId;
}

export function resetMobileNavigation(): void {
  useMobileNavigationStore.getState().reset();
}

export function readMobileNavigationProjection(): MobileNavigationProjection {
  const navigation = useMobileNavigationStore.getState();
  return {
    primaryRouteId: navigation.primaryRouteId,
    messagePane: navigation.messagePane,
    momentsPane: navigation.momentsPane,
    detailKeys: navigation.detailStack.map(navigationLocationKey),
    overlayRouteId: navigation.overlayRoute?.routeId ?? null,
  };
}

export function applyMobileNavigationIntent(
  intent: MobileNavigationIntent,
): MobileNavigationProjection {
  const navigation = useMobileNavigationStore.getState();
  switch (intent.kind) {
    case 'moments':
      navigation.navigateMoments(intent.pane);
      break;
    case 'moments.search':
      navigation.setMomentsQuery(intent.pane, intent.query);
      navigation.setMomentsSearchOpen(intent.open);
      break;
    case 'messages.search':
      navigation.setMessageQuery(intent.pane, intent.query);
      navigation.setMessageSearchOpen(intent.open);
      break;
    case 'messages':
      navigation.navigateMessages(intent.pane);
      break;
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
