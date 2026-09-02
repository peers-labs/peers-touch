import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authLogout: vi.fn(),
  markLocalIdentityAction: vi.fn(),
  runIdentityPipeline: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    authLogout: mocks.authLogout,
  },
  AuthCommandException: class AuthCommandException extends Error {},
}));

vi.mock('../services/identity_event', () => ({
  markLocalIdentityAction: mocks.markLocalIdentityAction,
}));

vi.mock('../services/identityPipeline', () => ({
  runIdentityPipeline: mocks.runIdentityPipeline,
}));

const { useSessionStore } = await import('./session');

describe('session logout convergence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      authenticated: true,
      restoring: false,
      currentUser: {
        actorPtid: 'ptid:person:alice',
        name: 'Alice',
        email: '',
        loginMethod: 'password',
      },
    });
    mocks.runIdentityPipeline.mockImplementation(async () => {
      useSessionStore.getState().reset();
      return { ok: true, failures: [] };
    });
  });

  it('runs the identity pipeline before propagating native cleanup failure', async () => {
    const order: string[] = [];
    const cleanupError = new Error('logout cleanup failed');
    mocks.authLogout.mockImplementation(async () => {
      order.push('native-cleanup');
      throw cleanupError;
    });
    mocks.runIdentityPipeline.mockImplementation(async () => {
      order.push('identity-pipeline');
      useSessionStore.getState().reset();
      return { ok: true, failures: [] };
    });

    await expect(useSessionStore.getState().logout()).rejects.toBe(cleanupError);

    expect(order).toEqual(['native-cleanup', 'identity-pipeline']);
    expect(useSessionStore.getState().authenticated).toBe(false);
    expect(useSessionStore.getState().currentUser).toBeNull();
  });
});
