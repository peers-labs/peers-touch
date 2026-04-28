// Local peer-trust ledger. Records the fingerprint a contact had
// at the moment the local user explicitly verified them (via the
// safety-number / QR flow on `ChatDetailPanel`). When the peer's
// next-fetched bundle returns a different fingerprint we surface a
// "fingerprint changed" warning and force the user to re-verify.
//
// Storage strategy: localStorage keyed by `socialChat:trust:<actor>`
// (actor === the local user's DID). The identity-pipeline clears
// every key under the `socialChat:` prefix on logout / actor switch
// (see services/identityHandlers.ts) so we automatically inherit the
// existing scoping rules without a custom hook.
//
// Wire format intentionally is a flat record (not a Map / Set) so
// JSON-serialization is trivial and the file stays human-readable
// during debugging.

import { log } from '../../utils/logger';

export type PeerTrustState = 'unverified' | 'verified' | 'changed';

/** One row in the per-user trust ledger. */
export interface PeerTrustRecord {
  /** Peer DID. */
  peerDid: string;
  /** Fingerprint captured at the moment of explicit verification.
   *  Lower-case hex (matches `crypto::identity_fingerprint_hex`). */
  verifiedFingerprint: string;
  /** Wall-clock unix-ms of the verification gesture. Display-only. */
  verifiedAt: number;
}

/** In-memory snapshot. Persisted lazily on every mutation. */
type TrustLedger = Record<string, PeerTrustRecord>;

function storageKey(localActorDid: string): string {
  // Empty actor → process-global slot used during signup / before
  // the local actor is known. Real verifications never land in this
  // slot because the UI gates the buttons on `currentUserDid` being
  // non-empty. Keeping a default key around just prevents subtle
  // crashes during the bootstrap window.
  return `socialChat:trust:${localActorDid || 'anon'}`;
}

function load(localActorDid: string): TrustLedger {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(localActorDid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as TrustLedger;
    return {};
  } catch (err) {
    log.warn('peerTrust', 'load failed', { actor: localActorDid, error: String(err) });
    return {};
  }
}

function persist(localActorDid: string, ledger: TrustLedger): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(localActorDid), JSON.stringify(ledger));
  } catch (err) {
    log.warn('peerTrust', 'persist failed', { actor: localActorDid, error: String(err) });
  }
}

/** Look up the saved record for a peer, or null. */
export function getPeerTrust(localActorDid: string, peerDid: string): PeerTrustRecord | null {
  if (!peerDid) return null;
  const ledger = load(localActorDid);
  return ledger[peerDid] ?? null;
}

/** Compare the current peer fingerprint against the saved record.
 *  Returns:
 *    - 'unverified' — no record stored
 *    - 'verified'   — record matches current fingerprint exactly
 *    - 'changed'    — record exists but fingerprint differs (TOFU breach!)
 */
export function evaluateTrust(
  localActorDid: string,
  peerDid: string,
  currentFingerprint: string,
): PeerTrustState {
  const rec = getPeerTrust(localActorDid, peerDid);
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
  localActorDid: string,
  peerDid: string,
  fingerprint: string,
): PeerTrustRecord {
  const ledger = load(localActorDid);
  const rec: PeerTrustRecord = {
    peerDid,
    verifiedFingerprint: fingerprint.toLowerCase(),
    verifiedAt: Date.now(),
  };
  ledger[peerDid] = rec;
  persist(localActorDid, ledger);
  return rec;
}

/** Wipe the saved record. Used by the "Reset verification" action
 *  when the user wants to acknowledge a fingerprint change without
 *  immediately re-verifying. */
export function clearTrust(localActorDid: string, peerDid: string): void {
  const ledger = load(localActorDid);
  if (!(peerDid in ledger)) return;
  delete ledger[peerDid];
  persist(localActorDid, ledger);
}
