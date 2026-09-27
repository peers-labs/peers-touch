import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accessStart: vi.fn(),
  accessSubmitLogin: vi.fn(),
  ensureStationSession: vi.fn(),
  authLogout: vi.fn(),
  markLocalIdentityAction: vi.fn(),
  runIdentityPipeline: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: {
    accessStart: mocks.accessStart,
    accessSubmitLogin: mocks.accessSubmitLogin,
    ensureStationSession: mocks.ensureStationSession,
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

const authenticatedResponse = {
  command: 'access_submit_login',
  status: 'authenticated',
  actor_ptid: 'ptid:person:new',
  name: 'New',
  email: '',
  login_method: 'password',
};

const loginGate = {
  gateId: 'auth.login',
  gateType: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
  state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
  title: '',
  description: '',
  blockingReason: '',
  submitAction: 'submit_login',
  inputSchemaJson: '',
  alternativeActions: [],
  actionId: 'auth.password',
  schemaRevision: 1,
  schemaDigest: 'a'.repeat(64),
};

describe('session authentication convergence', () => {
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
    mocks.accessStart.mockResolvedValue({
      decision: {
        state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
        attempt_id: 'attempt-1',
        current_gate_id: loginGate.gateId,
        gates: [{
          gate_id: loginGate.gateId,
          gate_type: loginGate.gateType,
          state: loginGate.state,
          title: loginGate.title,
          description: loginGate.description,
          blocking_reason: loginGate.blockingReason,
          submit_action: loginGate.submitAction,
          input_schema_json: loginGate.inputSchemaJson,
          alternative_actions: loginGate.alternativeActions,
          action_id: loginGate.actionId,
          schema_revision: loginGate.schemaRevision,
          schema_digest: loginGate.schemaDigest,
        }],
        access_grant_id: '',
        message: '',
      },
    });
    mocks.accessSubmitLogin.mockResolvedValue(authenticatedResponse);
    mocks.ensureStationSession.mockResolvedValue({
      ...authenticatedResponse,
      login_method: 'github',
    });
  });

  it.each([
    ['password login', () => useSessionStore.getState().loginWithPassword('alice@p.t', 'password')],
    ['access-gate login', () => useSessionStore.getState().accessSubmitLogin('attempt-1', 'alice@p.t', 'password')],
    ['OAuth login', () => useSessionStore.getState().loginWithOAuth('github')],
  ])('activates the authenticated session before the identity pipeline for %s', async (_name, login) => {
    useSessionStore.getState().reset();
    let authenticatedDuringPipeline = false;
    mocks.runIdentityPipeline.mockImplementationOnce(async () => {
      authenticatedDuringPipeline = useSessionStore.getState().authenticated;
      return { ok: true, failures: [] };
    });

    await login();

    expect(authenticatedDuringPipeline).toBe(true);
    expect(useSessionStore.getState().authenticated).toBe(true);
    expect(useSessionStore.getState().currentUser?.actorPtid).toBe('ptid:person:new');
  });

  it('routes password login through the Station access attempt', async () => {
    await useSessionStore.getState().loginWithPassword('alice@p.t', 'password');

    expect(mocks.accessStart).toHaveBeenCalledOnce();
    expect(mocks.accessSubmitLogin).toHaveBeenCalledWith(
      {
        attempt_id: 'attempt-1',
        account: 'alice@p.t',
        password: 'password',
      },
    );
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
