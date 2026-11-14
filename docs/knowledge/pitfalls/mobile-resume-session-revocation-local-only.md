---
kind: pitfall
title: AS-04 cross-installation revocation assertion conflicts with the SAL-D12 per-device session contract
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

# AS-04 cross-installation revocation assertion conflicts with the SAL-D12 per-device session contract

## Executive summary

The Gate failure is not a client or Station bug. It is a contract mismatch
between an acceptance Gate written before the per-device session decision and
the architecture that is now accepted and implemented:

- **Accepted architecture (SAL-D12, 2026-10-27):** the Station session slot is
  `(station_peer_id, actor, device_id)`. Re-authenticating on the **same
  installation** atomically revokes only that installation's prior session;
  **other installations stay active**, including multiple Mobile clients.
  Actor-wide revocation on login is an explicitly rejected alternative.
- **The Gate (`simulator_station_lifecycle_e2e.py`, logic last changed
  2026-10-22):** launches two distinct simulator installations (different
  `device_id`) and expects the peer's same-account login to revoke the primary
  session. Under SAL-D12 that must not happen, so the primary correctly stays
  in `shell` and `_wait_for_scope(_scope_is_cleared)` times out.

Neither production workaround attempted earlier is valid:

1. Actor-wide revocation on login is rejected by SAL-D12 because it breaks
   Desktop+Mobile coexistence.
2. Sharing one OAuth `device_id` across the two installs violates the
   installation identity (`device_id` binds Messaging/OAuth/lifecycle) and
   empirically crashes the peer `messaging` runtime with a forbidden key
   rotation, failing the run before AS-04. That pin and the temporary Gate
   diagnostics have been reverted.

The correct closure is to **realign the AS-04 Gate to SAL-D12**, not to change
Station revocation semantics. See
[Resolution: realign the Gate to SAL-D12](#resolution-realign-the-gate-to-sal-d12).

## Symptom

`mobile-simulator-station-lifecycle-e2e` fails consistently at the AS-04
same-account revocation step after the peer simulator authenticates as the
same actor:

```
sim-ios lifecycle scope did not converge: launchState='shell'
```

The primary app is suspended and resumed, but instead of clearing its scope
and exposing the Access Gate it stays in the authenticated `shell` launch
state past the 30s convergence timeout.

## Root cause

There are two distinct layers. Only the second is the reason the two-simulator
Gate cannot pass, and it is an acceptance-contract mismatch, not a code defect.

1. **Resume was local-only (client layer, already fixed).** Even when a
   session really is revoked, a suspended/resumed app would not notice without
   a Station round trip. The resume revalidation described below closes this
   layer for the legitimate same-device `kicked` case.
2. **The Gate expects cross-installation revocation that SAL-D12 forbids
   (contract layer, still open).** The peer simulator is a different
   installation with a different `device_id`; per SAL-D12 its login must not
   revoke the primary. No amount of client revalidation can observe a
   revocation the Station is contractually required not to emit. This is the
   blocker and needs a Gate realignment, not a production change.

### Layer 1 — the local-only resume chain

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

The revalidation lives in the Session runtime **descriptor** `resume()` path,
never inside the controller `restore()` whose local-only unit contract is
unchanged.

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

The resume-time revalidation was an explicit product/security choice. The
alternatives considered were:

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

## Layer 2 — the Gate contradicts SAL-D12 (the real blocker)

### Authoritative contract

SAL-D12 ("按 Station、Actor 与设备原子替换 Session", accepted 2026-10-27,
`docs/architecture/platform/station/access/decisions.md`) defines the session
concurrency slot as `station_peer_id + actor + device_id`:

- Same-device re-authentication or rotation atomically revokes only that
  device's prior session (`revoked_reason = "kicked"`).
- Other installations are excluded from the revoke set and stay active,
  including multiple Mobile clients (`design.md §8 Device Session Slot`,
  `data-model.md §7`, `acceptance-matrix.md` SAL-G08: "不同 device 可并存").
- "每次登录撤销 actor 全部 Session" is an explicitly **rejected** alternative
  because it breaks Desktop+Mobile coexistence. Any future device-count limit
  must arrive through explicit policy, a device list and a revocation
  confirmation (the SAL-D12 Reversal Trigger), never by reviving an implicit
  unique index or widening the revoke set.

The implementation matches the decision everywhere and is pinned by Go tests:

- `session.RevokeReplacedDeviceSessions` and the locked helper revoke only rows
  matching `user_id + station_peer_id + device_id`
  (`frame/core/facility/session/db_store.go`).
- `Takeover` preserves the previous session's `device_id` and then runs the same
  per-device replacement; the Access Gate finalizer does likewise
  (`frame/touch/accessgate/session_finalizer.go`). There is no actor-wide revoke
  path.
- `TestRevokeReplacedAccessGateSessionsRevokesSameDeviceAndPreservesOtherDevices`
  asserts another device's session for the same actor is preserved.

### Why the Gate fails

The Gate was last substantively changed on 2026-10-22, before SAL-D12. It
authenticates the same actor on a second simulator installation and records
`same-account-session-replaced`, then suspends/resumes the primary and expects
`revoked-session-cleared`. Because the two installs present different
`device_id` values, SAL-D12 requires the primary to remain valid. Empirical
runs confirm this:

- Pre-pin run: primary `device_id` `4wHyfXJe…`, peer `4pzhOoxl…`; after peer
  login both read `launchState = shell`, so `_wait_for_scope(_scope_is_cleared)`
  times out. This is correct Station behavior.
- All 18 historical PROVEN runs predate SAL-D12 (newest 2026-10-12), so they
  encode the older per-class mutual-exclusion contract, not the current
  per-device slot.

### Why both attempted workarounds are invalid

1. **Actor-wide revocation on login** — rejected by SAL-D12 and would break the
   multi-device product contract and its Go tests. Not available without a new,
   explicitly accepted policy decision.
2. **Sharing one OAuth `device_id` across installs** — `device_id` identifies
   the installation and binds the Messaging signing enrollment, OAuth and
   lifecycle. The Messaging engine enforces one enrollment per
   `(actor_ptid, device_id)` and forbids key rotation
   (`apps/mobile/src-tauri/src/messaging/engine.rs`). A pinned shared id made the
   peer `messaging` runtime fail (`mobile.lifecycle.runtimeFailed:messaging` and
   dependents) before AS-04 ran. The acceptance pin and the temporary Gate
   diagnostics were reverted; production keeps random per-install ids.

## Resolution: realign the Gate to SAL-D12

The Station and client behavior already conform to the accepted architecture,
so no production revocation change is warranted. The AS-04 Gate must be
realigned to prove the per-device contract instead of cross-device eviction:

1. **Multi-device coexistence.** After the peer (a different `device_id`) logs
   in as the same actor, assert the primary remains authenticated
   (`launchState = shell`, same actor/Station) rather than expecting it to be
   cleared. This mirrors SAL-G08 and the Go preservation test.
2. **Same-device replacement.** Prove the `kicked` path using one installation
   slot: re-authenticate the same client (same `device_id`), which atomically
   revokes that installation's prior session; then suspend/resume and confirm
   the resume revalidation gets a terminal 401, clears the scope and reaches the
   Access Gate. This is exactly the behavior the shipped resume revalidation
   already implements and tests. No cross-install id sharing is involved.
3. **Independent revocation.** Keep the existing Station-switch and logout
   assertions, which revoke only the acting device's session.

This changes what the acceptance Gate proves, so the realignment was made only
after an explicit product/acceptance decision. The proof-scope string was synced
across `gates/mobile/README.md §9.4`, `gates.yaml`,
`environments/mobile-station-lifecycle-simulator.yaml` and
`provisioners/mobile_simulator.py` (the provisioner enforces an exact-set
match). The client resume revalidation work is retained regardless, because
same-device `kicked` detection is still a real requirement.

## Implemented and verified (2026-11-11)

The Gate was realigned to the three points above and now records
`same-account-multi-device-coexistence` (asserting distinct `device_id`s) and
`same-account-session-preserved-after-resume` instead of the old
cross-installation `revoked-session-cleared` expectation. The first secondary
Station switch now asserts `remoteRevocation = confirmed`, because the primary
session is still live at that point (`station.select` on a different Station
runs a real `station-replace` revoke; `not-required` only applies to a
same-Station select or an absent session).

A second, previously masked blocker then surfaced. Once the journey passed,
`acceptance-run` rejected the sealed report with
`"<gate>: source report is unproven"`. `core/proof.py::require_report_proof`
requires a non-empty list of named, passing `assertions` on the evidence
report; this lifecycle Gate emitted none. Every earlier run had failed during
the journey itself, so the missing-assertions rule was never reached. The fix
adds a fail-closed `_assertions_from_lifecycle_evidence` builder that derives
each predicate from the recorded events and journey result (restore,
distinct-device coexistence, resume preservation, confirmed per-switch
revocation with strictly monotonic generations, binding-proof closure, logout,
no mocks, no physical-device claim, plus the expired-route assertion only in
formal mode). A missing observation flips `passed: False` and fails the run
before the report is sealed; unit tests call `require_report_proof` directly to
lock the contract.

Current-source evidence (commit `f616d2214`, clean workspace digest):
`mobile-simulator-station-lifecycle-e2e` run
`20261111T014554749354Z-88f580d355c22999e56d640cea0bc92f` sealed
`PASS / DONE / PROVEN`, aggregate `failed=0, unproven=0`, all ten named
assertions passing, with live distinct device ids and the primary session
preserved through resume revalidation. Same-device slot replacement stays
covered by the Station Go tests, the switch-loop re-authentications and the
real-kernel terminal-401 resume test rather than by any cross-install id
sharing.
