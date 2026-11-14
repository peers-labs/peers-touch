/**
 * Persistent, cross-process last-good for decoded avatar pixels.
 *
 * The in-memory AvatarAssets owner loses every decoded image on restart, so
 * the first frame after launch paints neutral placeholders while each avatar
 * re-resolves and re-decodes. This module keeps the last paint-ready src per
 * actor (a materialized asset-protocol file URL from the native avatar cache,
 * or an inline data URI) in the actor-scoped `asset.avatar` domain. The owner
 * primes its last-good index from here during hydrate/restore, so avatars for
 * known actors paint on the first frame; the live resolution replaces the
 * image atomically when a newer identity is ready.
 *
 * Last-good only: it never authorizes identity truth. A missing native file
 * simply fails decode and falls back to neutral until the live flight lands.
 */
import {
  readAllActorDomainValuesSync,
  writeActorDomainValueSync,
} from '../storage/desktopClientStorage';

const DOMAIN = 'asset.avatar';

export interface PersistedAvatarLastGood {
  actorPtid: string;
  identity: string;
  /** Paint-ready src: asset:// file URL from native cache, or data: URI. */
  src: string;
  localPath: string | null;
  revision: number | string | null;
}

/**
 * Persist a freshly decoded avatar for cross-restart first-frame paint.
 * `ownerActorPtid` is the authenticated local actor (storage scope); the
 * entry key is the avatar OWNER ptid (self or peer), so every known actor has
 * its own last-good within the local actor's cache.
 */
export function persistAvatarLastGood(ownerActorPtid: string, entry: PersistedAvatarLastGood): void {
  const owner = ownerActorPtid.trim();
  const avatarOwner = entry.actorPtid.trim();
  const src = entry.src?.trim();
  if (!owner || !avatarOwner || !src) return;
  writeActorDomainValueSync<PersistedAvatarLastGood>(owner, DOMAIN, avatarOwner, entry);
}

/**
 * Read every persisted avatar last-good for the authenticated actor. Peer
 * entries are stored keyed by their owner PTID (see persistPeerAvatarLastGood).
 */
export function readPersistedAvatarLastGood(actorPtid: string): PersistedAvatarLastGood[] {
  const actor = actorPtid.trim();
  if (!actor) return [];
  return [...readAllActorDomainValuesSync<PersistedAvatarLastGood>(actor, DOMAIN).values()]
    .filter((entry) => entry && entry.actorPtid && entry.src);
}
