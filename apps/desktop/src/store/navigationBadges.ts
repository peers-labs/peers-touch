import { createDesktopStore } from './createDesktopStore';
import {
  bumpChatUnreadCounter,
  chatUnreadForParticipant,
  clearChatUnreadCounter,
  sumChatUnreadCounters,
} from '@peers-touch/client-chat-core';

import { useSocialChatStore } from './socialChat';
import { useSessionStore } from './session';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import { conversationKey, visibleConversationUnread } from './socialProjection';
import {
  readAllActorDomainValuesSync,
  writeActorDomainValueSync,
} from '../storage/desktopClientStorage';

// ── Types ──

interface NavigationBadgeState {
  /** Whether the chat page/surface is currently visible to the user. */
  chatSurfaceVisible: boolean;

  /** Per-session incremental unread bump counter (session ULID → count). */
  chatUnreadBySessions: Record<string, number>;

  /** Aggregated total chat unread count (derived on reconcile). */
  chatUnreadTotal: number;

  /**
   * Group conversations carrying an unread @mention, keyed by actor PTID.
   * Mention flags survive mute (a muted group still raises for @me) and
   * restart, and are consumed when the conversation is opened.
   */
  mentionFlagsByActor: Record<string, string[]>;

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

  /** Whether the conversation currently carries an unread @mention flag. */
  hasMention: (actorPtid: string, conversationUlid: string) => boolean;

  /** Raise the @mention flag for one group conversation. */
  markMention: (actorPtid: string, conversationUlid: string) => void;

  /** Consume the @mention flag for one group conversation. */
  clearMention: (actorPtid: string, conversationUlid: string) => void;

  /** Load persisted @mention flags for the actor after session restore. */
  hydrateMentionFlags: (actorPtid: string) => void;

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
  'chatSurfaceVisible' | 'chatUnreadBySessions' | 'chatUnreadTotal' | 'mentionFlagsByActor'
> {
  return {
    chatSurfaceVisible: false,
    chatUnreadBySessions: {},
    chatUnreadTotal: 0,
    mentionFlagsByActor: {},
  };
}

// ── Mention flag persistence ──

const MENTION_FLAG_DOMAIN = 'chat.message-flag';
const MENTION_FLAG_KEY = 'mention-unread';

function persistMentionFlags(actorPtid: string, conversationUlids: string[]): void {
  const actor = actorPtid.trim();
  if (!actor) return;
  writeActorDomainValueSync<string[]>(
    actor,
    MENTION_FLAG_DOMAIN,
    MENTION_FLAG_KEY,
    conversationUlids,
  );
}

function readPersistedMentionFlags(actorPtid: string): string[] {
  const actor = actorPtid.trim();
  if (!actor) return [];
  const value = readAllActorDomainValuesSync<string[]>(
    actor,
    MENTION_FLAG_DOMAIN,
  ).get(MENTION_FLAG_KEY);
  if (!Array.isArray(value)) return [];
  return value.filter((ulid): ulid is string => typeof ulid === 'string' && ulid.length > 0);
}

// ── Store ──

export const useNavigationBadgeStore = createDesktopStore<NavigationBadgeState>('navigationBadges', (set, get) => ({
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

  hasMention: (actorPtid, conversationUlid) => {
    const actor = actorPtid.trim();
    if (!actor) return false;
    return get().mentionFlagsByActor[actor]?.includes(conversationUlid) ?? false;
  },

  markMention: (actorPtid, conversationUlid) => {
    const actor = actorPtid.trim();
    if (!actor || !conversationUlid) return;
    set((state) => {
      const existing = state.mentionFlagsByActor[actor] ?? [];
      if (existing.includes(conversationUlid)) return state;
      const mentionFlagsByActor = {
        ...state.mentionFlagsByActor,
        [actor]: [...existing, conversationUlid],
      };
      persistMentionFlags(actor, mentionFlagsByActor[actor]);
      return { mentionFlagsByActor };
    });
  },

  clearMention: (actorPtid, conversationUlid) => {
    const actor = actorPtid.trim();
    if (!actor) return;
    set((state) => {
      const existing = state.mentionFlagsByActor[actor] ?? [];
      if (!existing.includes(conversationUlid)) return state;
      const next = existing.filter((ulid) => ulid !== conversationUlid);
      const mentionFlagsByActor = { ...state.mentionFlagsByActor, [actor]: next };
      persistMentionFlags(actor, next);
      return { mentionFlagsByActor };
    });
  },

  hydrateMentionFlags: (actorPtid) => {
    const actor = actorPtid.trim();
    if (!actor) return;
    const persisted = readPersistedMentionFlags(actor);
    set((state) => ({
      mentionFlagsByActor: { ...state.mentionFlagsByActor, [actor]: persisted },
    }));
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

    // Drop @mention flags whose conversation has no RAW unread left.
    // Visible (mute-filtered) unread cannot be used here: a muted group with
    // an @mention intentionally keeps zero visible unread while the flag must
    // survive. Opening the conversation marks it read (raw unread → 0 and
    // clearMention), and this prune heals a missed clear on the next sync.
    const priorMentionFlags = useNavigationBadgeStore.getState().mentionFlagsByActor;
    const mentionFlagsByActor: Record<string, string[]> = {};
    let mentionFlagsChanged = false;
    for (const [actor, ulids] of Object.entries(priorMentionFlags)) {
      const kept = ulids.filter((ulid) => (socialState.groupUnreadCounts[ulid] ?? 0) > 0);
      mentionFlagsByActor[actor] = kept;
      if (kept.length !== ulids.length) {
        mentionFlagsChanged = true;
        persistMentionFlags(actor, kept);
      }
    }

    set({
      chatUnreadTotal: reconciled,
      chatUnreadBySessions,
      ...(mentionFlagsChanged ? { mentionFlagsByActor } : {}),
    });

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
let unsubscribeSession: (() => void) | null = null;
let unsubscribeSocial: (() => void) | null = null;
// Federation runtime reconciliation runs at 30s so cross-Station badge state
// stays fresh; the dock IPC dedup guard below keeps the shorter interval cheap.
const RECONCILE_INTERVAL_MS = 30_000;
// Last count already mirrored to the native dock. Without this guard every
// badge-store write fired a native_dock_set_badge IPC even when the count was
// identical (measured ~4 redundant calls/min at idle).
let lastDockBadgeCount: number | null = null;

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
  // Idempotent: the native badge only changes when the count changes.
  if (lastDockBadgeCount === count) return;
  lastDockBadgeCount = count;
  void api.nativeDockSetBadge(count).catch((error) => {
    // Allow a retry on the next store change if the IPC failed.
    lastDockBadgeCount = null;
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

  // Rehydrate persisted @mention flags for the active actor and whenever the
  // authenticated actor changes (cold restore, login, account switch). The
  // session store is a leaf dependency; subscribing here (instead of the
  // session store importing badge state) keeps the module graph acyclic.
  const hydrateForCurrent = () => {
    const actorPtid = useSessionStore.getState().currentUser?.actorPtid;
    if (actorPtid) {
      useNavigationBadgeStore.getState().hydrateMentionFlags(actorPtid);
    }
  };
  hydrateForCurrent();
  let lastActorPtid = useSessionStore.getState().currentUser?.actorPtid ?? null;
  unsubscribeSession = useSessionStore.subscribe((state) => {
    const nextPtid = state.currentUser?.actorPtid ?? null;
    if (nextPtid !== lastActorPtid) {
      lastActorPtid = nextPtid;
      if (nextPtid) {
        useNavigationBadgeStore.getState().hydrateMentionFlags(nextPtid);
      }
    }
  });

  // Opening a group consumes its @me marker (the group was muted-safe while
  // parked; selecting it means the mention was seen). Clearing here keeps the
  // dependency edge badge-store → social-store one-directional.
  let lastActiveGroup: string | null = useSocialChatStore.getState().activeGroupUlid;
  unsubscribeSocial = useSocialChatStore.subscribe((state) => {
    const nextGroup = state.activeGroupUlid;
    if (nextGroup && nextGroup !== lastActiveGroup) {
      const actorPtid = state.currentUserPtid;
      if (actorPtid) {
        useNavigationBadgeStore.getState().clearMention(actorPtid, nextGroup);
      }
    }
    lastActiveGroup = nextGroup;
  });

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
  if (unsubscribeSession) {
    unsubscribeSession();
    unsubscribeSession = null;
  }
  if (unsubscribeSocial) {
    unsubscribeSocial();
    unsubscribeSocial = null;
  }
  if (isTauriRuntime()) {
    void api.nativeDockSetBadge(0).catch(() => {});
  }
  lastDockBadgeCount = null;
  useNavigationBadgeStore.getState().reset();
  log.info('navigationBadges', 'projection torn down');
}
