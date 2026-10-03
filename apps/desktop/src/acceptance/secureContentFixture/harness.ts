import { invoke } from '@tauri-apps/api/core';
import { ActorDeviceStatus } from '../../gen/proto/domain/actor/actor_pb';
import { identityRuntime } from '../../kernel/identityRuntime';
import { api } from '../../services/desktop_api';
import { imServiceV1 } from '../../services/im-service';
import { messagingRecoveryService } from '../../services/messaging-recovery-service';
import { usePrivateMomentsStore } from '../../store/privateMoments';
import { useSessionStore } from '../../store/session';
import { registerAcceptanceHarness } from '../registry';

interface AccountFixtureInput {
  secondaryAccount: string;
  password: string;
  pin: string;
}

interface SessionRestoreInput {
  account: string;
  password: string;
}

interface AccountSwitchInput {
  primaryAccountId: string;
  primaryActorPtid: string;
  primaryStorageIdentitySha256: string;
  primaryLoginId: string;
  secondaryAccountId: string;
  secondaryActorPtid: string;
  secondaryStorageIdentitySha256: string;
  secondaryLoginId: string;
  pin: string;
  password: string;
}

interface StationFixtureInput {
  secondaryStationUrl: string;
}

interface StationSwitchInput {
  account: string;
  password: string;
  primaryStationUrl: string;
  secondaryStationUrl: string;
}

interface RecoveryAdvanceInput {
  expectedEpoch: number;
}

interface DeviceRevokeInput {
  deviceId: string;
  observedProfileVersion: string;
}

interface RecoveryPreKeyMaintenanceResult {
  ok: boolean;
  data?: {
    recoveryEpoch?: unknown;
    recoveryPreKeyAvailable?: unknown;
  };
}

interface NativeRuntimeIdentityResult {
  ok: boolean;
  data?: {
    accountStorageIdentitySha256?: unknown;
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`secureContentFixture.${field}Missing`);
  }
  return value.trim();
}

function requireCurrentActor(): string {
  return requireText(
    useSessionStore.getState().currentUser?.actorPtid,
    'actorIdentity',
  );
}

function accountOwnsActor(
  account: { provider_user_id?: string },
  actorPtid: string,
): boolean {
  return account.provider_user_id?.trim() === actorPtid;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function completeLogin(): Promise<void> {
  await identityRuntime.completeCurrentSession();
  if (!useSessionStore.getState().authenticated) {
    throw new Error('secureContentFixture.authenticationIncomplete');
  }
}

async function unlockOrReauth(
  accountId: string,
  loginId: string,
  pin: string,
  password: string,
): Promise<void> {
  try {
    await identityRuntime.unlockWithPin(accountId, pin);
    await completeLogin();
  } catch {
    await replaceSessionWithPassword(loginId, password);
  }
}

async function replaceSessionWithPassword(
  account: string,
  password: string,
): Promise<void> {
  await identityRuntime.loginWithPassword(account, password);
  await completeLogin();
}

async function maintainRecoveryPreKeys(expectedEpoch: number): Promise<number> {
  const actorPtid = requireCurrentActor();
  const rendererGeneration = usePrivateMomentsStore.getState().scope.rendererGeneration;
  const result = await invoke<RecoveryPreKeyMaintenanceResult>(
    'social_private_moments_acceptance_maintain_prekeys',
    {
      input: {
        actor_ptid: actorPtid,
        renderer_generation: rendererGeneration,
      },
    },
  );
  const recoveryEpoch = result.data?.recoveryEpoch;
  const recoveryPreKeyAvailable = result.data?.recoveryPreKeyAvailable;
  if (
    result.ok !== true
    || recoveryEpoch !== expectedEpoch
    || typeof recoveryPreKeyAvailable !== 'number'
    || !Number.isSafeInteger(recoveryPreKeyAvailable)
    || recoveryPreKeyAvailable < 1
  ) {
    throw new Error('secureContentFixture.recoveryPreKeyUnavailable');
  }
  return recoveryPreKeyAvailable;
}

async function accountStorageIdentitySha256(): Promise<string> {
  const actorPtid = requireCurrentActor();
  const rendererGeneration = usePrivateMomentsStore.getState().scope.rendererGeneration;
  const result = await invoke<NativeRuntimeIdentityResult>(
    'social_private_moments_acceptance_runtime_identity',
    {
      input: {
        actor_ptid: actorPtid,
        renderer_generation: rendererGeneration,
      },
    },
  );
  return requireText(
    result.ok === true
      ? result.data?.accountStorageIdentitySha256
      : undefined,
    'accountStorageIdentity',
  );
}

async function boundStation() {
  const registry = await api.stationList();
  const activeUrl = requireText(registry.active_url, 'activeStationUrl')
    .replace(/\/+$/, '');
  const boundUrl = requireText(
    registry.binding?.bound_url,
    'boundStationUrl',
  ).replace(/\/+$/, '');
  const active = registry.entries.find(
    (entry) => entry.url.trim().replace(/\/+$/, '') === activeUrl,
  );
  const peerId = requireText(active?.peer_id, 'stationPeerId');
  if (
    registry.binding?.phase !== 'bound'
    || activeUrl !== boundUrl
    || !Number.isSafeInteger(registry.binding.generation)
  ) {
    throw new Error('secureContentFixture.stationBindingIncomplete');
  }
  return {
    generation: registry.binding.generation,
    peerId,
    url: activeUrl,
  };
}

export function installAcceptanceHarness(): void {
  registerAcceptanceHarness('secure-content-fixture', {
    async restoreSessionWithPassword(input: SessionRestoreInput) {
      await replaceSessionWithPassword(
        requireText(input.account, 'account'),
        requireText(input.password, 'password'),
      );
      return {
        actorPtid: requireCurrentActor(),
        authenticated: useSessionStore.getState().authenticated,
      };
    },

    async prepareAccountSwitch(input: AccountFixtureInput) {
      const primaryActorPtid = requireCurrentActor();
      const primaryAccount = await api.accountGetActive();
      if (
        !primaryAccount?.id
        || !accountOwnsActor(primaryAccount, primaryActorPtid)
      ) {
        throw new Error('secureContentFixture.primaryAccountMissing');
      }
      const primaryStorageIdentitySha256 = await accountStorageIdentitySha256();
      await api.accountSetPin(primaryAccount.id, requireText(input.pin, 'pin'));
      await replaceSessionWithPassword(
        requireText(input.secondaryAccount, 'secondaryAccount'),
        requireText(input.password, 'password'),
      );
      const secondaryActorPtid = requireCurrentActor();
      const secondaryAccount = await api.accountGetActive();
      if (
        !secondaryAccount?.id
        || !accountOwnsActor(secondaryAccount, secondaryActorPtid)
        || secondaryAccount.id === primaryAccount.id
        || secondaryActorPtid === primaryActorPtid
      ) {
        throw new Error('secureContentFixture.secondaryAccountMissing');
      }
      const secondaryStorageIdentitySha256 = await accountStorageIdentitySha256();
      if (secondaryStorageIdentitySha256 === primaryStorageIdentitySha256) {
        throw new Error('secureContentFixture.accountStorageIdentityCollision');
      }
      await api.accountSetPin(secondaryAccount.id, input.pin);
      await identityRuntime.unlockWithPin(primaryAccount.id, input.pin);
      await completeLogin();
      if (requireCurrentActor() !== primaryActorPtid) {
        throw new Error('secureContentFixture.primaryAccountRestoreFailed');
      }
      if (await accountStorageIdentitySha256() !== primaryStorageIdentitySha256) {
        throw new Error('secureContentFixture.primaryStorageRestoreFailed');
      }
      return {
        primaryAccountId: primaryAccount.id,
        primaryActorPtid,
        primaryStorageIdentitySha256,
        secondaryAccountId: secondaryAccount.id,
        secondaryActorPtid,
        secondaryStorageIdentitySha256,
        sessionGeneration: useSessionStore.getState().sessionEpoch,
      };
    },

    async roundTripAccountSwitch(input: AccountSwitchInput) {
      const beforeGeneration = useSessionStore.getState().sessionEpoch;
      await unlockOrReauth(
        requireText(input.secondaryAccountId, 'secondaryAccountId'),
        requireText(input.secondaryLoginId, 'secondaryLoginId'),
        requireText(input.pin, 'pin'),
        requireText(input.password, 'password'),
      );
      const secondaryActorPtid = requireCurrentActor();
      if (secondaryActorPtid !== input.secondaryActorPtid) {
        throw new Error('secureContentFixture.secondaryAccountMismatch');
      }
      const secondaryStorageIdentitySha256 = await accountStorageIdentitySha256();
      const clearedProjectionCount = Object.keys(
        usePrivateMomentsStore.getState().postsById,
      ).length;
      await unlockOrReauth(
        requireText(input.primaryAccountId, 'primaryAccountId'),
        requireText(input.primaryLoginId, 'primaryLoginId'),
        input.pin,
        input.password,
      );
      const primaryActorPtid = requireCurrentActor();
      const afterGeneration = useSessionStore.getState().sessionEpoch;
      const primaryStorageIdentitySha256 = await accountStorageIdentitySha256();
      if (
        primaryActorPtid !== input.primaryActorPtid
        || primaryStorageIdentitySha256 !== input.primaryStorageIdentitySha256
        || secondaryStorageIdentitySha256 !== input.secondaryStorageIdentitySha256
        || afterGeneration <= beforeGeneration
      ) {
        throw new Error('secureContentFixture.accountRoundTripFailed');
      }
      return {
        afterGeneration,
        beforeGeneration,
        primaryActorPtidSha256: await sha256(primaryActorPtid),
        primaryStorageIdentitySha256,
        secondaryActorPtidSha256: await sha256(secondaryActorPtid),
        secondaryStorageIdentitySha256,
        staleProjectionCleared: clearedProjectionCount === 0,
      };
    },

    async prepareStationSwitch(input: StationFixtureInput) {
      const primary = await boundStation();
      const secondaryUrl = requireText(
        input.secondaryStationUrl,
        'secondaryStationUrl',
      ).replace(/\/+$/, '');
      if (secondaryUrl === primary.url) {
        throw new Error('secureContentFixture.secondaryStationMustDiffer');
      }
      const secondary = await api.stationAdd(secondaryUrl);
      const secondaryPeerId = requireText(
        secondary.peer_id,
        'secondaryStationPeerId',
      );
      return {
        primaryStationUrl: primary.url,
        primaryStationPeerId: primary.peerId,
        secondaryStationUrl: secondary.url.trim().replace(/\/+$/, ''),
        secondaryStationPeerId: secondaryPeerId,
      };
    },

    async roundTripStationSwitch(input: StationSwitchInput) {
      const before = await boundStation();
      await api.stationSetActive(
        requireText(input.secondaryStationUrl, 'secondaryStationUrl'),
      );
      await replaceSessionWithPassword(
        requireText(input.account, 'account'),
        requireText(input.password, 'password'),
      );
      const secondary = await boundStation();
      await api.stationSetActive(
        requireText(input.primaryStationUrl, 'primaryStationUrl'),
      );
      await replaceSessionWithPassword(input.account, input.password);
      const restored = await boundStation();
      if (
        secondary.url !== input.secondaryStationUrl.replace(/\/+$/, '')
        || restored.url !== input.primaryStationUrl.replace(/\/+$/, '')
        || restored.generation <= before.generation
      ) {
        throw new Error('secureContentFixture.stationRoundTripFailed');
      }
      return {
        generationAfter: restored.generation,
        generationBefore: before.generation,
        primaryStationIdentitySha256: await sha256(
          `${restored.peerId}:${restored.url}`,
        ),
        secondaryStationIdentitySha256: await sha256(
          `${secondary.peerId}:${secondary.url}`,
        ),
      };
    },

    async preparePublisherDeviceRevocation() {
      const actorPtid = requireCurrentActor();
      const endpoint = await api.messagingAcceptanceCurrentEndpoint(actorPtid);
      const deviceId = requireText(endpoint?.device_id, 'publisherDeviceId');
      const devices = await imServiceV1.device.list();
      const current = devices.find(
        (candidate) => candidate.ref?.deviceId === deviceId,
      );
      if (
        !current
        || current.status !== ActorDeviceStatus.ACTIVE
        || current.profileVersion <= 0n
      ) {
        throw new Error('secureContentFixture.publisherDeviceUnavailable');
      }
      return {
        actorPtid,
        deviceId,
        observedProfileVersion: current.profileVersion.toString(),
      };
    },

    async revokePublisherDevice(input: DeviceRevokeInput) {
      const actorPtid = requireCurrentActor();
      const observedProfileVersion = BigInt(
        requireText(input.observedProfileVersion, 'observedProfileVersion'),
      );
      const revoked = await imServiceV1.device.revoke(
        requireText(input.deviceId, 'deviceId'),
        observedProfileVersion,
      );
      if (
        revoked.ref?.deviceId !== input.deviceId
        || revoked.status !== ActorDeviceStatus.REVOKED
        || revoked.profileVersion !== observedProfileVersion
      ) {
        throw new Error('secureContentFixture.publisherDeviceRevokeFailed');
      }
      return {
        actorPtidSha256: await sha256(actorPtid),
        deviceIdSha256: await sha256(input.deviceId),
        observedProfileVersion: observedProfileVersion.toString(),
        committedProfileVersion: revoked.profileVersion.toString(),
        revoked: true,
      };
    },

    async prepareHistoricalRecoveryEpoch() {
      const revision = await messagingRecoveryService.createAcceptanceRevision();
      if (!Number.isSafeInteger(revision.recoveryEpoch) || revision.recoveryEpoch < 1) {
        throw new Error('secureContentFixture.recoveryEpochInvalid');
      }
      const recoveryPreKeyAvailable = await maintainRecoveryPreKeys(
        revision.recoveryEpoch,
      );
      return {
        actorPtid: requireCurrentActor(),
        backupId: revision.backup.backupId,
        recoveryEpoch: revision.recoveryEpoch,
        recoveryPreKeyAvailable,
      };
    },

    async advanceHistoricalRecoveryEpoch(input: RecoveryAdvanceInput) {
      const revision = await messagingRecoveryService.createAcceptanceRevision();
      if (revision.recoveryEpoch !== input.expectedEpoch + 1) {
        throw new Error('secureContentFixture.recoveryEpochDidNotAdvance');
      }
      const recoveryPreKeyAvailable = await maintainRecoveryPreKeys(
        revision.recoveryEpoch,
      );
      return {
        actorPtidSha256: await sha256(requireCurrentActor()),
        backupIdSha256: await sha256(revision.backup.backupId),
        previousEpoch: input.expectedEpoch,
        currentEpoch: revision.recoveryEpoch,
        recoveryPreKeyAvailable,
      };
    },
  });
}
