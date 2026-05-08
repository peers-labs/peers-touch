/**
 * Presence bridge — listens to the Rust `presence:transition` Tauri event
 * and refreshes the relevant frontend stores.
 *
 * # Why a bridge module
 *
 * The transition event is the *only* place where multiple subsystems
 * (social chat, sidebar, badges) need to wake up at once after an
 * Offline→Online catch-up. Centralising the listener here means:
 *
 *   - one Tauri listener per process, not N per component
 *   - the supervisor's contract (event name, payload shape) is in one
 *     place — components consume the resulting store updates
 *   - tests can `installPresenceBridge` against a fake store
 *
 * The bridge is wired once at app boot from `App.tsx` and never re-wires
 * across hot-reloads.
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useSocialChatStore } from '../store/socialChat';
import type { PresenceTransitionEvent } from './desktop_api';
import { log } from '../utils/logger';

const PRESENCE_TRANSITION_EVENT = 'presence:transition';

let unlisten: UnlistenFn | null = null;

/**
 * Install the bridge. Idempotent — safe to call from `useEffect` without
 * cleanup, since it dedupes against the module-scoped handle.
 */
export async function installPresenceBridge(): Promise<void> {
  if (unlisten) return;
  try {
    unlisten = await listen<PresenceTransitionEvent>(
      PRESENCE_TRANSITION_EVENT,
      (event) => onTransition(event.payload),
    );
    log.info('presence', 'bridge installed');
  } catch (error) {
    log.warn('presence', 'failed to install bridge', error);
  }
}

/** Tear-down. Tests use this; production `App.tsx` calls it on unmount. */
export function teardownPresenceBridge(): void {
  if (unlisten) {
    try { unlisten(); } catch { /* noop */ }
    unlisten = null;
  }
}

/**
 * Apply a transition to the social chat store. Exported for unit tests so
 * they can call this directly without round-tripping through Tauri.
 */
export function onTransition(payload: PresenceTransitionEvent): void {
  if (!payload || typeof payload.actor_id !== 'string') return;

  log.debug('presence', 'transition', payload);

  // Only Offline→Online with reconciled work needs a refresh; pure
  // Online→Offline is bookkeeping the supervisor already handled.
  if (payload.to !== 'online') return;
  if (!payload.reconciled_count && (!payload.affected_sessions || payload.affected_sessions.length === 0)) {
    return;
  }

  // Fan-out: refresh sidebar + previews in one shot. We deliberately do
  // NOT call `loadMessages(ulid)` per affected session here — most users
  // are not viewing those conversations, and the social chat panel
  // already pulls them on demand when the user clicks in. The store has
  // up-to-date previews and unread counts, which is what matters in the
  // common case.
  try {
    const store = useSocialChatStore.getState();
    void store.loadSessions().catch(() => {});
    if (typeof store.loadConversationPreviews === 'function') {
      void store.loadConversationPreviews().catch(() => {});
    }

    // If the user is currently viewing one of the affected sessions,
    // also pull its messages so the panel doesn't stay stale.
    const activeSessionUlid = store.activeSessionUlid;
    if (activeSessionUlid && payload.affected_sessions.includes(activeSessionUlid)) {
      void store.loadMessages(activeSessionUlid, 'friend').catch(() => {});
    }
  } catch (error) {
    log.warn('presence', 'failed to refresh stores after transition', error);
  }
}
