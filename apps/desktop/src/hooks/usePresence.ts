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
const SESSION_VALIDATION_INTERVAL = 5 * 1000;

/**
 * Coalesce burst-y DOM events: foreground/background often fire twice
 * within a few hundred ms (`focus` then `visibilitychange`). The Rust
 * cooldown handles the macro case; this micro-debounce keeps the
 * Tauri command channel from churning.
 */
const DEBOUNCE_MS = 250;

export function usePresence(): void {
  const lastTriggerRef = useRef<{ trigger: PresenceTrigger; at: number } | null>(null);
  const startedActorRef = useRef<string | null>(null);

  useEffect(() => {
    const fire = (trigger: PresenceTrigger): void => {
      if (useSessionStore.getState().currentUser?.loginMethod === 'readiness-probe') {
        return;
      }
      const now = Date.now();
      const last = lastTriggerRef.current;
      if (last && last.trigger === trigger && now - last.at < DEBOUNCE_MS) {
        return;
      }
      lastTriggerRef.current = { trigger, at: now };
      void api.presenceNotify(trigger);
    };

    const validateActiveSession = (): void => {
      const { authenticated, currentUser } = useSessionStore.getState();
      if (currentUser?.loginMethod === 'readiness-probe') return;
      if (!authenticated) return;
      if (document.visibilityState !== 'visible') return;
      void api.authValidateToken({}).catch((error) => {
        // Session-revoked responses publish AUTH_SESSION_REVOKED inside
        // desktop_api; this catch only prevents the liveness probe from
        // surfacing as an unhandled promise rejection.
        log.debug('presence', 'session liveness probe failed', { error: String(error) });
      });
    };

    // ---- Launch trigger -------------------------------------------------
    // Fire `app_launch` once for each authenticated actor in this
    // renderer lifetime. Login / unlock can happen without a full
    // WebView reload, so a single boolean would leave the realtime
    // streams bound to the previous actor.
    const tryFireLaunch = (): void => {
      const { authenticated, currentUser } = useSessionStore.getState();
      if (currentUser?.loginMethod === 'readiness-probe') {
        startedActorRef.current = null;
        return;
      }
      const actorId = authenticated ? currentUser?.actorId || null : null;
      if (!actorId) {
        startedActorRef.current = null;
        return;
      }
      if (startedActorRef.current === actorId) return;
      startedActorRef.current = actorId;
      fire('app_launch');
      // Open the unified realtime SSE stream on the same edge. Presence
      // flips are carried by StreamEvent.PresenceFlip on this channel.
      void api.realtimeStreamStart().catch((error) => {
        log.warn('presence', 'realtimeStreamStart failed', error);
      });
    };
    tryFireLaunch();
    const unsubSession = useSessionStore.subscribe(() => tryFireLaunch());

    // ---- Visibility -----------------------------------------------------
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        fire('app_foreground');
        validateActiveSession();
      } else {
        fire('app_background');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ---- Focus / blur ---------------------------------------------------
    // `focus` doesn't always trigger `visibilitychange` (e.g. clicking
    // outside the window then back), so we add it as a separate hint.
    // The Rust cooldown collapses the duplicate.
    const onFocus = (): void => {
      fire('app_foreground');
      validateActiveSession();
    };
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

    const sessionValidation = window.setInterval(
      validateActiveSession,
      SESSION_VALIDATION_INTERVAL,
    );

    log.debug('presence', 'usePresence wired');

    return () => {
      unsubSession();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.clearInterval(heartbeat);
      window.clearInterval(sessionValidation);
    };
  }, []);
}
