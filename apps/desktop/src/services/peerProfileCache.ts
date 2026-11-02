/**
 * Persistent last-good cache for peer actor profiles.
 *
 * The canonical profile truth is Station (`api.peerProfileGet` / federation
 * resolve); this cache never replaces it. It exists to give the conversation
 * list, group avatar tiles and profile cards a paint-ready identity
 * (display name + avatar URL) on the first frame after a cold start, before
 * the N per-member network reads land. The live projection reconciles and
 * overwrites every entry on each `loadSessions`.
 *
 * Storage is the actor-scoped `profile.peer` domain (last-good semantics;
 * TTL expiry is ignored for presentation hydration). Values are written
 * synchronously from store actions and read synchronously at hydrate time so
 * the first React frame already carries the cached identities.
 */
import type { AccountProfile } from './desktop_api';
import {
  readAllActorDomainValuesSync,
  writeActorDomainValueSync,
} from '../storage/desktopClientStorage';

const DOMAIN = 'profile.peer';

/** Persist the last successful authoritative profile for one peer actor. */
export function cachePeerProfileLastGood(actorPtid: string, peerPtid: string, profile: AccountProfile): void {
  const actor = actorPtid.trim();
  const peer = peerPtid.trim();
  if (!actor || !peer) return;
  writeActorDomainValueSync<AccountProfile>(actor, DOMAIN, peer, profile);
}

/**
 * Cold-start last-good identities for the authenticated actor. Empty when
 * storage is unavailable (SSR/test shells) or no cache exists.
 */
export function readCachedPeerProfiles(actorPtid: string): Record<string, AccountProfile> {
  const actor = actorPtid.trim();
  if (!actor) return {};
  const entries = readAllActorDomainValuesSync<AccountProfile>(actor, DOMAIN);
  if (entries.size === 0) return {};
  const out: Record<string, AccountProfile> = {};
  for (const [storageKey, profile] of entries) {
    // Storage keys pass through safeSegment normalization (':' -> '_'); the
    // canonical PTID lives in the profile body itself.
    const canonicalPtid = profile.peers_touch?.network_id?.trim() || storageKey;
    if (canonicalPtid) out[canonicalPtid] = profile;
  }
  return out;
}
