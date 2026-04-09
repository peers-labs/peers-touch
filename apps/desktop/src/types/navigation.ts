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
}

export type AppState = 'onboarding' | 'ready';

export interface AppLifecycle {
  state: AppState;
  restoredUser: SessionUser | null;
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
