import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import {
  avatarAssetKey,
  avatarAssets,
  inlineAvatarSource,
  type AvatarAssetQuery,
  type AvatarAssetSnapshot,
} from '../../services/avatarAssets';
import { useSessionStore } from '../../store/session';

export interface AvatarAssetInput {
  /** Canonical avatar identity (remote URL, Station path, data URI or empty). */
  identity?: string | null;
  /** Owner PTID for non-session actors (explicit peer avatars). */
  actorPtid?: string | null;
  /**
   * Stable non-actor owner of the pixels (e.g. `group-avatar:<conversationId>`).
   * Same role as actorPtid for local last-good: once an image has been
   * resolved it is repainted from cache across identity churn, transient
   * decode failures and restarts instead of falling back to a placeholder.
   * Such keys never match the session actor, so they stay peer-scoped.
   */
  assetOwnerKey?: string | null;
  profileRevision?: number | string | null;
  /** Native materialized path hint (login / account registry rows). */
  localPath?: string | null;
}

type ResolvedQuery = AvatarAssetQuery & { key: string };

function identityBelongsToSession(
  identity: string,
  localPath: string | null | undefined,
  sessionUser: { avatarUrl?: string; avatarLocalPath?: string },
): boolean {
  if (!identity) return false;
  if (identity === sessionUser.avatarUrl) return true;
  if (inlineAvatarSource(identity)
    && inlineAvatarSource(sessionUser.avatarUrl ?? '') === identity) {
    return true;
  }
  return Boolean(
    localPath && sessionUser.avatarLocalPath && localPath === sessionUser.avatarLocalPath,
  );
}

/**
 * React binding over the React-free AvatarAssets owner. Components never hold
 * resolve caches; they subscribe to the canonical entry for an identity.
 *
 * Self avatars are attributed to the current session (epoch-fenced) by
 * identity match, so shell/popover/login surfaces require no extra props.
 * Peer identities stay in the persistent scope only when their owner PTID is
 * supplied; an unattributed peer identity never inherits last-good.
 */
export function useAvatarAsset(input: AvatarAssetInput): {
  snapshot: AvatarAssetSnapshot | null;
  refresh: () => void;
} {
  const identity = (input.identity ?? '').trim();
  const sessionUser = useSessionStore((state) => state.currentUser);
  const sessionEpoch = useSessionStore((state) => state.sessionEpoch);
  // Non-actor stable owners (group conversations) share the local last-good
  // machinery but can never be attributed to the authenticated session.
  const ownerKey = input.assetOwnerKey?.trim() || null;

  const query = useMemo<ResolvedQuery>(() => {
    const localPath = input.localPath?.trim() || null;
    const isSessionActor = !ownerKey && Boolean(
      sessionUser?.actorPtid
      && (input.actorPtid === sessionUser.actorPtid
        || identityBelongsToSession(identity, localPath, sessionUser)),
    );
    const base: AvatarAssetQuery = isSessionActor
      ? {
        identity,
        actorPtid: sessionUser!.actorPtid,
        epoch: sessionEpoch,
        stationScope: null,
        profileRevision: input.profileRevision ?? sessionUser?.profileRevision ?? null,
        localPath: localPath ?? sessionUser?.avatarLocalPath ?? null,
      }
      : {
        identity,
        actorPtid: ownerKey ?? input.actorPtid ?? null,
        profileRevision: input.profileRevision ?? null,
        localPath,
      };
    return { ...base, key: avatarAssetKey(base) };
  }, [identity, ownerKey, input.actorPtid, input.profileRevision, input.localPath, sessionEpoch, sessionUser]);

  const snapshot = useSyncExternalStore(
    avatarAssets.subscribe,
    () => {
      const canonical = avatarAssets.getSnapshot(query.key);
      if (canonical) return canonical;
      // Identity momentarily unknown for an owned non-actor avatar (e.g. a
      // reconcile dropped the group avatar field): keep painting its local
      // last-good instead of falling back to a generated placeholder.
      if (!identity && ownerKey) {
        return avatarAssets.getOwnerLastGood(ownerKey);
      }
      return null;
    },
    () => null,
  );

  useEffect(() => {
    if (!identity) return;
    // Start/share the canonical flight. The store emits when the entry moves
    // resolving → decoding → ready/absent/failed; automatic retries honor the
    // bounded failure backoff inside the owner.
    avatarAssets.request(query);
    // The full query is captured intentionally; the memo recomputes on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const refresh = useCallback(() => {
    if (!identity) return;
    avatarAssets.request(query, { force: true });
  }, [query, identity]);

  if (!identity) {
    // Identity not known yet (profile still loading). This is NOT an
    // authoritative "actor has no avatar": painting initials here would
    // flash a letter whenever the profile identity arrives late. Surfaces
    // render the identity-neutral placeholder until a real identity
    // resolves ready/absent.
    return {
      snapshot: { phase: 'unresolved', src: null, degraded: false, identity: '' },
      refresh,
    };
  }
  return { snapshot, refresh };
}
