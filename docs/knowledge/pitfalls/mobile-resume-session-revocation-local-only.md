---
kind: pitfall
title: Resume restores the session locally and cannot detect same-account replacement without a refresh
status: active
owns:
  - apps/mobile/src/runtimes/sessionRuntime.ts
  - apps/mobile/src/app/lifecycle/MobileLifecycleKernel.ts
  - apps/mobile/src-tauri/src/commands/oauth.rs
  - apps/mobile/src-tauri/src/runtime/oauth/session.rs
  - tooling/acceptance/gates/mobile/simulator_station_lifecycle_e2e.py
referenced-by: []
related:
  - docs/knowledge/pitfalls/mobile-actor-display-name-ptid-fallback.md
detected: 2026-11-11
---

# Resume restores the session locally and cannot detect same-account replacement without a refresh

## Symptom

`mobile-simulator-station-lifecycle-e2e` fails consistently at the AS-04
same-account revocation step after the peer simulator replaces the session:

```
sim-ios lifecycle scope did not converge: launchState='shell'
```

The primary app is suspended and resumed, but instead of clearing its scope
and exposing the Access Gate it stays in the authenticated `shell` launch
state past the 30s convergence timeout.

## Root cause

The resume chain is deliberately local-only:

`MobileLifecycleKernel.resume` → session runtime descriptor `resume()` →
`restoreOwnedSession()` → `sessionRuntime.restore()` →
`native.read('oauth_session_projection')`.

- The Tauri command `oauth_session_projection`
  (`runtime/oauth/session.rs::session_projection_inner`) only reads the bound
  session from secure storage; it never calls the Station.
- The web `restore()` re-activates any locally stored projection without
  revalidation. This is an encoded contract: `sessionRuntime.test.ts`
  asserts `native.refresh` is not called on restore.
- Server-side revocation is discovered only by `refresh()`, which runs on the
  scheduled timer (`expiresAt - now - REFRESH_WINDOW_MS`, 2 minute window) or
  on an authenticated 401. A long-lived replaced session therefore stays
  active after resume because no refresh fires inside the Gate window.

This behavior predates the peers-ui landing (identical since the W3 lifecycle
hard cut) and lives entirely in the native OAuth/session layer; no
presentation or identity-projection change in the peers-ui work touches it.

## Resolution (implemented): revalidate on resume, keep restore local-only

Option 1 below is the shipped contract. The revalidation lives in the Session
runtime **descriptor** `resume()` path, never inside the controller
`restore()` whose local-only unit contract is unchanged.

`createSessionRuntimeDescriptor().resume()` first awaits the storage-only
`restoreOwnedSession()`, then fires `revalidateResumedSession()` without
blocking the kernel resume budget:

1. If the restored projection is active, call
   `sessionRuntime.refresh('scheduled')`, which goes through the native
   `oauth_session_refresh` → `rotate_session` (`POST /actor/session/takeover`).
   A replaced session returns `mobile.auth.sessionCredentialRejected:401`,
   classified terminal by `isTerminalSessionRefreshError`, so the controller
   purges native storage, reports the `session-expired` recovery flag, and
   publishes a null session.
2. Transient failures (`oauthTransportUnavailable`, `oauthResponseRead`,
   `sessionCredentialRejected:408/429/5xx`) keep the cached projection, retain
   shell admission, and arm the existing retry schedule, preserving offline
   first resume.
3. The Station round trip is intentionally not awaited inside `resume()`: the
   kernel enforces a short per-descriptor resume timeout, and foreground resume
   must survive a slow or unreachable Station.
4. The probe is triggered by a kernel `phase-changed` event, not a timer. A
   terminal revocation flips session admission to `refreshing` and then nulls
   the projection; doing that while dependent runtimes
   (messaging, social, command, chat-storage, private-social,
   recovery-projection) are still inside the kernel resume cascade makes their
   `resume()` operations fail and surfaces as
   `mobile.lifecycle.resumeIncomplete:...`. The cascade `await`s native IPC and
   therefore crosses macrotask boundaries, so neither an inline call nor a
   `setTimeout(0)` poll can reliably order after it. `resume()` instead records
   a pending revalidation epoch, and a kernel event listener registered in
   `bootstrap()` fires the probe only when the graph emits
   `phase-changed: ACTIVE`, which happens after every descriptor resume
   succeeds; revocation then runs in the same steady-state,
   subscription-driven regime as a scheduled refresh. `suspend()`/`teardown()`
   clear the pending epoch and the listener, and the descriptor
   `lifecycleEpoch` guard neutralizes stale work.
5. When the refresh settles with a null session and the descriptor epoch is
   still current, the descriptor requests
   `kernel.reconcileLaunchState('reliability-recovery')` so the launch state
   leaves `shell` for the Access Gate instead of waiting on the scheduled
   refresh window.

The regression coverage is in
`apps/mobile/src/runtimes/sessionDescriptorLifecycle.test.ts` (mocked kernel)
and `sessionDescriptorResumeKernel.test.ts` (real kernel): healthy rotate stays
in shell, terminal 401 revokes and reconciles, transient transport failure
retains the cached session, suspension cancels a pending probe, and the probe
waits for the `phase-changed: ACTIVE` event rather than firing while the graph
is RESUMING.

## Decision context

Closing AS-04 needed an explicit product/security choice. The alternatives
considered were:

1. **Revalidate on resume (selected)** — after local restore, issue a
   `refresh()` when a session is active. Terminal 401 already revokes and
   clears the scope; non-terminal network errors already keep the cached
   session, so offline resume remains non-destructive. This adds a Station
   round trip to every foreground and changes the offline-first guarantee.
2. **Keep local resume, tighten refresh timing** — leave `restore()` as-is and
   shorten or force the refresh window so replacement is detected promptly,
   preserving the explicit no-refresh-on-restore unit contract.
3. **Native push of revocation** — have the Rust coordinator observe a
   server-side revocation event instead of relying on client polling.

Any option must keep `restore()` local (its unit tests pin this), fence the
new work with `lifecycleEpoch`, and be verified with the full
`mobile-simulator-station-lifecycle-e2e` run (dual
`--station-profile station-primary=chat-native-disposable
station-secondary=chat-native-four`, ~10 minutes, 310s route-expiry wait).

## How to detect a recurrence

- The Gate fails only at `_wait_for_scope(_scope_is_cleared)` after
  `lifecycle.suspend`/`lifecycle.resume`; earlier restart and route-expiry
  steps pass, which isolates the gap to resume-time revalidation rather than
  authentication or Station connectivity.
- `sessionRuntime.test.ts` distinguishes the contracts: `restore()` must
  stay read-only, while any new revalidation belongs in the runtime
  descriptor `resume()` path or the refresh scheduler, not inside `restore()`.

## Cross-installation revocation scope (gate blocker, 2026-11)

The two simulator clients do **not** share an OAuth `device_id`. The
acceptance fixture only presets the shared crypto identity seed
(`mobile-crypto-identity.*` via `acceptance_replace_identity_seed`); the OAuth
installation id (`oauth.device.id`, read in
`runtime/oauth/mod.rs::load_or_create_identity`) is generated randomly per
install and is never seeded by the harness. Station-side replacement
revocation (`RevokeReplacedDeviceSessions`,
`frame/core/facility/session/db_store.rs`) is scoped to
`user_id + station_peer_id + device_id` and "replaces only sessions bound to
the same Station and installation".

Consequence: a same-account login on the peer simulator (a distinct
installation) does not mark the primary simulator's session `revoked`, so a
resume-time `oauth_session_refresh` (rotate) returns success, not 401. The
client-side revalidation implemented here is correct for the same-installation
case (covered by the real-kernel integration test), but it cannot observe a
cross-installation takeover while revocation remains per-device. Closing the
two-simulator AS-04 gate therefore needs one of:

1. Station: actor-wide (cross-device) invalidation of the actor's other
   sessions on same-account login, or
2. A server-pushed revocation channel the mobile client observes, or
3. The harness provisioning a shared `oauth.device.id` if the intent is a
   same-installation replacement.

This is an architectural/provisioning decision, not something additional
client polling can resolve.

