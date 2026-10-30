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

  const query = useMemo<ResolvedQuery>(() => {
    const localPath = input.localPath?.trim() || null;
    const isSessionActor = Boolean(
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
        actorPtid: input.actorPtid ?? null,
        profileRevision: input.profileRevision ?? null,
        localPath,
      };
    return { ...base, key: avatarAssetKey(base) };
  }, [identity, input.actorPtid, input.profileRevision, input.localPath, sessionEpoch, sessionUser]);

  const snapshot = useSyncExternalStore(
    avatarAssets.subscribe,
    () => avatarAssets.getSnapshot(query.key),
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, identity]);

  if (!identity) {
    return {
      snapshot: { phase: 'absent', src: null, degraded: false, identity: '' },
      refresh,
    };
  }
  return { snapshot, refresh };
}
