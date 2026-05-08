/**
 * usePresence — emits browser-side lifecycle signals to the Rust
 * presence supervisor.
 *
 * # What this hook does *not* do
 *
 * It does **not** track presence state. The supervisor in Rust is the
 * single source of truth; this hook only forwards triggers. Components
 * that need to react to presence changes should listen to the
 * `presence:transition` event via the bridge in `services/presence.ts`,
 * not poll this hook.
 *
 * # Trigger sources
 *
 *  - `app_launch`        — fired once after `dataReady && authenticated`
 *  - `app_foreground`    — `visibilitychange` (visible) + `focus`
 *  - background / blur   — ignored for reachability; desktop windows can
 *                          lose focus while the actor remains online
 *  - `network_online`    — `window.online`
 *  - `network_offline`   — `window.offline`
 *  - `heartbeat`         — every `HEARTBEAT_INTERVAL` while visible
 *
 * Identity-driven triggers (`identity_restored`, `identity_switched`,
 * `identity_logged_out`) are emitted by the auth flow directly, not by
 * this hook — that's because auth has the precise semantics (which
 * actor changed, which login method) and shouldn't be inferred from
 * generic lifecycle events.
 */

import { useEffect, useRef } from 'react';
import { api, type PresenceTrigger } from '../services/desktop_api';
import { useSessionStore } from '../store/session';
import { log } from '../utils/logger';

/**
 * 5 minutes — the safety net pulse. Tight enough to recover from a
 * missed network/visibility event within human-conversation latency,
 * loose enough to be a true backstop rather than a poller.
 */
const HEARTBEAT_INTERVAL = 5 * 60 * 1000;

/**
 * Coalesce burst-y DOM events: foreground/background often fire twice
 * within a few hundred ms (`focus` then `visibilitychange`). The Rust
 * cooldown handles the macro case; this micro-debounce keeps the
 * Tauri command channel from churning.
 */
const DEBOUNCE_MS = 250;

export function usePresence(): void {
  const lastTriggerRef = useRef<{ trigger: PresenceTrigger; at: number } | null>(null);
  const launchedRef = useRef(false);
  const activeActorRef = useRef<string | null>(null);
  const lifecycleTransitionRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const fire = (trigger: PresenceTrigger): void => {
      const now = Date.now();
      const last = lastTriggerRef.current;
      if (last && last.trigger === trigger && now - last.at < DEBOUNCE_MS) {
        return;
      }
      lastTriggerRef.current = { trigger, at: now };
      void api.presenceNotify(trigger);
    };

    // ---- Launch / shutdown trigger --------------------------------------
    // Fire `app_launch` for every authenticated actor edge, and stop
    // the presence supervisor when the actor changes or disappears.
    // The IM realtime event stream is owned by `socialRealtime`; this
    // hook only forwards presence lifecycle triggers.
    const stopPresenceSupervisor = async (): Promise<void> => {
      const results = await Promise.allSettled([
        api.friendChatPresenceStop(),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          log.warn('presence', 'presence supervisor stop failed', result.reason);
        }
      }
      launchedRef.current = false;
      activeActorRef.current = null;
    };

    const startPresenceSupervisor = async (actorId: string): Promise<void> => {
      fire('app_launch');
      const results = await Promise.allSettled([
        api.friendChatPresenceStart(),
      ]);
      for (const result of results) {
        if (result.status === 'rejected') {
          log.warn('presence', 'presence supervisor start failed', result.reason);
        }
      }
      launchedRef.current = true;
      activeActorRef.current = actorId;
    };

    const reconcileActorLifecycle = (): void => {
      const { authenticated, currentUser } = useSessionStore.getState();
      const nextActorId = authenticated ? currentUser?.actorId ?? null : null;
      if (nextActorId && launchedRef.current && activeActorRef.current === nextActorId) {
        return;
      }
      if (!nextActorId && !launchedRef.current && !activeActorRef.current) {
        return;
      }

      lifecycleTransitionRef.current = lifecycleTransitionRef.current.then(async () => {
        const latest = useSessionStore.getState();
        const latestActorId = latest.authenticated ? latest.currentUser?.actorId ?? null : null;
        const previousActorId = activeActorRef.current;

        if (!latestActorId) {
          if (previousActorId || launchedRef.current) {
            await stopPresenceSupervisor();
          }
          return;
        }

        if (previousActorId && previousActorId !== latestActorId) {
          await stopPresenceSupervisor();
        }

        if (!launchedRef.current || activeActorRef.current !== latestActorId) {
          await startPresenceSupervisor(latestActorId);
        }
      }).catch((error) => {
        log.warn('presence', 'actor lifecycle reconciliation failed', error);
      });
    };

    reconcileActorLifecycle();
    const unsubSession = useSessionStore.subscribe(() => reconcileActorLifecycle());

    // ---- Visibility -----------------------------------------------------
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        fire('app_foreground');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---- Focus / blur ---------------------------------------------------
    // `focus` doesn't always trigger `visibilitychange` (e.g. clicking
    // outside the window then back), so we add it as a separate hint.
    // Blur is intentionally ignored: on desktop, losing foreground does not
    // mean the authenticated actor is unreachable for chat.
    const onFocus = (): void => fire('app_foreground');
    window.addEventListener('focus', onFocus);

    // ---- Network --------------------------------------------------------
    const onOnline = (): void => fire('network_online');
    const onOffline = (): void => fire('network_offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // ---- Heartbeat ------------------------------------------------------
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fire('heartbeat');
      }
    }, HEARTBEAT_INTERVAL);

    log.debug('presence', 'usePresence wired');

    return () => {
      unsubSession();
      void stopPresenceSupervisor();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(heartbeat);
    };
  }, []);
}
