const CORE_PAGES = ['chat', 'agent', 'settings', 'search', 'notes', 'agent-profile'] as const;

export type CorePage = (typeof CORE_PAGES)[number];
export type Page = CorePage | `applet:${string}` | (string & {});

export function isCorePageOrKnown(segment: string): segment is Page {
  if ((CORE_PAGES as readonly string[]).includes(segment)) return true;
  if (segment.startsWith('applet:')) return true;
  return false;
}

export const CORE_PAGE_LIST = CORE_PAGES;

export interface SettingsNavState {
  tab?: string;
  highlightId?: string;
}

export interface SessionUser {
  name: string;
  email: string;
  avatar?: string;
  /** Account identity ID (e.g. "password:abc" or "github:123"). Present for restorable accounts. */
  accountId?: string;
  /** Whether this account has a PIN set. */
  hasPin?: boolean;
  /** Login provider (e.g. "password", "github"). */
  provider?: string;
}

export type AppState = 'onboarding' | 'resuming' | 'ready';

export interface AppLifecycle {
  state: AppState;
  restoredUser: SessionUser | null;
  knownAccounts: SessionUser[];
  dataReady: boolean;
  completeLogin: () => void;
}

export interface HashRouter {
  page: Page;
  setPage: (page: Page) => void;
  profileAgentName: string;
  setProfileAgentName: (name: string) => void;
  getDocIdFromHash: () => string | undefined;
}

export interface Navigation {
  settingsNav: SettingsNavState;
  navigateTo: (page: Page) => void;
  navigateToSettings: (tab: string, highlightId?: string) => void;
  handleSearchNavigate: (url: string) => void;
}

export interface AppletPins {
  pinnedApplets: string[];
  togglePin: (appletId: string) => void;
}
