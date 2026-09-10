import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IdentityChangePayload } from './identityPipeline';

const mocks = vi.hoisted(() => ({
  authenticated: true,
  currentActorPtid: 'ptid:peer:alice' as string | null,
  handlers: new Map<string, (payload: IdentityChangePayload) => Promise<void>>(),
  sessionReset: vi.fn(),
  socialReset: vi.fn(),
  notificationReset: vi.fn(),
  navigationBadgeReset: vi.fn(),
  accountReset: vi.fn(),
  chatReset: vi.fn(),
  toolReset: vi.fn(),
  closeBrowserCapabilitySession: vi.fn(),
  sidebarReset: vi.fn(),
  globalContextReset: vi.fn(),
  restoreSession: vi.fn(),
}));

vi.mock('./identityPipeline', () => ({
  registerIdentityHandler: (
    name: string,
    handler: (payload: IdentityChangePayload) => Promise<void>,
  ) => {
    mocks.handlers.set(name, handler);
  },
}));

vi.mock('./desktop_api', () => ({
  AuthCommandException: class AuthCommandException extends Error {},
}));

vi.mock('../store/session', () => ({
  useSessionStore: {
    getState: () => ({
      authenticated: mocks.authenticated,
      currentUser: mocks.currentActorPtid
        ? { actorPtid: mocks.currentActorPtid }
        : null,
      reset: mocks.sessionReset,
      restoreSession: mocks.restoreSession,
    }),
  },
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({ reset: mocks.socialReset }),
  },
}));

vi.mock('../store/notification', () => ({
  useNotificationStore: {
    getState: () => ({ reset: mocks.notificationReset }),
  },
}));

vi.mock('../store/navigationBadges', () => ({
  useNavigationBadgeStore: {
    getState: () => ({ reset: mocks.navigationBadgeReset }),
  },
}));

vi.mock('../store/accountIdentity', () => ({
  useAccountIdentityStore: {
    getState: () => ({ reset: mocks.accountReset }),
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => ({ reset: mocks.chatReset }),
  },
}));

vi.mock('../runtimes/toolRuntime', () => ({
  toolRuntime: {
    reset: mocks.toolReset,
  },
}));

vi.mock('../runtimes/agentCapabilityRuntime', () => ({
  closeBrowserCapabilitySession: mocks.closeBrowserCapabilitySession,
}));

vi.mock('../store/sidebar', () => ({
  useSidebarStore: {
    getState: () => ({ reset: mocks.sidebarReset }),
  },
}));

vi.mock('../kernel/global-context/store', () => ({
  useGlobalContextStore: {
    getState: () => ({ reset: mocks.globalContextReset }),
  },
}));

vi.mock('../storage/desktopClientStorage', () => ({
  createDesktopClientStorageRuntime: () => ({
    kernel: {
      invalidateDomains: vi.fn(),
    },
  }),
}));

await import('./identityHandlers');

describe('identity handler actor-scoped projection cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticated = true;
    mocks.currentActorPtid = 'ptid:peer:alice';
  });

  it('clears actor-scoped stores before switching accounts', async () => {
    const closeCapabilitySession = mocks.handlers.get('close-browser-capability-session');
    const handler = mocks.handlers.get('clear-zustand-stores');
    expect(closeCapabilitySession).toBeDefined();
    expect(handler).toBeDefined();

    const payload: IdentityChangePayload = {
      reason: 'switch',
      actorPtid: 'ptid:peer:bob',
      loginMethod: 'password',
    };
    await closeCapabilitySession?.(payload);
    await handler?.(payload);

    expect(mocks.closeBrowserCapabilitySession).toHaveBeenCalledOnce();
    expect(mocks.sessionReset).toHaveBeenCalledOnce();
    expect(mocks.socialReset).toHaveBeenCalledOnce();
    expect(mocks.notificationReset).toHaveBeenCalledOnce();
    expect(mocks.navigationBadgeReset).toHaveBeenCalledOnce();
    expect(mocks.chatReset).toHaveBeenCalledOnce();
    expect(mocks.toolReset).toHaveBeenCalledOnce();
  });

  it('preserves actor-scoped stores when unlocking the same account', async () => {
    const closeCapabilitySession = mocks.handlers.get('close-browser-capability-session');
    const handler = mocks.handlers.get('clear-zustand-stores');
    expect(closeCapabilitySession).toBeDefined();
    expect(handler).toBeDefined();

    const payload: IdentityChangePayload = {
      reason: 'unlock',
      actorPtid: 'ptid:peer:alice',
      loginMethod: 'password',
    };
    await closeCapabilitySession?.(payload);
    await handler?.(payload);

    expect(mocks.closeBrowserCapabilitySession).not.toHaveBeenCalled();
    expect(mocks.sessionReset).not.toHaveBeenCalled();
    expect(mocks.socialReset).not.toHaveBeenCalled();
    expect(mocks.notificationReset).not.toHaveBeenCalled();
    expect(mocks.navigationBadgeReset).not.toHaveBeenCalled();
  });

  it('does not restore a switched account twice', async () => {
    const handler = mocks.handlers.get('refresh-current-session');
    expect(handler).toBeDefined();

    await handler?.({
      reason: 'switch',
      actorPtid: 'ptid:peer:bob',
      loginMethod: 'password',
    });

    expect(mocks.restoreSession).not.toHaveBeenCalled();
  });

  it('preserves an already activated login session', async () => {
    const handler = mocks.handlers.get('refresh-current-session');
    expect(handler).toBeDefined();

    await handler?.({
      reason: 'login',
      actorPtid: 'ptid:peer:alice',
      loginMethod: 'password',
    });

    expect(mocks.restoreSession).not.toHaveBeenCalled();
  });

  it('restores an unauthenticated unlock session', async () => {
    mocks.authenticated = false;
    mocks.currentActorPtid = null;
    const handler = mocks.handlers.get('refresh-current-session');
    expect(handler).toBeDefined();

    await handler?.({
      reason: 'unlock',
      actorPtid: 'ptid:peer:alice',
      loginMethod: 'password',
    });

    expect(mocks.restoreSession).toHaveBeenCalledOnce();
  });
});
