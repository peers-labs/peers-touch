/**
 * Descriptor-owned navigation definitions.
 *
 * Each navigation descriptor declares a route pattern, its layout type
 * (primary / detail / overlay), and the owning runtime ID that manages
 * the data projection for that route.
 *
 * The shell reads these descriptors to decide which component to render
 * and which layout slot to place it in, without the page itself making
 * mount-time data fetches.
 */

export type NavigationLayout = 'primary' | 'detail' | 'overlay';

export interface NavigationDescriptor {
  /** Unique route identifier. */
  readonly routeId: string;

  /** Human-readable label key for i18n. */
  readonly labelKey: string;

  /** Layout slot where this route renders. */
  readonly layout: NavigationLayout;

  /**
   * ID of the MobileRuntimeDescriptor that owns data for this route.
   * The runtime must be in 'ready' status before this route can activate.
   */
  readonly ownerRuntimeId: string;

  /**
   * Whether this route should be kept alive when navigating away.
   * Alive routes retain their React tree in the background.
   */
  readonly keepAlive: boolean;
}

// --- Primary Tabs ---

export const primaryTabDescriptors: readonly NavigationDescriptor[] = [
  {
    routeId: 'tab:chat',
    labelKey: 'mobile.tab.chat',
    layout: 'primary',
    ownerRuntimeId: 'social',
    keepAlive: false,
  },
  {
    routeId: 'tab:moments',
    labelKey: 'mobile.tab.moments',
    layout: 'primary',
    ownerRuntimeId: 'social',
    keepAlive: false,
  },
  {
    routeId: 'tab:contacts',
    labelKey: 'mobile.tab.contacts',
    layout: 'primary',
    ownerRuntimeId: 'social',
    keepAlive: false,
  },
  {
    routeId: 'tab:settings',
    labelKey: 'mobile.tab.settings',
    layout: 'primary',
    ownerRuntimeId: 'auth',
    keepAlive: false,
  },
];

// --- Detail Routes ---

export const detailDescriptors: readonly NavigationDescriptor[] = [
  {
    routeId: 'detail:chat-conversation',
    labelKey: 'mobile.nav.chatConversation',
    layout: 'detail',
    ownerRuntimeId: 'social',
    keepAlive: false,
  },
  {
    routeId: 'detail:group-conversation',
    labelKey: 'mobile.nav.groupConversation',
    layout: 'detail',
    ownerRuntimeId: 'group',
    keepAlive: false,
  },
  {
    routeId: 'detail:contact-profile',
    labelKey: 'mobile.nav.contactProfile',
    layout: 'detail',
    ownerRuntimeId: 'social',
    keepAlive: false,
  },
  {
    routeId: 'detail:moment',
    labelKey: 'mobile.nav.momentDetail',
    layout: 'detail',
    ownerRuntimeId: 'social',
    keepAlive: false,
  },
  {
    routeId: 'detail:setting',
    labelKey: 'mobile.nav.settingDetail',
    layout: 'detail',
    ownerRuntimeId: 'auth',
    keepAlive: false,
  },
];

// --- Overlay Routes ---

export const overlayDescriptors: readonly NavigationDescriptor[] = [
  {
    routeId: 'overlay:add-friend',
    labelKey: 'mobile.nav.addFriend',
    layout: 'overlay',
    ownerRuntimeId: 'social',
    keepAlive: false,
  },
  {
    routeId: 'overlay:create-group',
    labelKey: 'mobile.nav.createGroup',
    layout: 'overlay',
    ownerRuntimeId: 'group',
    keepAlive: false,
  },
];

// --- Registry ---

const allDescriptors: readonly NavigationDescriptor[] = [
  ...primaryTabDescriptors,
  ...detailDescriptors,
  ...overlayDescriptors,
];

/**
 * Look up a navigation descriptor by route ID.
 */
export function findNavigationDescriptor(routeId: string): NavigationDescriptor | undefined {
  return allDescriptors.find((d) => d.routeId === routeId);
}

/**
 * Get all navigation descriptors for a specific layout type.
 */
export function navigationDescriptorsByLayout(layout: NavigationLayout): readonly NavigationDescriptor[] {
  return allDescriptors.filter((d) => d.layout === layout);
}

/**
 * Check whether a route's owning runtime is ready.
 * Used by the shell to decide if a route can be activated.
 */
export function isRouteAvailable(
  routeId: string,
  readyRuntimeIds: ReadonlySet<string>,
): boolean {
  const descriptor = findNavigationDescriptor(routeId);
  if (!descriptor) return false;
  return readyRuntimeIds.has(descriptor.ownerRuntimeId);
}
