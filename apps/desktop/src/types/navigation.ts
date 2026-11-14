import type { AccountIdentity } from '../services/desktop_api';

export type { AccountIdentity };

const CORE_PAGES = [
  'home',
  'chat',
  'agent',
  'moments',
  'settings',
  'applets',
  'evaluation',
  'agent-profile',
  'agent-orchestration',
  'agent-groups',
  'custom-plugins',
  'tasks',
] as const;

export type CorePage = (typeof CORE_PAGES)[number];
export type Page = CorePage | `applet:${string}`;
export const DEFAULT_READY_PAGE: Page = 'chat';

export function isDesktopAppletAvailable(appletId: string): boolean {
  return appletId !== 'peers.atelier';
}

export function resolveAvailablePage(page: Page): Page {
  // Atelier is withheld until its product design is accepted. Old bookmarks
  // and restored routes return to Chat without removing applet/user data.
  if (page === 'agent-orchestration'
    || (page.startsWith('applet:') && !isDesktopAppletAvailable(page.slice('applet:'.length)))) {
    return 'agent';
  }
  return page;
}

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
  /** Canonical avatar identity (Station path / external URL / data URI). */
  avatar?: string;
  /** Materialized local avatar file used as the decode fast lane. */
  avatarLocalPath?: string;
  /** Typed native avatar state from the latest authoritative sync. */
  avatarState?: 'ready' | 'absent' | 'failed';
  /** Canonical profile revision driving same-URL content swaps. */
  profileRevision?: number;
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
  /** Production login-card password edge: close through the identity runtime. */
  freshPasswordAuthenticated: () => Promise<void>;
  loginWithOAuthBridge: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  unlockWithPin: (accountId: string, pin: string) => Promise<void>;
  refreshCurrentProfile: (fallbackAvatar?: string) => Promise<void>;
  beginPinRecovery: (recoveryId: string, targetLocalAccountId: string, provider: string) => void;
  cancelPinRecovery: () => void;
  completePinRecovery: () => Promise<void>;
}

export interface HashRouter {
  page: Page;
  setPage: (page: Page) => void;
  setProfilePage: (agentName: string) => void;
  resetToDefaultPage: () => void;
  profileAgentName: string;
  setProfileAgentName: (name: string) => void;
}

export interface Navigation {
  settingsNav: SettingsNavState;
  navigateTo: (page: Page) => void;
  navigateToAgentSurface: (agentName: string, surface: 'chat' | 'profile') => void;
  navigateToSettings: (tab: string, highlightId?: string) => void;
}
