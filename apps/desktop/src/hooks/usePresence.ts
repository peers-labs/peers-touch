/**
 * usePresence — emits browser-side lifecycle signals to the Rust
 * presence supervisor.
 *
 * # What this hook does *not* do
 *
 * It does **not** track presence state. The supervisor in Rust is the
 * single source of truth; this hook only forwards triggers. Components
 * that need to react to presence changes should listen to the
 * `presence.transition` event via the bridge in `services/presence.ts`,
 * not poll this hook.
 *
 * # Trigger sources
 *
 *  - `app_launch`        — fired once after `dataReady && authenticated`
 *  - `app_foreground`    — `visibilitychange` (visible) + `focus`
 *  - `app_background`    — `visibilitychange` (hidden) + `blur`
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

    // ---- Launch trigger -------------------------------------------------
    // Fire `app_launch` once we have a real authenticated session. We
    // subscribe to the session store and fire the first time
    // `authenticated` flips true — this covers cold boot, warm resume,
    // and post-login. The Rust supervisor's `IdentitySwitched` trigger
    // (emitted by auth commands) handles subsequent identity changes.
    const tryFireLaunch = (): void => {
      if (launchedRef.current) return;
      const { authenticated, currentUser } = useSessionStore.getState();
      if (authenticated && currentUser?.actorId) {
        launchedRef.current = true;
        fire('app_launch');
        // Start the peer-presence SSE supervisor on the same edge as
        // `app_launch`. Two reasons to keep it here rather than in
        // SocialChatPage's mount effect:
        //   1. The chat surface is keep-alive; mounting/unmounting it
        //      to switch tabs would otherwise tear down the stream and
        //      lose state on every navigation.
        //   2. `usePresence` already gates on `authenticated`, so the
        //      same launch debounce (`launchedRef`) covers both this
        //      and `app_launch` — one place, one lifecycle, one bug.
        // The Rust side is idempotent: a duplicate `start` cancels the
        // previous supervisor and replaces it.
        void api.friendChatPresenceStart().catch((error) => {
          log.warn('presence', 'friendChatPresenceStart failed', error);
        });
      }
    };
    tryFireLaunch();
    const unsubSession = useSessionStore.subscribe(() => tryFireLaunch());

    // ---- Visibility -----------------------------------------------------
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        fire('app_foreground');
      } else {
        fire('app_background');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---- Focus / blur ---------------------------------------------------
    // `focus` doesn't always trigger `visibilitychange` (e.g. clicking
    // outside the window then back), so we add it as a separate hint.
    // The Rust cooldown collapses the duplicate.
    const onFocus = (): void => fire('app_foreground');
    const onBlur = (): void => fire('app_background');
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

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
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(heartbeat);
    };
  }, []);
}
