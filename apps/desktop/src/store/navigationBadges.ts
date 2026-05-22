import { create } from 'zustand';
import { useSocialChatStore } from './socialChat';
import type { FriendChatSession } from '../gen/proto/domain/chat/friend_chat_pb';
import { log } from '../utils/logger';

// ── Types ──

interface NavigationBadgeState {
  /** Whether the chat page/surface is currently visible to the user. */
  chatSurfaceVisible: boolean;

  /** Per-session incremental unread bump counter (session ULID → count). */
  chatUnreadBySessions: Record<string, number>;

  /** Aggregated total chat unread count (derived on reconcile). */
  chatUnreadTotal: number;

  // ── Actions ──

  /** Mark chat surface as visible or hidden. Used by ReadyView to track page. */
  setChatSurfaceVisible: (visible: boolean) => void;

  /**
   * Bump unread count for a specific session. Called by socialRealtime
   * when a message arrives for a session that is NOT the active visible one.
   */
  bumpChatUnread: (sessionUlid: string) => void;

  /**
   * Clear unread count for a specific session. Called when the user
   * views or acknowledges messages in that session.
   */
  clearChatUnread: (sessionUlid: string) => void;

  /**
   * Reconcile badge total from the socialChat store's authoritative data.
   * Called after cold sync, periodic refresh, or bootstrap completion.
   */
  reconcileChatBadge: () => void;

  /** Reset all badge state. Used on teardown or identity switch. */
  reset: () => void;
}

// ── Initial state factory ──

function initialState(): Pick<
  NavigationBadgeState,
  'chatSurfaceVisible' | 'chatUnreadBySessions' | 'chatUnreadTotal'
> {
  return {
    chatSurfaceVisible: false,
    chatUnreadBySessions: {},
    chatUnreadTotal: 0,
  };
}

// ── Store ──

function friendUnreadForViewer(session: FriendChatSession, viewerDid: string | null): number {
  if (!viewerDid) {
    return Math.max(session.unreadCountA ?? 0, session.unreadCountB ?? 0);
  }
  if (session.participantADid === viewerDid) return session.unreadCountA ?? 0;
  if (session.participantBDid === viewerDid) return session.unreadCountB ?? 0;
  return Math.max(session.unreadCountA ?? 0, session.unreadCountB ?? 0);
}

export const useNavigationBadgeStore = create<NavigationBadgeState>((set) => ({
  ...initialState(),

  setChatSurfaceVisible: (visible) => {
    set({ chatSurfaceVisible: visible });
  },

  bumpChatUnread: (sessionUlid) => {
    set((state) => {
      const prev = state.chatUnreadBySessions[sessionUlid] ?? 0;
      const chatUnreadBySessions = {
        ...state.chatUnreadBySessions,
        [sessionUlid]: prev + 1,
      };
      const chatUnreadTotal = Object.values(chatUnreadBySessions).reduce(
        (sum, count) => sum + count,
        0,
      );
      return { chatUnreadBySessions, chatUnreadTotal };
    });
  },

  clearChatUnread: (sessionUlid) => {
    set((state) => {
      if (!state.chatUnreadBySessions[sessionUlid]) return state;

      const { [sessionUlid]: _, ...rest } = state.chatUnreadBySessions;
      const chatUnreadTotal = Object.values(rest).reduce(
        (sum, count) => sum + count,
        0,
      );
      return { chatUnreadBySessions: rest, chatUnreadTotal };
    });
  },

  reconcileChatBadge: () => {
    const socialState = useSocialChatStore.getState();
    const viewerDid = socialState.currentUserDid;

    // Sum friend session unread counts
    let friendTotal = 0;
    for (const session of socialState.sessions) {
      friendTotal += friendUnreadForViewer(session, viewerDid);
    }

    // Sum group unread counts
    const groupTotal = Object.values(socialState.groupUnreadCounts).reduce(
      (sum, count) => sum + count,
      0,
    );

    const reconciled = friendTotal + groupTotal;

    // Rebuild per-session map from authoritative data
    const chatUnreadBySessions: Record<string, number> = {};
    for (const session of socialState.sessions) {
      const count = friendUnreadForViewer(session, viewerDid);
      if (count > 0) {
        chatUnreadBySessions[session.ulid] = count;
      }
    }
    for (const [ulid, count] of Object.entries(socialState.groupUnreadCounts)) {
      if (count > 0) {
        chatUnreadBySessions[ulid] = count;
      }
    }

    set({ chatUnreadTotal: reconciled, chatUnreadBySessions });

    log.info('navigationBadges', 'reconciled chat badge', {
      friendTotal,
      groupTotal,
      total: reconciled,
    });
  },

  reset: () => {
    set(initialState());
  },
}));

// ── Lifecycle hooks (legacy bridge pattern, see runtime-projections.md §2) ──

let reconcileTimer: ReturnType<typeof setInterval> | null = null;
const RECONCILE_INTERVAL_MS = 30_000;

/**
 * Install the navigation badge projection. Sets up periodic reconciliation.
 * Called by `appRuntime.ts` during app bootstrap.
 */
export function installNavigationBadgeProjection(): void {
  if (reconcileTimer) return;

  // Initial reconciliation
  useNavigationBadgeStore.getState().reconcileChatBadge();

  // Periodic reconciliation to catch missed events
  reconcileTimer = setInterval(() => {
    useNavigationBadgeStore.getState().reconcileChatBadge();
  }, RECONCILE_INTERVAL_MS);

  log.info('navigationBadges', 'projection installed');
}

/**
 * Teardown the navigation badge projection. Clears timers and resets state.
 * Called by `appRuntime.ts` during app teardown.
 */
export function teardownNavigationBadgeProjection(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
  }
  useNavigationBadgeStore.getState().reset();
  log.info('navigationBadges', 'projection torn down');
}
