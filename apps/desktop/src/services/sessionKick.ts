// services/sessionKick.ts
//
// Bridge for Rust-emitted `auth:session-kicked` Tauri events.
//
// The backend fires this event when a long-lived Station stream reconnects
// and receives `401 {"code":"session_revoked","reason":"kicked|expired|..."}`.
// This catches scenarios that request-local API handling cannot see yet,
// because the only authority on duplicate logins is Station's session store.
//
// Both cases are mapped onto the existing `AUTH_SESSION_REVOKED` event so
// the unified `onSessionRevoked` handler in `App.tsx` shows the
// already-localised modal and triggers logout.

import { EVENT } from '../kernel/events/catalog';
import { eventBus } from '../kernel/events/bus';
import { isBrowserGatewayRuntime } from '../kernel/gateway';
import { log } from '../utils/logger';
import type {
  SessionRevokedPayload,
  SessionRevokedReason,
} from '../kernel/events/types';

const SESSION_KICKED_EVENT = 'auth:session-kicked';

interface RustKickedPayload {
  reason?: 'takeover' | 'revoked' | string;
  actor_id?: string | null;
  details?: {
    device_type?: string | null;
    [key: string]: unknown;
  } | null;
}

function normaliseReason(reason: string | undefined): SessionRevokedReason {
  // Keep the UI reason set small; any server-side takeover is shown as the
  // same "another login won" flow regardless of which stream observed it.
  if (reason === 'takeover' || reason === 'kicked') return 'kicked';
  if (reason === 'expired') return 'expired';
  if (reason === 'not_found') return 'not_found';
  return 'unknown';
}

let unlistenFn: (() => void) | null = null;

/**
 * Install the Tauri event listener that maps `auth:session-kicked` payloads
 * into the in-process `AUTH_SESSION_REVOKED` event. Idempotent: a second
 * call without an intervening teardown is a no-op.
 *
 * Returns the unsubscribe function (also stored internally so
 * `teardownSessionKickBridge()` can be called from cleanup code that does
 * not have the handle).
 */
export async function installSessionKickBridge(): Promise<() => void> {
  if (unlistenFn) return unlistenFn;

  // Tauri's `listen` is async (it talks to the Rust IPC channel). When
  // running in the browser dev gateway, `@tauri-apps/api/event` falls
  // through to a no-op polyfill, which is fine — duplicate-login
  // detection in that mode happens via Station 401s on the next API
  // call, not via this Tauri event.
  let off: () => void = () => {};
  try {
    const mod = await import('@tauri-apps/api/event');
    const handle = await mod.listen<RustKickedPayload>(
      SESSION_KICKED_EVENT,
      (event) => {
        // MCA-D19 multi-device: If Station's revocation response specifies a
        // target device_type that differs from the current client, skip the
        // revocation. This prevents a browser login from kicking the native
        // client when multi-device sessions are enabled.
        const targetDeviceType = event.payload?.details?.device_type ?? null;
        if (targetDeviceType) {
          const currentDeviceType = isBrowserGatewayRuntime() ? 'desktop-browser' : 'desktop-native';
          if (targetDeviceType !== currentDeviceType) {
            log.info('sessionKick', 'ignoring session-kicked for different device type', {
              targetDeviceType,
              currentDeviceType,
            });
            return;
          }
        }

        const reason = normaliseReason(event.payload?.reason);
        const payload: SessionRevokedPayload = { reason };
        eventBus.publish(EVENT.AUTH_SESSION_REVOKED, payload);
      },
    );
    off = () => handle();
  } catch {
    // Browser dev gateway — no Tauri event channel. Fail silently; the
    // standard 401 path on subsequent API calls covers this scenario.
    off = () => {};
  }
  unlistenFn = off;
  return off;
}

export function teardownSessionKickBridge(): void {
  if (unlistenFn) {
    try { unlistenFn(); } catch { /* noop */ }
    unlistenFn = null;
  }
}
