import { beforeEach, describe, expect, it, vi } from 'vitest';

const registered = vi.hoisted(
  () => ({} as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>),
);
const state = vi.hoisted(() => ({
  authenticated: false,
  currentUser: null as { actorPtid: string } | null,
  phaseKind: 'accountGate',
  lifecycleState: 'resuming',
  dataReady: true,
  socialActorPtid: 'ptid:alice',
  engineAvailable: true,
}));
const mocks = vi.hoisted(() => ({
  boot: vi.fn(),
  logout: vi.fn(),
  loginWithPassword: vi.fn(),
  completeCurrentSession: vi.fn(),
  installCriticalRuntimes: vi.fn(),
  hydrate: vi.fn(),
  initEncryption: vi.fn(),
}));

vi.mock('../../kernel/identityRuntime', () => ({
  identityRuntime: {
    boot: mocks.boot,
    logout: mocks.logout,
    loginWithPassword: mocks.loginWithPassword,
    completeCurrentSession: mocks.completeCurrentSession,
    getSnapshot: () => ({
      phase: { kind: state.phaseKind },
      lifecycle: { state: state.lifecycleState, dataReady: state.dataReady },
    }),
  },
}));
vi.mock('../../store/session', () => ({
  useSessionStore: { getState: () => state },
}));
vi.mock('../../store/socialChat', () => ({
  useSocialChatStore: {
    getState: () => ({
      currentUserPtid: state.socialActorPtid,
      hydrate: mocks.hydrate,
      initEncryption: mocks.initEncryption,
    }),
  },
  socialThreadKey: vi.fn(),
}));
vi.mock('../../services/appRuntime', () => ({
  installAuthenticatedCriticalRuntimes: mocks.installCriticalRuntimes,
}));
vi.mock('../../messaging/runtime', () => ({ messagingDomainRuntime: {} }));
vi.mock('../../runtimes/chatStorageRuntime', () => ({
  chatStorageProjectionRuntime: {},
}));
vi.mock('../../services/desktop_api', () => ({ api: {} }));
vi.mock('../../services/eventStream', () => ({
  dispatchRealtimeFrameForAcceptance: vi.fn(),
}));
vi.mock('../../services/im-service', () => ({ imServiceV1: {} }));
vi.mock('../../services/socialRealtime', () => ({
  refreshPeerPresence: vi.fn(),
  refreshSocialProjection: vi.fn(),
}));
vi.mock('../../store/relationships', () => ({ useRelationshipsStore: {} }));
vi.mock('../../store/socialProjection', () => ({ messageGroupSeq: vi.fn() }));
vi.mock('../../modules/groupCall', () => ({ groupCallManager: {} }));
vi.mock('../../modules/p2p/callP2p', () => ({ callP2p: {} }));
vi.mock('./nativeBridge', () => ({ nativeAcceptanceBridge: {} }));
vi.mock('../registry', () => ({
  registerAcceptanceHarness: (
    namespace: string,
    methods: Record<string, (...args: unknown[]) => Promise<unknown>>,
  ) => {
    registered[namespace] = methods;
  },
}));

import { installAcceptanceHarness } from './harness';

function chatHarness() {
  const methods = registered.chat;
  if (!methods) throw new Error('Chat harness was not registered');
  return methods;
}

describe('Chat authentication harness', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', {});
    Object.assign(state, {
      authenticated: false,
      currentUser: null,
      phaseKind: 'accountGate',
      lifecycleState: 'resuming',
      dataReady: true,
      socialActorPtid: 'ptid:alice',
      engineAvailable: true,
    });
    mocks.loginWithPassword.mockImplementation(async () => {
      state.authenticated = true;
      state.currentUser = { actorPtid: 'ptid:alice' };
      state.phaseKind = 'authenticatedPendingCompletion';
    });
    mocks.completeCurrentSession.mockImplementation(async () => {
      state.phaseKind = 'authenticated';
      state.lifecycleState = 'ready';
    });
    mocks.initEncryption.mockImplementation(async () => {
      if (!state.engineAvailable) {
        throw new Error('messaging profile engine is not active');
      }
    });
    installAcceptanceHarness();
  });

  it('completes account-gate authentication and returns the actor identity', async () => {
    await expect(chatHarness().loginWithPassword({
      account: 'alice@p.t',
      password: 'test-credential',
    })).resolves.toEqual({ authenticated: true, actorPtid: 'ptid:alice' });
    expect(mocks.loginWithPassword).toHaveBeenCalledWith(
      'alice@p.t', 'test-credential',
    );
    expect(mocks.completeCurrentSession).toHaveBeenCalledOnce();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('authenticates a replacement device before Engine recovery and Social hydration', async () => {
    state.socialActorPtid = 'ptid:previous-actor';
    state.engineAvailable = false;

    await expect(chatHarness().loginWithPassword({
      account: 'alice@p.t',
      password: 'test-credential',
    })).resolves.toEqual({ authenticated: true, actorPtid: 'ptid:alice' });
    expect(mocks.installCriticalRuntimes).not.toHaveBeenCalled();
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.initEncryption).not.toHaveBeenCalled();
  });

  it('propagates rejected authentication without completing or hydrating a session', async () => {
    mocks.loginWithPassword.mockRejectedValueOnce(new Error('invalid credentials'));

    await expect(chatHarness().loginWithPassword({
      account: 'alice@p.t',
      password: 'test-credential',
    })).rejects.toThrow('invalid credentials');
    expect(mocks.completeCurrentSession).not.toHaveBeenCalled();
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.initEncryption).not.toHaveBeenCalled();
  });

  it('requires an active Engine when explicit Chat hydration is requested', async () => {
    state.authenticated = true;
    state.currentUser = { actorPtid: 'ptid:alice' };
    state.engineAvailable = false;

    await expect(chatHarness().hydrateActiveActor()).rejects.toThrow(
      'messaging profile engine is not active',
    );
    expect(mocks.hydrate).toHaveBeenCalledWith('ptid:alice');
    expect(mocks.initEncryption).toHaveBeenCalledOnce();
  });
});
