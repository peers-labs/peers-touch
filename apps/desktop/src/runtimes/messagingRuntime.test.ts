import { beforeEach, describe, expect, it, vi } from 'vitest';

const domainRuntime = vi.hoisted(() => ({
  configure: vi.fn(),
  install: vi.fn(),
  bootstrap: vi.fn(),
  reconcile: vi.fn(),
  teardown: vi.fn(),
}));

vi.mock('../messaging/runtime', () => ({
  messagingDomainRuntime: domainRuntime,
}));

vi.mock('../services/messagingRealtime', () => ({
  installMessagingRealtimeBridge: vi.fn(),
  refreshMessagingProjection: vi.fn(),
  resetMessagingRealtimeScope: vi.fn(),
  teardownMessagingRealtimeBridge: vi.fn(),
}));

vi.mock('../services/messagingProjection', () => ({
  installMessagingProjectionBridge: vi.fn(),
  teardownMessagingProjectionBridge: vi.fn(),
}));

vi.mock('../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({ resetMessagingProjection: vi.fn() }),
  },
}));

import { messagingRuntime } from './messagingRuntime';

describe('messagingRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    domainRuntime.bootstrap.mockResolvedValue(undefined);
    domainRuntime.reconcile.mockResolvedValue(undefined);
  });

  it('registers as the session-scoped Messaging domain adapter', () => {
    expect(messagingRuntime.id).toBe('messaging');
    expect(messagingRuntime.scope).toBe('session');

    messagingRuntime.install();
    messagingRuntime.teardown();

    expect(domainRuntime.install).toHaveBeenCalledOnce();
    expect(domainRuntime.teardown).toHaveBeenCalledOnce();
  });

  it('delegates bootstrap and reconcile to the domain owner', async () => {
    await messagingRuntime.bootstrap('ptid:actor:alice');
    await messagingRuntime.reconcile?.('foreground');

    expect(domainRuntime.bootstrap).toHaveBeenCalledWith('ptid:actor:alice');
    expect(domainRuntime.reconcile).toHaveBeenCalledWith('foreground');
  });
});
