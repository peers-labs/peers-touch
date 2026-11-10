---
kind: pitfall
title: Renderer generation churn must not tear down the native actor runtime
status: active
owns:
  - apps/desktop/src/store/privateMoments.ts
  - apps/desktop/src/runtimes/momentsRuntime.ts
  - apps/desktop/src/store/session.ts
  - apps/desktop/src-tauri/src/interface/tauri_commands/auth.rs
  - apps/desktop/src/acceptance/secureContentFixture/harness.ts
referenced-by: []
related:
  - docs/knowledge/pitfalls/current-profile-native-runtime-must-own-its-state.md
  - docs/knowledge/invariants/acceptance-suite-runtime-reuse.md
detected: 2026-11-10
owner: desktop-social
review-cadence: on-change
---

# Renderer generation churn must not tear down the native actor runtime

## Symptom

Under rapid account switching (the Social native Gates switch alice ↔ bob within
seconds), two failures appeared even though every individual login succeeded:

- The private-Moments renderer repeatedly lost its native Secure Content lease
  right after a switch, attesting `AUTHENTICATION_REQUIRED` /
  `PRIVATE_RUNTIME_INACTIVE` and self-logging-out the just-unlocked account.
- A login that was abandoned mid-flight later had its *binding failure* arrive;
  the rollback logout then destroyed the **newer** session the window had
  already rebound to, killing the current actor's live Secure Content runtime.

Observed in `social-public-feed-native-e2e`: the fixture never got past
`prepareAccountSwitch`, and a late `auth_logout` tore down the superseding
identity (`teardown_actor` trace attributed to an earlier `logout`).

## Root cause

Two different lifetimes were collapsed onto one signal.

1. The private-Moments **renderer projection** is regenerated on every
   renderer-generation advance. After unlock, Station identity can settle a few
   beats late, and each late identity event bumps the generation. The old
   `deactivate()` treated this same-actor projection reset as "the actor went
   away" and fired an actor-wide **native** teardown, destroying the lease the
   next generation was about to re-activate. Projection lifetime (per
   generation) is not native runtime lifetime (per genuine deauthentication).
2. The binding-rollback logout was **unscoped**: it tore down whatever session
   the window currently held. Under generation churn that is a different actor
   than the one whose binding failed. A late failure for an abandoned attempt
   must never fence a newer identity.

## Mitigation

### What was done in code

- `apps/desktop/src/store/privateMoments.ts`: `deactivate()` is now a
  projection-only reset and never calls the native teardown. Native runtime
  destruction moved to an explicit, best-effort
  `teardownNativeActor(actorPtid, rendererGeneration)`.
- `apps/desktop/src/runtimes/momentsRuntime.ts`: `reconcileAuthenticatedRuntime`
  calls `teardownNativeActor` only when the desired scope is genuinely empty
  (deauthentication). Same-actor churn and cross-actor re-activation never
  reach that branch.
- `apps/desktop/src-tauri/src/interface/tauri_commands/auth.rs`: `auth_logout`
  accepts `Option<ScopedLogoutInput>{ expected_actor_ptid }`. When the window
  has since moved to another actor it returns
  `status: "session_superseded"` without tearing the current session down.
  `apps/desktop/src/store/session.ts` passes the login response's
  `actor_ptid` on the three binding-rollback paths; the explicit user logout
  stays unscoped.
- `apps/desktop/src-tauri/src/secure_content/mod.rs`: `teardown_actor` is
  `teardown_actor_with_source(&'static str)`; every production caller (account
  switch/unlock, logout, identity recovery, device revoke, renderer teardown)
  carries an auditable source label.
- `apps/desktop/src/acceptance/secureContentFixture/harness.ts`: the *restore*
  identity capture retries only the transient not-ready states
  (`AUTHENTICATION_REQUIRED`, `PRIVATE_RUNTIME_INACTIVE`) with a fresh
  bootstrap + latest scope generation (30s/400ms); permanent integrity/binding
  refusals and the first-time (pre-switch) capture still fail immediately.

### What guards against regression

- `vitest run src/runtimes/momentsRuntime.test.ts src/store/session.test.ts
  src/acceptance/secureContentFixture/harness.test.ts` — projection deactivate
  must not invoke native teardown; rollback logout must be actor scoped; the
  fixed native refusal still fails the first capture immediately.
- `rg "teardown_actor\\(" apps/desktop/src-tauri/src` — the unlabelled call
  must not return; all teardowns go through `teardown_actor_with_source`.
- Native product proof: `social-public-feed-native-e2e`,
  `social-cross-station-native-e2e`, `social-private-desktop-e2e`.

## How to detect a recurrence

```bash
rg -n "privateMomentsNative.teardown|teardownNativeActor" apps/desktop/src/store apps/desktop/src/runtimes
```

Native teardown must be referenced only from `teardownNativeActor` and invoked
only on the genuine deauthentication branch, never from `deactivate()`. In a
rapid-switch native run, an actor whose binding already succeeded must never
appear as the target of a `logout`/`teardown_actor` trace emitted by an earlier
attempt.

## Crosswalks

- Pitfall `current-profile-native-runtime-must-own-its-state.md` covers the
  provisioning/ownership boundary this renderer behaviour runs inside.
- Invariant `acceptance-suite-runtime-reuse.md` governs the shared actor
  fixtures these switches run against.
