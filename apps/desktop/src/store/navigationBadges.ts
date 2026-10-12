import { createDesktopStore } from './createDesktopStore';
import {
  bumpChatUnreadCounter,
  chatUnreadForParticipant,
  clearChatUnreadCounter,
  sumChatUnreadCounters,
} from '@peers-touch/client-chat-core';

import { useSocialChatStore } from './socialChat';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import { conversationKey, visibleConversationUnread } from './socialProjection';

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

export const useNavigationBadgeStore = createDesktopStore<NavigationBadgeState>('navigationBadges', (set) => ({
  ...initialState(),

  setChatSurfaceVisible: (visible) => {
    set({ chatSurfaceVisible: visible });
  },

  bumpChatUnread: (sessionUlid) => {
    set((state) => {
      const chatUnreadBySessions = bumpChatUnreadCounter(state.chatUnreadBySessions, sessionUlid);
      if (!chatUnreadBySessions) return state;
      const chatUnreadTotal = sumChatUnreadCounters(chatUnreadBySessions);
      return { chatUnreadBySessions, chatUnreadTotal };
    });
  },

  clearChatUnread: (sessionUlid) => {
    set((state) => {
      const chatUnreadBySessions = clearChatUnreadCounter(state.chatUnreadBySessions, sessionUlid);
      if (!chatUnreadBySessions) return state;
      return {
        chatUnreadBySessions,
        chatUnreadTotal: sumChatUnreadCounters(chatUnreadBySessions),
      };
    });
  },

  reconcileChatBadge: () => {
    const socialState = useSocialChatStore.getState();
    const viewerDid = socialState.currentUserPtid;

    // Sum friend session unread counts
    let friendTotal = 0;
    for (const session of socialState.sessions) {
      friendTotal += visibleConversationUnread(
        chatUnreadForParticipant(session, viewerDid),
        socialState.conversationLocalState[conversationKey('friend', session.ulid)],
      );
    }

    // Sum group unread counts
    const groupTotal = Object.entries(socialState.groupUnreadCounts).reduce(
      (sum, [ulid, count]) => sum + visibleConversationUnread(
        count,
        socialState.conversationLocalState[conversationKey('group', ulid)],
      ),
      0,
    );

    const reconciled = friendTotal + groupTotal;

    // Rebuild per-session map from authoritative data
    const chatUnreadBySessions: Record<string, number> = {};
    for (const session of socialState.sessions) {
      const count = visibleConversationUnread(
        chatUnreadForParticipant(session, viewerDid),
        socialState.conversationLocalState[conversationKey('friend', session.ulid)],
      );
      if (count > 0) {
        chatUnreadBySessions[session.ulid] = count;
      }
    }
    for (const [ulid, count] of Object.entries(socialState.groupUnreadCounts)) {
      const visibleCount = visibleConversationUnread(
        count,
        socialState.conversationLocalState[conversationKey('group', ulid)],
      );
      if (visibleCount > 0) {
        chatUnreadBySessions[ulid] = visibleCount;
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
let unsubscribeStore: (() => void) | null = null;
const RECONCILE_INTERVAL_MS = 30_000;

/**
 * Unread *conversation* count for the native dock badge (BOT-D13). The
 * per-session map only retains conversations whose visible unread count is > 0.
 */
export function selectUnreadConversationCount(): number {
  return Object.keys(useNavigationBadgeStore.getState().chatUnreadBySessions).length;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function syncDockBadge(): void {
  if (!isTauriRuntime()) return;
  const count = selectUnreadConversationCount();
  void api.nativeDockSetBadge(count).catch((error) => {
    log.warn('navigationBadges', 'dock badge sync failed', error);
  });
}

/**
 * Install the navigation badge projection. Sets up periodic reconciliation.
 * Called by `appRuntime.ts` during app bootstrap.
 */
export function installNavigationBadgeProjection(): void {
  if (reconcileTimer) return;

  // Initial reconciliation
  useNavigationBadgeStore.getState().reconcileChatBadge();

  // Mirror the unread-conversation count to the native dock/taskbar badge.
  syncDockBadge();
  unsubscribeStore = useNavigationBadgeStore.subscribe(syncDockBadge);

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
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  if (isTauriRuntime()) {
    void api.nativeDockSetBadge(0).catch(() => {});
  }
  useNavigationBadgeStore.getState().reset();
  log.info('navigationBadges', 'projection torn down');
}
