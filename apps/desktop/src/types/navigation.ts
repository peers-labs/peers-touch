import type { AccountIdentity } from '../services/desktop_api';

export type { AccountIdentity };

const CORE_PAGES = ['chat', 'agent', 'settings', 'search', 'notes', 'agent-profile', 'agent-orchestration'] as const;

export type CorePage = (typeof CORE_PAGES)[number];
export type Page = CorePage | `applet:${string}` | (string & {});
export const DEFAULT_READY_PAGE: Page = 'search';

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

/** Onboarding / picker card user — distinct from `AccountIdentity` (device registry row). */
// TODO(unified-actor): align naming and fields with AccountIdentity where possible.
export interface SessionUser {
  name: string;
  email: string;
  /** Remote avatar URL. Local caching is handled by UserSquareAvatar. */
  avatar?: string;
  /** Account identity ID (e.g. "password:abc" or "github:123"). Present for restorable accounts. */
  accountId?: string;
  /** Whether this account has a PIN set. */
  hasPin?: boolean;
  /** Whether this account has a restorable session (encrypted or plaintext). */
  hasSession?: boolean;
  /** Login provider (e.g. "password", "github"). */
  provider?: string;
}

export type AppState = 'onboarding' | 'resuming' | 'ready';

export interface AppLifecycle {
  state: AppState;
  authenticated: boolean;
  restoredUser: SessionUser | null;
  knownAccounts: SessionUser[];
  dataReady: boolean;
  completeLogin: () => Promise<void>;
  loginWithPassword: (account: string, password: string) => Promise<void>;
  loginWithOAuthBridge: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  unlockWithPin: (accountId: string, pin: string) => Promise<void>;
  refreshCurrentProfile: (fallbackAvatar?: string) => Promise<void>;
}

export interface HashRouter {
  page: Page;
  setPage: (page: Page) => void;
  resetToDefaultPage: () => void;
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
