import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorDeviceStatus } from '../../gen/proto/domain/actor/actor_pb';

const TEST_CREDENTIAL = ['acceptance', 'fixture'].join('-');

const registered = vi.hoisted(
  () => ({} as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>),
);
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  accountGetActive: vi.fn(),
  accountSetPin: vi.fn(),
  stationAdd: vi.fn(),
  stationList: vi.fn(),
  stationSetActive: vi.fn(),
  loginWithPassword: vi.fn(),
  completeCurrentSession: vi.fn(),
  momentsBootstrap: vi.fn(),
  unlockWithPin: vi.fn(),
  createAcceptanceRevision: vi.fn(),
  currentEndpoint: vi.fn(),
  listDevices: vi.fn(),
  revokeDevice: vi.fn(),
}));
const sessionState = vi.hoisted(() => ({
  authenticated: true,
  currentUser: { actorPtid: 'ptid:primary' } as { actorPtid: string } | null,
  sessionEpoch: 1,
}));
const privateState = vi.hoisted(() => ({
  postsById: {} as Record<string, unknown>,
  scope: {
    actorPtid: 'ptid:primary' as string | null,
    rendererGeneration: 1,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('../../kernel/identityRuntime', () => ({
  identityRuntime: {
    loginWithPassword: mocks.loginWithPassword,
    completeCurrentSession: mocks.completeCurrentSession,
    unlockWithPin: mocks.unlockWithPin,
  },
}));

vi.mock('../../runtimes/momentsRuntime', () => ({
  momentsRuntime: {
    bootstrap: mocks.momentsBootstrap,
  },
}));

vi.mock('../../services/desktop_api', () => ({
  api: {
    accountGetActive: mocks.accountGetActive,
    accountSetPin: mocks.accountSetPin,
    stationAdd: mocks.stationAdd,
    stationList: mocks.stationList,
    stationSetActive: mocks.stationSetActive,
    messagingAcceptanceCurrentEndpoint: mocks.currentEndpoint,
  },
}));

vi.mock('../../services/im-service', () => ({
  imServiceV1: {
    device: {
      list: mocks.listDevices,
      revoke: mocks.revokeDevice,
    },
  },
}));

vi.mock('../../services/messaging-recovery-service', () => ({
  messagingRecoveryService: {
    createAcceptanceRevision: mocks.createAcceptanceRevision,
  },
}));

vi.mock('../../store/privateMoments', () => ({
  usePrivateMomentsStore: {
    getState: () => privateState,
  },
}));

vi.mock('../../store/session', () => ({
  useSessionStore: {
    getState: () => sessionState,
  },
}));

vi.mock('../registry', () => ({
  registerAcceptanceHarness: (
    namespace: string,
    methods: Record<string, (...args: unknown[]) => Promise<unknown>>,
  ) => {
    registered[namespace] = methods;
  },
}));

import { installAcceptanceHarness } from './harness';

function harness() {
  const value = registered['secure-content-fixture'];
  if (!value) throw new Error('fixture harness was not registered');
  return value;
}

describe('Secure Content fixture harness', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    sessionState.authenticated = true;
    sessionState.currentUser = { actorPtid: 'ptid:primary' };
    sessionState.sessionEpoch = 1;
    privateState.postsById = {};
    privateState.scope = {
      actorPtid: 'ptid:primary',
      rendererGeneration: 1,
    };
    mocks.loginWithPassword.mockImplementation(async () => {
      sessionState.authenticated = true;
    });
    mocks.completeCurrentSession.mockResolvedValue(undefined);
    mocks.momentsBootstrap.mockImplementation(async () => {
      privateState.scope = {
        actorPtid: sessionState.currentUser?.actorPtid ?? null,
        rendererGeneration: sessionState.sessionEpoch,
      };
    });
    mocks.invoke.mockResolvedValue({
      ok: true,
      data: {
        recoveryEpoch: 1,
        recoveryPreKeyAvailable: 100,
      },
    });
    installAcceptanceHarness();
  });

  it('replaces a revoked Station session without destructive logout', async () => {
    const result = await harness().restoreSessionWithPassword({
      account: 'alice@p.t',
      password: TEST_CREDENTIAL,
    });

    expect(mocks.loginWithPassword).toHaveBeenCalledWith(
      'alice@p.t',
      TEST_CREDENTIAL,
    );
    expect(mocks.completeCurrentSession).toHaveBeenCalledOnce();
    expect(result).toEqual({
      actorPtid: 'ptid:primary',
      authenticated: true,
    });
  });

  it('provisions two PIN-protected sessions and restores the primary actor', async () => {
    mocks.accountGetActive
      .mockResolvedValueOnce({
        id: 'account-primary',
        provider_user_id: 'ptid:primary',
      })
      .mockResolvedValueOnce({
        id: 'account-secondary',
        provider_user_id: 'ptid:secondary',
      });
    mocks.loginWithPassword.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:secondary' };
      sessionState.authenticated = true;
      sessionState.sessionEpoch += 1;
    });
    mocks.unlockWithPin.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:primary' };
      sessionState.sessionEpoch += 1;
    });
    mocks.invoke
      .mockResolvedValueOnce({
        ok: true,
        data: { accountStorageIdentitySha256: 'a'.repeat(64) },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { accountStorageIdentitySha256: 'b'.repeat(64) },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { accountStorageIdentitySha256: 'a'.repeat(64) },
      });

    const result = await harness().prepareAccountSwitch({
      secondaryAccount: 'secondary@p.t',
      password: TEST_CREDENTIAL,
      pin: '12345678',
    });

    expect(result).toMatchObject({
      primaryAccountId: 'account-primary',
      primaryActorPtid: 'ptid:primary',
      primaryStorageIdentitySha256: 'a'.repeat(64),
      secondaryAccountId: 'account-secondary',
      secondaryActorPtid: 'ptid:secondary',
      secondaryStorageIdentitySha256: 'b'.repeat(64),
    });
    expect(mocks.accountSetPin).toHaveBeenNthCalledWith(
      1,
      'account-primary',
      '12345678',
    );
    expect(mocks.accountSetPin).toHaveBeenNthCalledWith(
      2,
      'account-secondary',
      '12345678',
    );
  });

  it('waits for the original Moments owner to activate the switched account before native attestation', async () => {
    let activate!: () => void;
    mocks.momentsBootstrap.mockImplementation(() => new Promise<void>(resolve => {
      activate = () => {
        privateState.scope = { actorPtid: 'ptid:secondary', rendererGeneration: 2 };
        resolve();
      };
    }));
    mocks.unlockWithPin.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:secondary' };
      sessionState.sessionEpoch = 2;
    });
    mocks.accountGetActive.mockResolvedValue({
      id: 'account-secondary', provider_user_id: 'ptid:secondary',
    });
    mocks.invoke.mockResolvedValue({
      ok: true, data: { accountStorageIdentitySha256: 'b'.repeat(64) },
    });
    const switching = harness().switchPreparedAccount({
      accountId: 'account-secondary', actorPtid: 'ptid:secondary',
      storageIdentitySha256: 'b'.repeat(64), outgoingActorPtid: 'ptid:primary',
      outgoingSessionEpoch: 1, pin: '135790',
    });
    await vi.waitFor(() => expect(mocks.momentsBootstrap).toHaveBeenCalledOnce());
    expect(mocks.invoke).not.toHaveBeenCalled();
    activate();
    await expect(switching).resolves.toMatchObject({
      storageIdentitySha256: 'b'.repeat(64), beforeGeneration: 1, afterGeneration: 2,
    });
    expect(mocks.invoke).toHaveBeenCalledWith(
      'social_private_moments_acceptance_runtime_identity',
      { input: { actor_ptid: 'ptid:secondary', renderer_generation: 2 } },
    );
  });

  it('restores the primary account when secondary native attestation fails and retains the typed refusal', async () => {
    mocks.accountGetActive
      .mockResolvedValueOnce({ id: 'account-primary', provider_user_id: 'ptid:primary' })
      .mockResolvedValueOnce({ id: 'account-secondary', provider_user_id: 'ptid:secondary' });
    mocks.loginWithPassword.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:secondary' };
      sessionState.sessionEpoch += 1;
    });
    mocks.unlockWithPin.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:primary' };
      sessionState.sessionEpoch += 1;
    });
    mocks.invoke
      .mockResolvedValueOnce({ ok: true, data: { accountStorageIdentitySha256: 'a'.repeat(64) } })
      .mockResolvedValueOnce({ ok: false, error: { details: { native_error_code: 'UNAUTHORIZED' } } })
      .mockResolvedValueOnce({ ok: true, data: { accountStorageIdentitySha256: 'a'.repeat(64) } });
    await expect(harness().prepareAccountSwitch({
      secondaryAccount: 'secondary@p.t', password: TEST_CREDENTIAL, pin: '135790',
    })).rejects.toThrow('secureContentFixture.accountStorageIdentityRejected:UNAUTHORIZED');
    expect(mocks.unlockWithPin).toHaveBeenCalledWith('account-primary', '135790');
    expect(sessionState.currentUser?.actorPtid).toBe('ptid:primary');
    expect(privateState.scope).toEqual({ actorPtid: 'ptid:primary', rendererGeneration: 3 });
    expect(mocks.accountSetPin).toHaveBeenCalledOnce();
  });

  it('retains both preparation and primary restoration failures', async () => {
    mocks.accountGetActive
      .mockResolvedValueOnce({ id: 'account-primary', provider_user_id: 'ptid:primary' })
      .mockResolvedValueOnce({ id: 'account-secondary', provider_user_id: 'ptid:secondary' });
    mocks.loginWithPassword.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:secondary' };
      sessionState.sessionEpoch += 1;
    });
    const restoreFailure = new Error('controlled PIN restoration failure');
    mocks.unlockWithPin.mockRejectedValue(restoreFailure);
    mocks.invoke
      .mockResolvedValueOnce({ ok: true, data: { accountStorageIdentitySha256: 'a'.repeat(64) } })
      .mockResolvedValueOnce({ ok: false, error: { details: { native_error_code: 'UNAUTHORIZED' } } });
    const failure = await harness().prepareAccountSwitch({
      secondaryAccount: 'secondary@p.t', password: TEST_CREDENTIAL, pin: '135790',
    }).catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      message: 'secureContentFixture.accountPreparationAndRestoreFailed',
      errors: [expect.objectContaining({
        message: 'secureContentFixture.accountStorageIdentityRejected:UNAUTHORIZED',
      }), restoreFailure],
    });
  });

  it.each([
    ['secure content supervisor is not active', 'AUTHENTICATION_REQUIRED', 'PRIVATE_RUNTIME_INACTIVE'],
    ['secure content Station binding is not complete', 'INTEGRITY_FAILURE', 'STATION_BINDING_INCOMPLETE'],
    ['secure content Station binding identity is inconsistent', 'INTEGRITY_FAILURE', 'STATION_BINDING_INCONSISTENT'],
  ])('identifies the fixed native identity refusal %s', async (message, state, reason) => {
    mocks.accountGetActive.mockResolvedValue({
      id: 'account-primary', provider_user_id: 'ptid:primary',
    });
    mocks.invoke.mockResolvedValue({
      ok: false,
      error: { message, details: { native_error_code: 'PRIVATE_NATIVE_COMMAND_FAILED', state } },
    });

    await expect(harness().prepareAccountSwitch({
      secondaryAccount: 'secondary@p.t', password: TEST_CREDENTIAL, pin: '135790',
    })).rejects.toThrow(
      `secureContentFixture.accountStorageIdentityRejected:PRIVATE_NATIVE_COMMAND_FAILED:${state}:${reason}`,
    );
    expect(mocks.loginWithPassword).not.toHaveBeenCalled();
    expect(mocks.accountSetPin).not.toHaveBeenCalled();
  });

  it('does not expose unknown native identity errors or malformed state fields', async () => {
    mocks.accountGetActive.mockResolvedValue({
      id: 'account-primary', provider_user_id: 'ptid:primary',
    });
    mocks.invoke.mockResolvedValue({
      ok: false,
      error: {
        message: `private path and credential ${TEST_CREDENTIAL}`,
        details: { native_error_code: TEST_CREDENTIAL, state: TEST_CREDENTIAL },
      },
    });

    await expect(harness().prepareAccountSwitch({
      secondaryAccount: 'secondary@p.t', password: TEST_CREDENTIAL, pin: '135790',
    })).rejects.toThrow(
      /^secureContentFixture\.accountStorageIdentityRejected:NATIVE_IDENTITY_UNAVAILABLE$/,
    );
  });

  it('executes an account-switch round trip and proves stale projection removal', async () => {
    privateState.postsById = { stale: {} };
    mocks.unlockWithPin.mockImplementation(async (accountId: string) => {
      sessionState.currentUser = {
        actorPtid: accountId === 'account-secondary'
          ? 'ptid:secondary'
          : 'ptid:primary',
      };
      sessionState.sessionEpoch += 1;
      privateState.postsById = {};
    });
    mocks.invoke
      .mockResolvedValueOnce({
        ok: true,
        data: { accountStorageIdentitySha256: 'b'.repeat(64) },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { accountStorageIdentitySha256: 'a'.repeat(64) },
      });

    const result = await harness().roundTripAccountSwitch({
      primaryAccountId: 'account-primary',
      primaryActorPtid: 'ptid:primary',
      primaryStorageIdentitySha256: 'a'.repeat(64),
      primaryLoginId: 'primary@testnet.local',
      secondaryAccountId: 'account-secondary',
      secondaryActorPtid: 'ptid:secondary',
      secondaryStorageIdentitySha256: 'b'.repeat(64),
      secondaryLoginId: 'secondary@testnet.local',
      pin: '12345678',
      password: TEST_CREDENTIAL,
    });

    expect(result).toMatchObject({
      beforeGeneration: 1,
      afterGeneration: 3,
      staleProjectionCleared: true,
    });
    expect(String((result as { primaryActorPtidSha256: string }).primaryActorPtidSha256))
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it('switches once to a prepared PIN account so the caller can inspect intermediate UI', async () => {
    mocks.unlockWithPin.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:secondary' };
      sessionState.sessionEpoch += 1;
    });
    mocks.accountGetActive.mockResolvedValue({
      id: 'account-secondary', provider_user_id: 'ptid:secondary',
    });
    mocks.invoke.mockResolvedValue({
      ok: true, data: { accountStorageIdentitySha256: 'b'.repeat(64) },
    });
    const result = await harness().switchPreparedAccount({
      accountId: 'account-secondary', actorPtid: 'ptid:secondary',
      storageIdentitySha256: 'b'.repeat(64), outgoingActorPtid: 'ptid:primary',
      outgoingSessionEpoch: 1, pin: '135790',
    });
    expect(result).toMatchObject({
      beforeGeneration: 1, afterGeneration: 2, storageIdentitySha256: 'b'.repeat(64),
    });
    expect(mocks.unlockWithPin).toHaveBeenCalledExactlyOnceWith('account-secondary', '135790');
    expect(mocks.loginWithPassword).not.toHaveBeenCalled();
    expect(sessionState.currentUser?.actorPtid).toBe('ptid:secondary');
  });

  it('rejects a raced prepared switch before issuing a native account command', async () => {
    await expect(harness().switchPreparedAccount({
      accountId: 'account-secondary', actorPtid: 'ptid:secondary',
      storageIdentitySha256: 'b'.repeat(64), outgoingActorPtid: 'ptid:primary',
      outgoingSessionEpoch: 0, pin: '135790',
    })).rejects.toThrow('secureContentFixture.accountSwitchScopeMismatch');
    expect(mocks.unlockWithPin).not.toHaveBeenCalled();
  });

  it('rejects a prepared switch that lands in another account storage partition', async () => {
    mocks.unlockWithPin.mockImplementation(async () => {
      sessionState.currentUser = { actorPtid: 'ptid:secondary' };
      sessionState.sessionEpoch += 1;
    });
    mocks.accountGetActive.mockResolvedValue({
      id: 'account-secondary', provider_user_id: 'ptid:secondary',
    });
    mocks.invoke.mockResolvedValue({
      ok: true, data: { accountStorageIdentitySha256: 'c'.repeat(64) },
    });
    await expect(harness().switchPreparedAccount({
      accountId: 'account-secondary', actorPtid: 'ptid:secondary',
      storageIdentitySha256: 'b'.repeat(64), outgoingActorPtid: 'ptid:primary',
      outgoingSessionEpoch: 1, pin: '135790',
    })).rejects.toThrow('secureContentFixture.preparedAccountSwitchFailed');
  });

  it('rejects an account fixture when the active account does not own the actor', async () => {
    mocks.accountGetActive.mockResolvedValue({
      id: 'account-primary',
      provider_user_id: 'ptid:other',
    });

    await expect(harness().prepareAccountSwitch({
      secondaryAccount: 'secondary@p.t',
      password: TEST_CREDENTIAL,
      pin: '12345678',
    })).rejects.toThrow('secureContentFixture.primaryAccountMissing');
  });

  it('round-trips the approved Station bindings', async () => {
    mocks.stationList
      .mockResolvedValueOnce({
        active_station_peer_id: 'station-four-peer',
        binding: {
          station_peer_id: 'station-four-peer',
          active_route_id: 'station-four-direct',
          route_revision: 1,
          lifecycle_generation: 3,
          phase: 'bound',
        },
        entries: [{
          station_peer_id: 'station-four-peer',
          active_route_id: 'station-four-direct',
          routes: [{
            route_id: 'station-four-direct',
            endpoint_origin: 'https://station-four.example',
          }],
        }],
      })
      .mockResolvedValueOnce({
        active_station_peer_id: 'station-four-peer',
        binding: {
          station_peer_id: 'station-four-peer',
          active_route_id: 'station-four-direct',
          route_revision: 1,
          lifecycle_generation: 3,
          phase: 'bound',
        },
        entries: [{
          station_peer_id: 'station-four-peer',
          active_route_id: 'station-four-direct',
          routes: [{
            route_id: 'station-four-direct',
            endpoint_origin: 'https://station-four.example',
          }],
        }, {
          station_peer_id: 'station-five-peer',
          active_route_id: 'station-five-direct',
          routes: [{
            route_id: 'station-five-direct',
            endpoint_origin: 'https://station-five.example',
          }],
        }],
      })
      .mockResolvedValueOnce({
        active_station_peer_id: 'station-five-peer',
        binding: {
          station_peer_id: 'station-five-peer',
          active_route_id: 'station-five-direct',
          route_revision: 1,
          lifecycle_generation: 4,
          phase: 'bound',
        },
        entries: [{
          station_peer_id: 'station-five-peer',
          active_route_id: 'station-five-direct',
          routes: [{
            route_id: 'station-five-direct',
            endpoint_origin: 'https://station-five.example',
          }],
        }],
      })
      .mockResolvedValueOnce({
        active_station_peer_id: 'station-four-peer',
        binding: {
          station_peer_id: 'station-four-peer',
          active_route_id: 'station-four-direct',
          route_revision: 1,
          lifecycle_generation: 5,
          phase: 'bound',
        },
        entries: [{
          station_peer_id: 'station-four-peer',
          active_route_id: 'station-four-direct',
          routes: [{
            route_id: 'station-four-direct',
            endpoint_origin: 'https://station-four.example',
          }],
        }],
      });

    const result = await harness().roundTripStationSwitch({
      account: 'bob@p.t',
      password: TEST_CREDENTIAL,
      primaryStationUrl: 'https://station-four.example',
      secondaryStationUrl: 'https://station-five.example',
    });

    expect(result).toMatchObject({
      generationBefore: 3,
      generationAfter: 5,
    });
    expect(mocks.stationSetActive).toHaveBeenNthCalledWith(
      1,
      'station-five-peer',
      'station-five-direct',
    );
    expect(mocks.stationSetActive).toHaveBeenNthCalledWith(
      2,
      'station-four-peer',
      'station-four-direct',
    );
  });

  it('maintains the current recovery epoch through the bundled renderer scope', async () => {
    privateState.scope.rendererGeneration = 4;
    const result = await harness().maintainCurrentRecoveryPreKeys({ expectedEpoch: 1 });
    expect(result).toEqual({ recoveryEpoch: 1, recoveryPreKeyAvailable: 100 });
    expect(mocks.createAcceptanceRevision).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith(
      'social_private_moments_acceptance_maintain_prekeys',
      { input: { actor_ptid: 'ptid:primary', renderer_generation: 4 } },
    );
  });

  it('rejects a different recovery epoch without creating another revision', async () => {
    mocks.invoke.mockResolvedValue({
      ok: true, data: { recoveryEpoch: 2, recoveryPreKeyAvailable: 100 },
    });
    await expect(harness().maintainCurrentRecoveryPreKeys({ expectedEpoch: 1 }))
      .rejects.toThrow('secureContentFixture.recoveryPreKeyUnavailable');
    expect(mocks.createAcceptanceRevision).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN])('rejects invalid recovery epoch %s before Native maintenance', async (epoch) => {
    await expect(harness().maintainCurrentRecoveryPreKeys({ expectedEpoch: epoch }))
      .rejects.toThrow('secureContentFixture.recoveryEpochInvalid');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('prepares a recovery epoch and confirms its Recovery PreKey pool', async () => {
    mocks.createAcceptanceRevision.mockResolvedValue({
      backup: { backupId: 'backup-1' },
      recoveryEpoch: 1,
    });

    const result = await harness().prepareHistoricalRecoveryEpoch();

    expect(result).toMatchObject({
      actorPtid: 'ptid:primary',
      backupId: 'backup-1',
      recoveryEpoch: 1,
      recoveryPreKeyAvailable: 100,
    });
    expect(JSON.stringify(result)).not.toContain('recoveryPhrase');
    expect(mocks.invoke).toHaveBeenCalledWith(
      'social_private_moments_acceptance_maintain_prekeys',
      {
        input: {
          actor_ptid: 'ptid:primary',
          renderer_generation: 1,
        },
      },
    );
  });

  it('advances a real Recovery revision without returning the phrase', async () => {
    mocks.createAcceptanceRevision.mockResolvedValue({
      backup: { backupId: 'backup-2' },
      recoveryEpoch: 2,
    });
    mocks.invoke.mockResolvedValue({
      ok: true,
      data: {
        recoveryEpoch: 2,
        recoveryPreKeyAvailable: 99,
      },
    });

    const result = await harness().advanceHistoricalRecoveryEpoch({
      expectedEpoch: 1,
    });

    expect(result).toMatchObject({
      previousEpoch: 1,
      currentEpoch: 2,
      recoveryPreKeyAvailable: 99,
    });
    expect(JSON.stringify(result)).not.toContain('recoveryPhrase');
    expect(mocks.createAcceptanceRevision).toHaveBeenCalledOnce();
  });

  it('returns the committed Actor Identity revocation acknowledgement', async () => {
    mocks.currentEndpoint.mockResolvedValue({
      device_id: 'device-primary',
    });
    mocks.listDevices.mockResolvedValue([{
      ref: { deviceId: 'device-primary' },
      status: ActorDeviceStatus.ACTIVE,
      profileVersion: 4n,
    }]);
    mocks.revokeDevice.mockResolvedValue({
      ref: { deviceId: 'device-primary' },
      status: ActorDeviceStatus.REVOKED,
      profileVersion: 4n,
    });

    const prepared = await harness().preparePublisherDeviceRevocation();
    const result = await harness().revokePublisherDevice({
      deviceId: 'device-primary',
      observedProfileVersion: '4',
    });

    expect(prepared).toMatchObject({
      actorPtid: 'ptid:primary',
      deviceId: 'device-primary',
      observedProfileVersion: '4',
    });
    expect(result).toMatchObject({
      observedProfileVersion: '4',
      committedProfileVersion: '4',
      revoked: true,
    });
  });
});
