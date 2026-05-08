// services/sessionKick.ts
//
// Bridge for Rust-emitted `auth.session_kicked` Tauri events.
//
// The backend fires this event in two scenarios:
//
//   1. *In-process takeover* — `WindowSessionRegistry::bind_kicking_duplicates`
//      detects that another window in this same Rust process just bound to
//      the same actor we were holding. The new login wins; the older
//      window receives a targeted kick via `app.emit_to(window_label, ...)`.
//
//   2. *Cross-process server-side revoke* — `application::presence_stream`
//      reconnects to Station's presence SSE, gets back
//      `401 {"code":"session_revoked","reason":"kicked|expired|..."}`,
//      and surfaces a global kick. This catches scenarios that
//      `WindowSessionRegistry` cannot see (e.g. `make dev-dual` where the
//      Tauri app and the browser dev tab live in separate Rust processes
//      sharing one Station, so the only authority on duplicate logins is
//      Station's `CreateWithKick`).
//
// Both cases are mapped onto the existing `AUTH_SESSION_REVOKED` event so
// the unified `onSessionRevoked` handler in `App.tsx` shows the
// already-localised modal and triggers logout.

import { EVENT } from '../kernel/events/catalog';
import { eventBus } from '../kernel/events/bus';
import type {
  SessionRevokedPayload,
  SessionRevokedReason,
} from '../kernel/events/types';

const SESSION_KICKED_EVENT = 'auth.session_kicked';

interface RustKickedPayload {
  reason?: 'takeover' | 'revoked' | string;
  actor_id?: string | null;
}

function normaliseReason(reason: string | undefined): SessionRevokedReason {
  // The Rust enum currently emits `takeover` (in-process duplicate) and
  // `revoked` (Station said no). Map both onto the closest UI reason — we
  // intentionally treat `takeover` as `kicked` so the user sees the same
  // "another device signed in" copy regardless of which layer caught it.
  if (reason === 'takeover' || reason === 'kicked') return 'kicked';
  if (reason === 'expired') return 'expired';
  if (reason === 'not_found') return 'not_found';
  return 'unknown';
}

let unlistenFn: (() => void) | null = null;

/**
 * Install the Tauri event listener that maps `auth.session_kicked` payloads
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
