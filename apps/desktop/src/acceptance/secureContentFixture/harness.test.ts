import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorDeviceStatus } from '../../gen/proto/domain/actor/actor_pb';

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
      password: 'password',
    });

    expect(mocks.loginWithPassword).toHaveBeenCalledWith(
      'alice@p.t',
      'password',
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
      password: 'password',
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
      secondaryAccountId: 'account-secondary',
      secondaryActorPtid: 'ptid:secondary',
      secondaryStorageIdentitySha256: 'b'.repeat(64),
      pin: '12345678',
    });

    expect(result).toMatchObject({
      beforeGeneration: 1,
      afterGeneration: 3,
      staleProjectionCleared: true,
    });
    expect(String((result as { primaryActorPtidSha256: string }).primaryActorPtidSha256))
      .toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an account fixture when the active account does not own the actor', async () => {
    mocks.accountGetActive.mockResolvedValue({
      id: 'account-primary',
      provider_user_id: 'ptid:other',
    });

    await expect(harness().prepareAccountSwitch({
      secondaryAccount: 'secondary@p.t',
      password: 'password',
      pin: '12345678',
    })).rejects.toThrow('secureContentFixture.primaryAccountMissing');
  });

  it('round-trips the approved Station bindings', async () => {
    mocks.stationList
      .mockResolvedValueOnce({
        active_url: 'https://station-four.example/',
        binding: {
          bound_url: 'https://station-four.example',
          generation: 3,
          phase: 'bound',
        },
        entries: [{
          peer_id: 'station-four-peer',
          url: 'https://station-four.example',
        }],
      })
      .mockResolvedValueOnce({
        active_url: 'https://station-five.example',
        binding: {
          bound_url: 'https://station-five.example',
          generation: 4,
          phase: 'bound',
        },
        entries: [{
          peer_id: 'station-five-peer',
          url: 'https://station-five.example',
        }],
      })
      .mockResolvedValueOnce({
        active_url: 'https://station-four.example',
        binding: {
          bound_url: 'https://station-four.example',
          generation: 5,
          phase: 'bound',
        },
        entries: [{
          peer_id: 'station-four-peer',
          url: 'https://station-four.example',
        }],
      });

    const result = await harness().roundTripStationSwitch({
      account: 'bob@p.t',
      password: 'password',
      primaryStationUrl: 'https://station-four.example',
      secondaryStationUrl: 'https://station-five.example',
    });

    expect(result).toMatchObject({
      generationBefore: 3,
      generationAfter: 5,
    });
    expect(mocks.stationSetActive).toHaveBeenNthCalledWith(
      1,
      'https://station-five.example',
    );
    expect(mocks.stationSetActive).toHaveBeenNthCalledWith(
      2,
      'https://station-four.example',
    );
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
