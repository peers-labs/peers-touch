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

## Decision required

Closing AS-04 needs an explicit product/security choice, not a speculative
edit:

1. **Revalidate on resume** — after local restore, issue a `refresh()` when a
   session is active. Terminal 401 already revokes and clears the scope;
   non-terminal network errors already keep the cached session, so offline
   resume can remain non-destructive. This adds a Station round trip to every
   foreground and changes the offline-first guarantee.
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
