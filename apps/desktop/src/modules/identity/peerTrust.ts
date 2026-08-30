// Local peer-trust ledger. Records the fingerprint a contact had
// at the moment the local user explicitly verified them (via the
// safety-number / QR flow on `ChatDetailPanel`). When the peer's
// next-fetched bundle returns a different fingerprint we surface a
// "fingerprint changed" warning and force the user to re-verify.
//
// Storage strategy: client storage domain `identity.trust` keyed by `socialChat:trust:<actor>`
// (actor === the local user's DID). The identity-pipeline clears
// every key under the `socialChat:` prefix on logout / actor switch
// (see services/identityHandlers.ts) so we automatically inherit the
// existing scoping rules without a custom hook.
//
// Wire format intentionally is a flat record (not a Map / Set) so
// JSON-serialization is trivial and the file stays human-readable
// during debugging.

import { log } from '../../utils/logger';
import {
  readDesktopDomainValueSync,
  writeDesktopDomainValueSync,
} from '../../storage/desktopClientStorage';

export type PeerTrustState = 'unverified' | 'verified' | 'changed';

/** One row in the per-user trust ledger. */
export interface PeerTrustRecord {
  /** Peer DID. */
  peerPtid: string;
  /** Fingerprint captured at the moment of explicit verification.
   *  Lower-case hex (matches `crypto::identity_fingerprint_hex`). */
  verifiedFingerprint: string;
  /** Wall-clock unix-ms of the verification gesture. Display-only. */
  verifiedAt: number;
}

/** In-memory snapshot. Persisted lazily on every mutation. */
type TrustLedger = Record<string, PeerTrustRecord>;

function storageKey(localActorPtid: string): string {
  // Empty actor → process-global slot used during signup / before
  // the local actor is known. Real verifications never land in this
  // slot because the UI gates the buttons on `currentUserPtid` being
  // non-empty. Keeping a default key around just prevents subtle
  // crashes during the bootstrap window.
  return `socialChat:trust:${localActorPtid || 'anon'}`;
}

function load(localActorPtid: string): TrustLedger {
  try {
    const parsed = readDesktopDomainValueSync<TrustLedger>('identity.trust', storageKey(localActorPtid));
    if (parsed && typeof parsed === 'object') return parsed as TrustLedger;
    return {};
  } catch (err) {
    log.warn('peerTrust', 'load failed', { actor: localActorPtid, error: String(err) });
    return {};
  }
}

function persist(localActorPtid: string, ledger: TrustLedger): void {
  try {
    writeDesktopDomainValueSync('identity.trust', storageKey(localActorPtid), ledger);
  } catch (err) {
    log.warn('peerTrust', 'persist failed', { actor: localActorPtid, error: String(err) });
  }
}

/** Look up the saved record for a peer, or null. */
export function getPeerTrust(localActorPtid: string, peerPtid: string): PeerTrustRecord | null {
  if (!peerPtid) return null;
  const ledger = load(localActorPtid);
  return ledger[peerPtid] ?? null;
}

/** Compare the current peer fingerprint against the saved record.
 *  Returns:
 *    - 'unverified' — no record stored
 *    - 'verified'   — record matches current fingerprint exactly
 *    - 'changed'    — record exists but fingerprint differs (TOFU breach!)
 */
export function evaluateTrust(
  localActorPtid: string,
  peerPtid: string,
  currentFingerprint: string,
): PeerTrustState {
  const rec = getPeerTrust(localActorPtid, peerPtid);
  if (!rec) return 'unverified';
  const a = (rec.verifiedFingerprint || '').toLowerCase();
  const b = (currentFingerprint || '').toLowerCase();
  if (a && b && a === b) return 'verified';
  return 'changed';
}

/** Record a verification gesture. Idempotent: re-marking an already
 *  verified peer with the same fingerprint just refreshes the
 *  timestamp so "Last verified at" stays meaningful. */
export function markVerified(
  localActorPtid: string,
  peerPtid: string,
  fingerprint: string,
): PeerTrustRecord {
  const ledger = load(localActorPtid);
  const rec: PeerTrustRecord = {
    peerPtid,
    verifiedFingerprint: fingerprint.toLowerCase(),
    verifiedAt: Date.now(),
  };
  ledger[peerPtid] = rec;
  persist(localActorPtid, ledger);
  return rec;
}

/** Wipe the saved record. Used by the "Reset verification" action
 *  when the user wants to acknowledge a fingerprint change without
 *  immediately re-verifying. */
export function clearTrust(localActorPtid: string, peerPtid: string): void {
  const ledger = load(localActorPtid);
  if (!(peerPtid in ledger)) return;
  delete ledger[peerPtid];
  persist(localActorPtid, ledger);
}
