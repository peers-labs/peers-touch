// Desktop Rust crypto service.
//
// TypeScript wrapper over the Rust Tauri crypto backend.
// Addresses the (PTID, device_id) identity tuple requirement for multi-device
// encryption.

import { invoke } from '@tauri-apps/api/core';
import { log } from '../utils/logger';
import { api, type KeyExchangeWireBundle } from './desktop_api';

// ---------------------------------------------------------------------------
// Types — Tauri command interface contract (Rust side implements these)
// ---------------------------------------------------------------------------

/** Canonical device addressing tuple used for all crypto operations. */
export interface CryptoDeviceAddress {
  ptid: string;
  deviceId: string;
}

/** Local identity keypair generated/stored by the Rust backend. */
export interface CryptoIdentity {
  ptid: string;
  deviceId: string;
  identityPublicKey: string;
  fingerprint: string;
  createdAtUnixMs: number;
}

/** Signed pre-key for X3DH protocol. */
export interface SignedPreKey {
  keyId: string;
  publicKey: string;
  signature: string;
  createdAtUnixMs: number;
}

/** One-time pre-key for X3DH protocol. */
export interface OneTimePreKey {
  keyId: string;
  publicKey: string;
}

/** Key bundle published to Station for X3DH session initiation. */
export interface CryptoKeyBundle {
  identityPublicKey: string;
  signedPreKey: SignedPreKey;
  oneTimePreKeys: OneTimePreKey[];
  supportedVersions: number[];
}

/** Peer device key bundle fetched from Station. */
export interface PeerDeviceBundle {
  ptid: string;
  deviceId: string;
  identityPublicKey: string;
  signedPreKey: SignedPreKey;
  oneTimePreKey?: OneTimePreKey;
  supportedVersions: number[];
  publishedAtUnixMs: number;
}

/** Result of X3DH session initiation (sender side). */
export interface SessionInitResult {
  sessionId: string;
  ephemeralPublicKey: string;
  usedSignedPreKeyId: string;
  usedOneTimePreKeyId?: string;
  negotiatedVersion: number;
  established: boolean;
  directSessionInit: string;
}

/** Result of X3DH session acceptance (receiver side). */
export interface SessionAcceptResult {
  sessionId: string;
  established: boolean;
  negotiatedVersion: number;
}

/** Double Ratchet encrypt output. */
export interface RatchetEncryptResult {
  recipientPtid: string;
  recipientDeviceId: string;
  sessionId: string;
  version: number;
  ciphertext: string;
  ratchetPublicKey: string;
  counter: number;
  previousCounter: number;
  nonce: string;
}

export interface PreparedDirectCommand {
  commandId: string;
  commandBytes: string;
  devicePayloads: RatchetEncryptResult[];
}

/** Double Ratchet decrypt output. */
export interface RatchetDecryptResult {
  plaintext: string;
  version: number;
}

/** Session status for a given (PTID, device_id) peer. */
export interface CryptoSessionStatus {
  sessionId: string;
  peerAddress: CryptoDeviceAddress;
  established: boolean;
  version: number;
  ratchetCounter: number;
  lastActivityUnixMs: number;
}

/** Device enrollment record. */
export interface DeviceEnrollment {
  deviceId: string;
  deviceLabel: string;
  enrolledAtUnixMs: number;
  lastSeenUnixMs: number;
  isCurrentDevice: boolean;
}

/** Safety number (fingerprint) for a session. */
export interface SafetyNumber {
  sessionId: string;
  peerAddress: CryptoDeviceAddress;
  displayFingerprint: string;
  numericFingerprint: string;
  changedSinceVerified: boolean;
}

/** Key rotation status. */
export interface KeyRotationStatus {
  signedPreKeyAgeMs: number;
  oneTimePreKeysRemaining: number;
  rotationNeeded: boolean;
  lastRotationUnixMs: number;
}

// ---------------------------------------------------------------------------
// Rust command result contract
// ---------------------------------------------------------------------------

interface RustAppResult<_T = unknown> {
  ok: boolean;
  data?: { status: string };
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Invocation helpers
// ---------------------------------------------------------------------------

async function invokeCryptoCommand<TOut>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<TOut> {
  const start = Date.now();
  log.info('crypto-service', `-> ${command}`);
  try {
    const result = payload === undefined
      ? await invoke<RustAppResult<unknown>>(command)
      : await invoke<RustAppResult<unknown>>(command, payload);
    const elapsed = Date.now() - start;
    if (!result.ok || !result.data) {
      const errorMsg = result.error?.message || `${command} failed`;
      log.warn('crypto-service', `<- ${command} FAIL (${elapsed}ms)`, {
        code: result.error?.code,
        error: errorMsg,
      });
      throw new CryptoServiceError(command, result.error?.code || 'INTERNAL_ERROR', errorMsg);
    }
    log.info('crypto-service', `<- ${command} OK (${elapsed}ms)`);
    return JSON.parse(result.data.status) as TOut;
  } catch (error) {
    if (error instanceof CryptoServiceError) throw error;
    const elapsed = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    log.error('crypto-service', `<- ${command} ERROR (${elapsed}ms)`, { error: msg });
    throw new CryptoServiceError(command, 'INTERNAL_ERROR', msg);
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class CryptoServiceError extends Error {
  readonly command: string;
  readonly code: string;

  constructor(command: string, code: string, message: string) {
    super(`[${command}] ${message}`);
    this.name = 'CryptoServiceError';
    this.command = command;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Service API
// ---------------------------------------------------------------------------

/** Desktop crypto service. All session addressing uses `(PTID, device_id)`. */
export const cryptoService = {
  // ── Identity ──────────────────────────────────────────────────────────────

  /** Generate or load the local device crypto identity. */
  generateIdentity(ptid: string): Promise<CryptoIdentity> {
    return invokeCryptoCommand<CryptoIdentity>('crypto_generate_identity', { ptid });
  },

  /** Get current device identity without regeneration. */
  getIdentity(ptid: string): Promise<CryptoIdentity> {
    return invokeCryptoCommand<CryptoIdentity>('crypto_get_identity', { ptid });
  },

  // ── Device enrollment ─────────────────────────────────────────────────────

  /** Enroll this device with the Station (publishes key bundle). */
  enrollDevice(input: {
    ptid: string;
    deviceId: string;
    deviceLabel: string;
    keyBundle: CryptoKeyBundle;
  }): Promise<DeviceEnrollment> {
    return invokeCryptoCommand<DeviceEnrollment>('crypto_enroll_device', {
      ptid: input.ptid,
      device_id: input.deviceId,
      device_label: input.deviceLabel,
      key_bundle: {
        identity_public_key: input.keyBundle.identityPublicKey,
        signed_pre_key: {
          key_id: input.keyBundle.signedPreKey.keyId,
          public_key: input.keyBundle.signedPreKey.publicKey,
          signature: input.keyBundle.signedPreKey.signature,
        },
        one_time_pre_keys: input.keyBundle.oneTimePreKeys.map((k) => ({
          key_id: k.keyId,
          public_key: k.publicKey,
        })),
        supported_versions: input.keyBundle.supportedVersions,
      },
    });
  },

  /** List all enrolled devices for a PTID. */
  listDevices(ptid: string): Promise<DeviceEnrollment[]> {
    return invokeCryptoCommand<DeviceEnrollment[]>('crypto_list_devices', { ptid });
  },

  /** Remove a device enrollment (revokes its keys). */
  removeDevice(ptid: string, deviceId: string): Promise<void> {
    return invokeCryptoCommand<void>('crypto_remove_device', {
      ptid,
      device_id: deviceId,
    });
  },

  // ── Key bundle management ─────────────────────────────────────────────────

  /** Generate a fresh key bundle for upload. */
  generateKeyBundle(): Promise<CryptoKeyBundle> {
    return invokeCryptoCommand<CryptoKeyBundle>('crypto_generate_key_bundle');
  },

  /** Upload key bundle to Station. */
  async uploadKeyBundle(bundle: CryptoKeyBundle, deviceId: string): Promise<void> {
    await api.keyExchangeUploadBundle({
      ik_pub: bundle.identityPublicKey,
      spk_id: Number(bundle.signedPreKey.keyId),
      spk_pub: bundle.signedPreKey.publicKey,
      spk_sig: bundle.signedPreKey.signature,
      opk_ids: bundle.oneTimePreKeys.map(key => Number(key.keyId)),
      opk_pubs: bundle.oneTimePreKeys.map(key => key.publicKey),
      supported_versions: bundle.supportedVersions,
      device_id: deviceId,
    });
  },

  /** Fetch peer device bundles from Station (all active devices). */
  async fetchPeerBundles(peerPtid: string): Promise<PeerDeviceBundle[]> {
    const response = await api.keyExchangeFetchBundle(peerPtid);
    return response.bundles.map((wire) => {
      const bundle = wire as KeyExchangeWireBundle & {
        spk_id?: number;
        opk_ids?: number[];
      };
      if (!bundle.device_id || bundle.spk_id == null) {
        throw new CryptoServiceError(
          'key_exchange_fetch_bundle',
          'INCOMPLETE_BUNDLE',
          `device bundle is missing key IDs for ${peerPtid}`,
        );
      }
      return {
        ptid: bundle.did,
        deviceId: bundle.device_id,
        identityPublicKey: bundle.ik_pub,
        signedPreKey: {
          keyId: String(bundle.spk_id),
          publicKey: bundle.spk_pub,
          signature: bundle.spk_sig,
          createdAtUnixMs: bundle.published_at_unix_ms,
        },
        oneTimePreKey: bundle.opks[0] && bundle.opk_ids?.[0] != null
          ? { keyId: String(bundle.opk_ids[0]), publicKey: bundle.opks[0] }
          : undefined,
        supportedVersions: bundle.supported_versions,
        publishedAtUnixMs: bundle.published_at_unix_ms,
      };
    });
  },

  /** Check key rotation status and replenish one-time pre-keys if needed. */
  getKeyRotationStatus(): Promise<KeyRotationStatus> {
    return invokeCryptoCommand<KeyRotationStatus>('crypto_key_rotation_status');
  },

  /** Rotate signed pre-key and replenish one-time pre-keys. */
  rotateKeys(): Promise<CryptoKeyBundle> {
    return invokeCryptoCommand<CryptoKeyBundle>('crypto_rotate_keys');
  },

  // ── Session establishment (X3DH) ─────────────────────────────────────────

  /**
   * Initiate a session with a specific peer device (sender side X3DH).
   * Produces the initial message payload for DKX delivery.
   */
  initSession(input: {
    sessionId: string;
    conversationId: string;
    localAddress: CryptoDeviceAddress;
    peerAddress: CryptoDeviceAddress;
    peerBundle: PeerDeviceBundle;
    sessionGeneration: number;
  }): Promise<SessionInitResult> {
    return invokeCryptoCommand<SessionInitResult>('crypto_init_session', {
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      sessionGeneration: input.sessionGeneration,
      peerPtid: input.peerAddress.ptid,
      peerDeviceId: input.peerAddress.deviceId,
      peerIdentityPublicKey: input.peerBundle.identityPublicKey,
      peerSignedPreKeyId: input.peerBundle.signedPreKey.keyId,
      peerSignedPreKey: input.peerBundle.signedPreKey.publicKey,
      peerSignedPreKeySig: input.peerBundle.signedPreKey.signature,
      peerOneTimePreKeyId: input.peerBundle.oneTimePreKey?.keyId,
      peerOneTimePreKey: input.peerBundle.oneTimePreKey?.publicKey,
      supportedVersions: input.peerBundle.supportedVersions,
    });
  },

  /**
   * Accept an inbound session (receiver side X3DH).
   * Called when a DKX INITIAL_MESSAGE envelope arrives.
   */
  acceptSession(input: {
    sessionId: string;
    conversationId: string;
    localAddress: CryptoDeviceAddress;
    peerAddress: CryptoDeviceAddress;
    senderIdentityKey: string;
    senderEphemeralKey: string;
    recipientSignedPreKeyId: number;
    recipientOneTimePreKeyId?: number;
    negotiatedVersion: number;
    sessionGeneration: number;
  }): Promise<SessionAcceptResult> {
    return invokeCryptoCommand<SessionAcceptResult>('crypto_accept_session', {
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      sessionGeneration: input.sessionGeneration,
      peerPtid: input.peerAddress.ptid,
      peerDeviceId: input.peerAddress.deviceId,
      senderIdentityKey: input.senderIdentityKey,
      senderEphemeralKey: input.senderEphemeralKey,
      recipientSignedPreKeyId: String(input.recipientSignedPreKeyId),
      recipientOneTimePreKeyId: input.recipientOneTimePreKeyId == null
        ? undefined
        : String(input.recipientOneTimePreKeyId),
      negotiatedVersion: input.negotiatedVersion,
    });
  },

  markSessionReady(sessionId: string): Promise<void> {
    return invokeCryptoCommand<void>('crypto_mark_session_ready', {
      sessionId,
    });
  },

  /** Get session status for a specific peer device. */
  getSessionStatus(sessionId: string): Promise<CryptoSessionStatus> {
    return invokeCryptoCommand<CryptoSessionStatus>('crypto_session_status', {
      sessionId,
    });
  },

  /** List all active sessions for the current identity. */
  listSessions(): Promise<CryptoSessionStatus[]> {
    return invokeCryptoCommand<CryptoSessionStatus[]>('crypto_list_sessions');
  },

  // ── Encrypt / Decrypt (Double Ratchet) ────────────────────────────────────

  encryptSessions(input: {
    sessionIds: string[];
    plaintext: string;
    commandId: string;
    contentType: number;
    replyToMessageId?: string;
    threadRootMessageId?: string;
  }): Promise<PreparedDirectCommand> {
    return invokeCryptoCommand<PreparedDirectCommand>('crypto_encrypt', {
      sessionIds: input.sessionIds,
      plaintext: input.plaintext,
      commandId: input.commandId,
      contentType: input.contentType,
      replyToMessageId: input.replyToMessageId,
      threadRootMessageId: input.threadRootMessageId,
    });
  },

  /** Decrypt a ciphertext envelope from a peer device session. */
  decrypt(input: {
    sessionId: string;
    ciphertext: string;
    ratchetPublicKey: string;
    counter: number;
    previousCounter: number;
    nonce: string;
    version: number;
  }): Promise<RatchetDecryptResult> {
    return invokeCryptoCommand<RatchetDecryptResult>('crypto_decrypt', {
      sessionId: input.sessionId,
      ciphertext: input.ciphertext,
      ratchetPublicKey: input.ratchetPublicKey,
      counter: input.counter,
      previousCounter: input.previousCounter,
      nonce: input.nonce,
      version: input.version,
    });
  },

  // ── Safety numbers ────────────────────────────────────────────────────────

  /** Compute safety number for a session (for manual verification). */
  getSafetyNumber(sessionId: string): Promise<SafetyNumber> {
    return invokeCryptoCommand<SafetyNumber>('crypto_safety_number', {
      session_id: sessionId,
    });
  },

  /** Mark a safety number as verified by the user. */
  verifySafetyNumber(sessionId: string): Promise<void> {
    return invokeCryptoCommand<void>('crypto_verify_safety_number', {
      session_id: sessionId,
    });
  },

} as const;
