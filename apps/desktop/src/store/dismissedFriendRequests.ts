// Dismissed friend-request history store — local-only archive dismissal.
//
// Settled friend-request rows (accepted/rejected) are Station projections of
// signed federation commands and must never be rewritten server-side. Deleting
// a history row therefore means hiding the counterparty locally, scoped to the
// authenticated actor, and persisting that choice in localStorage. Re-login or
// a new request from the same peer re-surfaces the row.

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

const STORAGE_KEY_PREFIX = 'peers-dismissed-friend-requests';

interface DismissedFriendRequestsState {
  /** Actor whose dismissal set is currently hydrated. */
  activeActorPtid: string;
  /** Counterparty PTIDs hidden from the History section for `activeActorPtid`. */
  dismissedPeers: string[];
}

interface DismissedFriendRequestsActions {
  /** Hydrate the dismissal set owned by `actorPtid` from localStorage. */
  loadForActor: (actorPtid: string) => void;
  /** Hide one counterparty history row and persist the choice. */
  dismissPeer: (peerPtid: string) => void;
  isDismissed: (peerPtid: string) => boolean;
}

type DismissedFriendRequestsStore =
  DismissedFriendRequestsState & DismissedFriendRequestsActions;

function storageKey(actorPtid: string): string {
  return `${STORAGE_KEY_PREFIX}:${actorPtid}`;
}

function persist(actorPtid: string, dismissedPeers: readonly string[]): void {
  try {
    localStorage.setItem(storageKey(actorPtid), JSON.stringify(dismissedPeers));
  } catch (error) {
    log.error(
      'dismissedFriendRequests',
      'Failed to persist dismissed friend requests to localStorage',
      { error },
    );
  }
}

function loadFromStorage(actorPtid: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(actorPtid));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch (error) {
    log.error(
      'dismissedFriendRequests',
      'Failed to load dismissed friend requests from localStorage',
      { error },
    );
    return [];
  }
}

export const useDismissedFriendRequestsStore =
  createDesktopStore<DismissedFriendRequestsStore>(
    'dismissedFriendRequests',
    (set, get) => ({
      activeActorPtid: '',
      dismissedPeers: [],

      loadForActor: (actorPtid) => {
        const normalized = actorPtid.trim();
        if (!normalized || get().activeActorPtid === normalized) return;
        set({
          activeActorPtid: normalized,
          dismissedPeers: loadFromStorage(normalized),
        });
      },

      dismissPeer: (peerPtid) => {
        const normalized = peerPtid.trim();
        const actorPtid = get().activeActorPtid;
        if (!normalized || !actorPtid || get().dismissedPeers.includes(normalized)) {
          return;
        }
        const next = [...get().dismissedPeers, normalized];
        set({ dismissedPeers: next });
        persist(actorPtid, next);
        log.info('dismissedFriendRequests', 'Friend request history dismissed', {
          actorPtid,
          peerPtid: normalized,
        });
      },

      isDismissed: (peerPtid) => get().dismissedPeers.includes(peerPtid),
    }),
  );
