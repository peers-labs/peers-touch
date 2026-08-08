// Direct-message crypto runtime.
//
// Runtime descriptor managing the crypto subsystem lifecycle:
// - Identity initialization on bootstrap
// - Key rotation scheduling
// - Backup scheduling
// - Safety number change detection
// - Multi-device session establishment coordination

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { log } from '../utils/logger';
import { EVENT, eventBus } from '../kernel/events';
import { CryptoServiceError, cryptoService } from '../services/crypto-service';
import type {
  CryptoBackupCreateResult,
  CryptoBackupRestoreResult,
  CryptoDeviceAddress,
  RecoveryBackupMetadata,
} from '../services/crypto-service';
import { imServiceV1 } from '../services/im-service';
import { DirectKeyExchangeKind } from '../services/im-service-contract';
import {
  DirectSessionInitSchema,
  type DirectSessionInit,
} from '../gen/proto/domain/chat/key_exchange_pb';
import {
  DeviceEncryptedPayloadSchema,
  type DeviceEncryptedPayload,
} from '../gen/proto/domain/chat/conversation_pb';
import { EncryptedMessageSchema } from '../gen/proto/domain/chat/friend_chat_pb';
import { useCryptoStore } from '../store/cryptoStore';
import { useSocialChatStore } from '../store/socialChat';
import { readDesktopDomainValueSync } from '../storage/desktopClientStorage';

// ---------------------------------------------------------------------------
// Internal state (not exposed to UI — runtime-private)
// ---------------------------------------------------------------------------

interface CryptoRuntimeState {
  initialized: boolean;
  actorPtid: string | null;
  deviceId: string | null;
  keyRotationTimerId: ReturnType<typeof setInterval> | null;
  backupTimerId: ReturnType<typeof setInterval> | null;
}

const state: CryptoRuntimeState = {
  initialized: false,
  actorPtid: null,
  deviceId: null,
  keyRotationTimerId: null,
  backupTimerId: null,
};

// Intervals
const KEY_ROTATION_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const BACKUP_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ONE_TIME_KEY_LOW_THRESHOLD = 5;

let eventUnsubscribers: Array<() => void> = [];

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

async function checkAndRotateKeys(): Promise<void> {
  if (!state.initialized) return;
  try {
    const status = await cryptoService.getKeyRotationStatus();
    useCryptoStore.getState().setKeyRotationStatus(status);

    if (status.rotationNeeded || status.oneTimePreKeysRemaining < ONE_TIME_KEY_LOW_THRESHOLD) {
      log.info('crypto-runtime', 'key rotation triggered', {
        signedPreKeyAgeMs: status.signedPreKeyAgeMs,
        oneTimePreKeysRemaining: status.oneTimePreKeysRemaining,
      });
      const newBundle = await cryptoService.rotateKeys();
      await cryptoService.uploadKeyBundle(newBundle);
      // Re-check status after rotation
      const updatedStatus = await cryptoService.getKeyRotationStatus();
      useCryptoStore.getState().setKeyRotationStatus(updatedStatus);
      log.info('crypto-runtime', 'key rotation complete', {
        oneTimePreKeysRemaining: updatedStatus.oneTimePreKeysRemaining,
      });
    }
  } catch (err) {
    log.warn('crypto-runtime', 'key rotation check failed', { err });
  }
}

// ---------------------------------------------------------------------------
// Backup scheduling
// ---------------------------------------------------------------------------

async function checkAndScheduleBackup(): Promise<void> {
  if (!state.initialized) return;
  try {
    const status = await cryptoService.getBackupStatus();
    useCryptoStore.getState().setBackupStatus(status);
  } catch (err) {
    log.warn('crypto-runtime', 'backup check failed', { err });
  }
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Uint8Array) {
      return bytesToBase64(item);
    }
    return item;
  })) as unknown;
}

function collectRecoveryBackupMetadata(): RecoveryBackupMetadata {
  const social = useSocialChatStore.getState();
  const conversations = [
    ...social.sessions
      .filter(session => session.ulid)
      .map(session => ({
        scope: 'friend' as const,
        conversationId: session.ulid,
        metadata: jsonSafe(session),
      })),
    ...social.groups
      .filter(group => group.ulid)
      .map(group => ({
        scope: 'group' as const,
        conversationId: group.ulid,
        metadata: jsonSafe(group),
      })),
  ];

  const attachments = new Map<string, RecoveryBackupMetadata['attachments'][number]>();
  const messageSets = [
    ...Object.values(social.messages),
    ...Object.values(social.threadMessages),
  ];
  for (const messages of messageSets) {
    for (const message of messages) {
      const messageId = message.ulid;
      const messageAttachments = (message as typeof message & { attachments?: unknown[] }).attachments;
      if (!messageId || !Array.isArray(messageAttachments)) continue;
      for (const [index, attachment] of messageAttachments.entries()) {
        if (!attachment || typeof attachment !== 'object') continue;
        const record = attachment as Record<string, unknown>;
        const attachmentId = String(
          record.cid ?? record.id ?? record.filename ?? `attachment-${index}`,
        );
        attachments.set(`${messageId}\u0000${attachmentId}`, {
          messageId,
          attachmentId,
          metadata: jsonSafe(record),
        });
      }
    }
  }

  const actorPtid = state.actorPtid ?? social.currentUserDid ?? '';
  const trust = readDesktopDomainValueSync<Record<string, {
    peerDid?: string;
    verifiedFingerprint?: string;
    verifiedAt?: number;
  }>>('identity.trust', `socialChat:trust:${actorPtid || 'anon'}`) ?? {};
  const verifiedFingerprints = Object.values(trust)
    .filter(record => Boolean(record.peerDid && record.verifiedFingerprint))
    .map(record => ({
      peerPtid: record.peerDid!,
      fingerprint: record.verifiedFingerprint!,
      verifiedAtUnixMs: record.verifiedAt ?? 0,
    }));
  return {
    conversations,
    attachments: Array.from(attachments.values()),
    verifiedFingerprints,
  };
}

export async function refreshRecoveryBackupStatus(): Promise<void> {
  const status = await cryptoService.getBackupStatus();
  useCryptoStore.getState().setBackupStatus(status);
}

export async function createRecoveryBackup(
  recoveryPhrase: string,
): Promise<CryptoBackupCreateResult> {
  const store = useCryptoStore.getState();
  store.setBackupInProgress(true);
  try {
    const result = await cryptoService.createBackup(
      recoveryPhrase,
      collectRecoveryBackupMetadata(),
    );
    store.setBackupResult(result);
    return result;
  } finally {
    useCryptoStore.getState().setBackupInProgress(false);
  }
}

export async function restoreLatestRecoveryBackup(
  recoveryPhrase: string,
): Promise<CryptoBackupRestoreResult> {
  const store = useCryptoStore.getState();
  store.setRestoreInProgress(true);
  try {
    const result = await cryptoService.restoreLatestBackup(recoveryPhrase);
    state.deviceId = result.deviceId;
    state.initialized = true;
    useCryptoStore.getState().setInitialized(
      state.actorPtid ?? '',
      result.deviceId,
      result.fingerprint,
    );
    const bundle = await cryptoService.generateKeyBundle();
    await cryptoService.uploadKeyBundle(bundle);
    useCryptoStore.getState().setBackupResult(result);
    log.info('crypto-runtime', 'recovery restored and fresh device enrolled', {
      revision: result.backup.revision,
      deviceId: result.deviceId,
      messageCount: result.messageCount,
    });
    return result;
  } finally {
    useCryptoStore.getState().setRestoreInProgress(false);
  }
}

// ---------------------------------------------------------------------------
// Session establishment (multi-device aware)
// ---------------------------------------------------------------------------

interface DirectSessionTarget {
  address: CryptoDeviceAddress;
  sessionId: string;
}

const sessionEstablishmentLocks = new Map<string, Promise<DirectSessionTarget[]>>();

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function getLocalCryptoAddress(): CryptoDeviceAddress | null {
  if (!state.actorPtid || !state.deviceId) return null;
  return { ptid: state.actorPtid, deviceId: state.deviceId };
}

function requireLocalCryptoAddress(): CryptoDeviceAddress {
  const address = getLocalCryptoAddress();
  if (!address) throw new Error('crypto runtime is not initialized');
  return address;
}

function sessionGenerationForBundle(bundle: {
  publishedAtUnixMs: number;
}): number {
  if (!Number.isSafeInteger(bundle.publishedAtUnixMs) || bundle.publishedAtUnixMs <= 0) {
    throw new Error('peer device bundle has no valid session generation');
  }
  return bundle.publishedAtUnixMs;
}

async function establishSessionTarget(
  conversationId: string,
  localAddress: CryptoDeviceAddress,
  bundle: Awaited<ReturnType<typeof cryptoService.fetchPeerBundles>>[number],
  peerHomeStationPeerId?: string,
): Promise<DirectSessionTarget> {
  const store = useCryptoStore.getState();
  const peerAddress = { ptid: bundle.ptid, deviceId: bundle.deviceId };
  const generation = sessionGenerationForBundle(bundle);
  const sessionId = buildSessionId(conversationId, localAddress, peerAddress, generation);

  try {
    const existing = await cryptoService.getSessionStatus(sessionId);
    if (existing.established && existing.version === 1) {
      store.setSessionSecurity(sessionId, {
        peerAddress,
        level: 'ready',
        version: existing.version,
      });
      return { address: peerAddress, sessionId };
    }
  } catch (error) {
    if (!(error instanceof CryptoServiceError) || error.code !== 'NOT_FOUND') {
      throw error;
    }
  }

  store.setSessionSecurity(sessionId, { peerAddress, level: 'establishing' });
  const initResult = await cryptoService.initSession({
    sessionId,
    conversationId,
    localAddress,
    peerAddress,
    peerBundle: bundle,
    sessionGeneration: generation,
  });
  const directInit = fromBinary(
    DirectSessionInitSchema,
    base64ToBytes(initResult.directSessionInit),
  );
  if (
    initResult.established
    || initResult.negotiatedVersion !== 1
    || Number(initResult.usedSignedPreKeyId) !== Number(bundle.signedPreKey.keyId)
    || directInit.sessionId !== sessionId
    || directInit.conversationId !== conversationId
    || directInit.sender?.ptid !== localAddress.ptid
    || directInit.sender.deviceId !== localAddress.deviceId
    || directInit.recipient?.ptid !== peerAddress.ptid
    || directInit.recipient.deviceId !== peerAddress.deviceId
    || directInit.sessionGeneration !== BigInt(generation)
  ) {
    throw new Error(`crypto session initialization returned inconsistent evidence for ${sessionId}`);
  }

  await imServiceV1.dkx.send(
    peerAddress.ptid,
    peerAddress.deviceId,
    sessionId,
    DirectKeyExchangeKind.INITIAL_MESSAGE,
    toBinary(DirectSessionInitSchema, directInit),
    peerHomeStationPeerId,
  );
  await cryptoService.markSessionReady(sessionId);
  store.setSessionSecurity(sessionId, {
    peerAddress,
    level: 'ready',
    version: initResult.negotiatedVersion,
  });
  return { address: peerAddress, sessionId };
}

/**
 * Ensures complete direct-message fan-out: every active recipient device and
 * every other active sender device has a ready endpoint-pair session.
 */
export async function ensurePeerSessions(
  conversationId: string,
  peerPtid: string,
  peerHomeStationPeerId?: string,
): Promise<DirectSessionTarget[]> {
  const localAddress = requireLocalCryptoAddress();
  if (!useCryptoStore.getState().encryptionEnabled) {
    throw new Error('direct encryption is disabled');
  }
  const lockKey = `${conversationId}\u0000${peerPtid}`;
  const existingLock = sessionEstablishmentLocks.get(lockKey);
  if (existingLock) return existingLock;

  const work = (async () => {
    const [peerBundles, ownBundles] = await Promise.all([
      cryptoService.fetchPeerBundles(peerPtid),
      cryptoService.fetchPeerBundles(localAddress.ptid),
    ]);
    const bundles = [...peerBundles, ...ownBundles]
      .filter(bundle => (
        bundle.deviceId
        && !(bundle.ptid === localAddress.ptid && bundle.deviceId === localAddress.deviceId)
      ));
    const uniqueBundles = Array.from(
      new Map(bundles.map(bundle => [`${bundle.ptid}\u0000${bundle.deviceId}`, bundle])).values(),
    );
    if (peerBundles.length === 0 || uniqueBundles.length === 0) {
      throw new Error(`no active device bundles are available for ${peerPtid}`);
    }

    const targets: DirectSessionTarget[] = [];
    for (const bundle of uniqueBundles) {
      try {
        targets.push(await establishSessionTarget(
          conversationId,
          localAddress,
          bundle,
          bundle.ptid === peerPtid ? peerHomeStationPeerId : undefined,
        ));
      } catch (error) {
        const generation = sessionGenerationForBundle(bundle);
        const sessionId = buildSessionId(
          conversationId,
          localAddress,
          { ptid: bundle.ptid, deviceId: bundle.deviceId },
          generation,
        );
        useCryptoStore.getState().setSessionSecurity(sessionId, {
          peerAddress: { ptid: bundle.ptid, deviceId: bundle.deviceId },
          level: 'error',
        });
        throw error;
      }
    }
    updateConversationSecurityAggregate(conversationId);
    return targets;
  })();
  sessionEstablishmentLocks.set(lockKey, work);
  try {
    return await work;
  } finally {
    sessionEstablishmentLocks.delete(lockKey);
  }
}

export async function encryptDirectPayloads(
  conversationId: string,
  peerPtid: string,
  plaintext: Uint8Array,
  peerHomeStationPeerId?: string,
  command?: {
    commandId: string;
    contentType: number;
    replyToMessageId?: string;
    threadRootMessageId?: string;
  },
): Promise<DeviceEncryptedPayload[]> {
  const targets = await ensurePeerSessions(
    conversationId,
    peerPtid,
    peerHomeStationPeerId,
  );
  const plaintextBase64 = bytesToBase64(plaintext);
  const prepared = await cryptoService.encryptSessions({
    sessionIds: targets.map(target => target.sessionId),
    plaintext: plaintextBase64,
    commandId: command?.commandId ?? crypto.randomUUID(),
    contentType: command?.contentType ?? 1,
    replyToMessageId: command?.replyToMessageId,
    threadRootMessageId: command?.threadRootMessageId,
  });
  if (prepared.devicePayloads.length !== targets.length) {
    throw new Error('direct encryption did not return the complete device fan-out');
  }
  const targetBySession = new Map(targets.map(target => [target.sessionId, target]));
  const payloads: DeviceEncryptedPayload[] = [];
  for (const encrypted of prepared.devicePayloads) {
    const target = targetBySession.get(encrypted.sessionId);
    if (
      !target
      || encrypted.recipientPtid !== target.address.ptid
      || encrypted.recipientDeviceId !== target.address.deviceId
    ) {
      throw new Error('direct encryption returned an unexpected device target');
    }
    if (encrypted.version !== 1) {
      throw new Error(`unsupported direct encryption version for ${encrypted.sessionId}`);
    }
    const envelope = create(EncryptedMessageSchema, {
      ciphertext: base64ToBytes(encrypted.ciphertext),
      counter: encrypted.counter,
      ratchetPub: base64ToBytes(encrypted.ratchetPublicKey),
      prevCounter: encrypted.previousCounter,
      version: encrypted.version,
      nonce: base64ToBytes(encrypted.nonce),
    });
    payloads.push(create(DeviceEncryptedPayloadSchema, {
      recipientPtid: target.address.ptid,
      recipientDeviceId: target.address.deviceId,
      sessionId: encrypted.sessionId,
      encryptedEnvelope: toBinary(EncryptedMessageSchema, envelope),
    }));
  }
  return payloads;
}

/**
 * Accept an inbound session from a peer device.
 * Called by the envelope processor when a DKX INITIAL_MESSAGE arrives.
 */
export async function acceptInboundSession(
  init: DirectSessionInit,
  envelopeSender: CryptoDeviceAddress,
  envelopeRecipientDeviceId: string,
): Promise<boolean> {
  const localAddress = requireLocalCryptoAddress();
  if (
    !init.sender
    || !init.recipient
    || init.sender.ptid !== envelopeSender.ptid
    || init.sender.deviceId !== envelopeSender.deviceId
    || init.recipient.ptid !== localAddress.ptid
    || init.recipient.deviceId !== localAddress.deviceId
    || envelopeRecipientDeviceId !== localAddress.deviceId
    || !init.sessionId
    || !init.conversationId
    || init.protocolVersion !== 1
  ) {
    throw new Error('direct session init does not target the local crypto endpoint');
  }
  const peerAddress = {
    ptid: init.sender.ptid,
    deviceId: init.sender.deviceId,
  };
  const store = useCryptoStore.getState();
  store.setSessionSecurity(init.sessionId, { peerAddress, level: 'establishing' });

  try {
    const result = await cryptoService.acceptSession({
      sessionId: init.sessionId,
      conversationId: init.conversationId,
      localAddress,
      peerAddress,
      senderIdentityKey: bytesToBase64(init.senderIdentityKey),
      senderEphemeralKey: bytesToBase64(init.senderEphemeralKey),
      recipientSignedPreKeyId: init.recipientSignedPrekeyId,
      recipientOneTimePreKeyId: init.recipientOneTimePrekeyId,
      negotiatedVersion: init.protocolVersion,
      sessionGeneration: Number(init.sessionGeneration),
    });

    if (result.established) {
      store.setSessionSecurity(init.sessionId, {
        peerAddress,
        level: 'ready',
        version: result.negotiatedVersion,
      });
      log.info('crypto-runtime', 'inbound session accepted', {
        sessionId: init.sessionId,
        peerPtid: peerAddress.ptid,
        peerDeviceId: peerAddress.deviceId,
      });
      updateConversationSecurityAggregate(init.conversationId);
      return true;
    }

    store.setSessionSecurity(init.sessionId, { peerAddress, level: 'error' });
    return false;
  } catch (err) {
    log.error('crypto-runtime', 'acceptInboundSession failed', {
      sessionId: init.sessionId,
      err,
    });
    store.setSessionSecurity(init.sessionId, { peerAddress, level: 'error' });
    throw err;
  }
}

export async function decryptDirectPayload(
  payload: DeviceEncryptedPayload,
  senderAddress: CryptoDeviceAddress,
): Promise<Uint8Array> {
  const localAddress = requireLocalCryptoAddress();
  if (
    payload.recipientPtid !== localAddress.ptid
    || payload.recipientDeviceId !== localAddress.deviceId
    || !payload.sessionId
    || !senderAddress.ptid
    || !senderAddress.deviceId
  ) {
    throw new Error('direct ciphertext does not target the local crypto endpoint');
  }
  const envelope = fromBinary(EncryptedMessageSchema, payload.encryptedEnvelope);
  if (
    envelope.version !== 1
    || envelope.ratchetPub.byteLength !== 32
    || envelope.nonce.byteLength !== 12
  ) {
    throw new Error('direct ciphertext envelope is invalid');
  }
  const decrypted = await cryptoService.decrypt({
    sessionId: payload.sessionId,
    ciphertext: bytesToBase64(envelope.ciphertext),
    ratchetPublicKey: bytesToBase64(envelope.ratchetPub),
    counter: envelope.counter,
    previousCounter: envelope.prevCounter,
    nonce: bytesToBase64(envelope.nonce),
    version: envelope.version,
  });
  if (decrypted.version !== 1) throw new Error('direct decrypt returned an unsupported version');
  return base64ToBytes(decrypted.plaintext);
}

// ---------------------------------------------------------------------------
// Safety number detection
// ---------------------------------------------------------------------------

async function checkSafetyNumbers(): Promise<void> {
  if (!state.initialized) return;
  try {
    const sessions = await cryptoService.listSessions();
    for (const session of sessions) {
      if (!session.established) continue;
      const safety = await cryptoService.getSafetyNumber(session.sessionId);
      if (safety.changedSinceVerified) {
        useCryptoStore.getState().pushSafetyNumberAlert({
          sessionId: session.sessionId,
          peerAddress: session.peerAddress,
          displayFingerprint: safety.displayFingerprint,
          detectedAtMs: Date.now(),
        });
        useCryptoStore.getState().setSessionSecurity(session.sessionId, {
          level: 'safety-number-changed',
        });
        log.warn('crypto-runtime', 'safety number changed', {
          sessionId: session.sessionId,
          peerPtid: session.peerAddress.ptid,
        });
      }
    }
  } catch (err) {
    log.warn('crypto-runtime', 'safety number check failed', { err });
  }
}

// ---------------------------------------------------------------------------
// Device list refresh
// ---------------------------------------------------------------------------

async function refreshDeviceList(): Promise<void> {
  if (!state.actorPtid) return;
  const store = useCryptoStore.getState();
  store.setDevicesLoading(true);
  try {
    const devices = await cryptoService.listDevices(state.actorPtid);
    store.setDevices(devices);
  } catch (err) {
    log.warn('crypto-runtime', 'device list refresh failed', { err });
    store.setDevicesLoading(false);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSessionId(
  conversationId: string,
  localAddress: CryptoDeviceAddress,
  peerAddress: CryptoDeviceAddress,
  generation: number,
): string {
  return [
    conversationId,
    localAddress.ptid,
    localAddress.deviceId,
    peerAddress.ptid,
    peerAddress.deviceId,
    generation,
  ].join(':');
}

function updateConversationSecurityAggregate(conversationId: string): void {
  const store = useCryptoStore.getState();
  const allSessions = Object.values(store.sessionSecurity).filter(
    session => session.sessionId.startsWith(`${conversationId}:`),
  );
  store.updateConversationSecurity(conversationId, allSessions);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleIdentityChanged(): void {
  // On identity change (logout/switch), reset crypto state
  const store = useCryptoStore.getState();
  store.reset();
  state.initialized = false;
  state.actorPtid = null;
  state.deviceId = null;
}

function handleResync(): void {
  if (!state.initialized) return;
  // On reconnection, re-check key status and safety numbers
  void checkAndRotateKeys();
  void checkSafetyNumbers();
}

// ---------------------------------------------------------------------------
// Polling lifecycle
// ---------------------------------------------------------------------------

function startKeyRotationPolling(): void {
  if (state.keyRotationTimerId) return;
  state.keyRotationTimerId = setInterval(() => {
    void checkAndRotateKeys();
  }, KEY_ROTATION_CHECK_INTERVAL_MS);
}

function stopKeyRotationPolling(): void {
  if (state.keyRotationTimerId) {
    clearInterval(state.keyRotationTimerId);
    state.keyRotationTimerId = null;
  }
}

function startBackupPolling(): void {
  if (state.backupTimerId) return;
  state.backupTimerId = setInterval(() => {
    void checkAndScheduleBackup();
  }, BACKUP_CHECK_INTERVAL_MS);
}

function stopBackupPolling(): void {
  if (state.backupTimerId) {
    clearInterval(state.backupTimerId);
    state.backupTimerId = null;
  }
}

// ---------------------------------------------------------------------------
// Runtime descriptor
// ---------------------------------------------------------------------------

export const cryptoRuntime: RuntimeDescriptor = {
  id: 'crypto',
  scope: 'session',

  install(): void {
    eventUnsubscribers = [
      eventBus.subscribe(EVENT.AUTH_IDENTITY_CHANGED, handleIdentityChanged),
      eventBus.subscribe(EVENT.REALTIME_RESYNC, handleResync),
    ];
    startKeyRotationPolling();
    startBackupPolling();
  },

  teardown(): void {
    stopKeyRotationPolling();
    stopBackupPolling();
    for (const unsub of eventUnsubscribers) unsub();
    eventUnsubscribers = [];
    state.initialized = false;
    state.actorPtid = null;
    state.deviceId = null;
    useCryptoStore.getState().reset();
  },

  async bootstrap(actorId: string | null): Promise<void> {
    if (!actorId) return;
    if (state.initialized) return;

    try {
      // Initialize or load the crypto identity from the Rust backend
      const identity = await cryptoService.generateIdentity();

      state.actorPtid = identity.ptid;
      state.deviceId = identity.deviceId;
      state.initialized = true;

      const store = useCryptoStore.getState();
      store.setInitialized(identity.ptid, identity.deviceId, identity.fingerprint);
      store.setEncryptionEnabled(true);

      // Generate and upload initial key bundle
      const bundle = await cryptoService.generateKeyBundle();
      await cryptoService.uploadKeyBundle(bundle);

      // Initial checks
      await Promise.all([
        refreshDeviceList(),
        checkAndRotateKeys(),
        checkAndScheduleBackup(),
        checkSafetyNumbers(),
      ]);

      log.info('crypto-runtime', 'bootstrap complete', {
        ptid: identity.ptid,
        deviceId: identity.deviceId,
      });
    } catch (err) {
      log.error('crypto-runtime', 'bootstrap failed', { err });
      useCryptoStore.getState().setEncryptionEnabled(false);
      state.initialized = false;
    }
  },

  async reconcile(reason: string): Promise<void> {
    if (!state.initialized) return;
    log.info('crypto-runtime', 'reconcile triggered', { reason });
    await Promise.all([
      checkAndRotateKeys(),
      checkAndScheduleBackup(),
      refreshDeviceList(),
    ]);
  },
};
