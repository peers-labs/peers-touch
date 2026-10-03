import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConnections: vi.fn(),
  loadProviders: vi.fn(),
  openExternalUrl: vi.fn(),
  pollLoopback: vi.fn(),
  resumeLoopback: vi.fn(),
  cancelLoopback: vi.fn(),
  startLoopback: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    oauth2ListConnections: mocks.loadConnections,
    oauth2ListProviders: mocks.loadProviders,
    openExternalUrl: mocks.openExternalUrl,
    oauth2PollLoopback: mocks.pollLoopback,
    oauth2ResumeLoopback: mocks.resumeLoopback,
    oauth2CancelLoopback: mocks.cancelLoopback,
    oauth2StartLoopback: mocks.startLoopback,
  },
}));

vi.mock('../kernel/events', () => ({
  EVENT: { OAUTH_CONNECTIONS_CHANGED: 'oauth-connections-changed' },
  eventBus: { publish: vi.fn() },
}));

const { useOAuth2Store } = await import('./oauth2');

describe('OAuth loopback lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.loadConnections.mockResolvedValue([]);
    mocks.loadProviders.mockResolvedValue([]);
    mocks.openExternalUrl.mockResolvedValue(undefined);
    useOAuth2Store.setState({
      providers: [],
      connections: [],
      loading: false,
      error: null,
      completedLoopbackSessionId: null,
      pendingLoopbackSessionId: null,
      pendingLoopbackExpiresAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the native expiry and cancels the loopback before reporting timeout', async () => {
    mocks.startLoopback.mockResolvedValue({
      auth_url: 'https://oauth.test/start',
      session_id: 'lp-timeout',
      expires_in_ms: 50,
    });
    mocks.cancelLoopback.mockResolvedValue({ status: 'cancelled' });

    const result = useOAuth2Store
      .getState()
      .startAuth('github', undefined, 'account_login');
    const rejection = expect(result).rejects.toThrow('oauth authorization timeout');
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(mocks.cancelLoopback).toHaveBeenCalledWith('lp-timeout');
  });

  it('accepts completion when activation wins the timeout cancellation race', async () => {
    mocks.startLoopback.mockResolvedValue({
      auth_url: 'https://oauth.test/start',
      session_id: 'lp-completed',
      expires_in_ms: 50,
    });
    mocks.cancelLoopback.mockResolvedValue({ status: 'completed' });

    const result = useOAuth2Store
      .getState()
      .startAuth('github', undefined, 'account_login');
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBeNull();
    expect(useOAuth2Store.getState().completedLoopbackSessionId).toBe(
      'lp-completed',
    );
  });

  it('polls an acknowledgement-pending resumed login to completion', async () => {
    useOAuth2Store.setState({
      pendingLoopbackSessionId: 'lp-resume',
      pendingLoopbackExpiresAt: Date.now() + 5_000,
    });
    mocks.resumeLoopback.mockResolvedValue({
      status: 'acknowledgement_pending',
    });
    mocks.pollLoopback.mockResolvedValue({
      completed: true,
      status: 'completed',
    });

    const result = useOAuth2Store.getState().completeAccountLogin();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBeNull();
    expect(useOAuth2Store.getState().completedLoopbackSessionId).toBe(
      'lp-resume',
    );
    expect(useOAuth2Store.getState().pendingLoopbackSessionId).toBeNull();
  });

  it('reports an activation that wins explicit cancellation', async () => {
    useOAuth2Store.setState({
      pendingLoopbackSessionId: 'lp-cancel-race',
      pendingLoopbackExpiresAt: Date.now() + 5_000,
    });
    mocks.cancelLoopback.mockResolvedValue({ status: 'completed' });

    await expect(
      useOAuth2Store.getState().cancelAccountLogin(),
    ).resolves.toBe('completed');
    expect(useOAuth2Store.getState().completedLoopbackSessionId).toBe(
      'lp-cancel-race',
    );
    expect(useOAuth2Store.getState().pendingLoopbackSessionId).toBeNull();
  });
});
