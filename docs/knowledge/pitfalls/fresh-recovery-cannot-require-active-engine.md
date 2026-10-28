---
kind: pitfall
title: Fresh recovery cannot require an active Messaging Engine
status: active
owns:
  - apps/desktop/src-tauri/src/interface/tauri_commands/messaging_recovery.rs
  - apps/desktop/src-tauri/src/messaging/
  - apps/desktop/src/acceptance/chat/harness.ts
  - apps/desktop/src/acceptance/chat/harness.test.ts
  - apps/desktop/src/components/settings/RecoverySettings.tsx
  - apps/desktop/src/services/messaging-recovery-service.ts
  - apps/desktop/src/services/appRuntime.ts
  - apps/desktop/src/store/messagingRecovery.ts
  - apps/desktop/src/store/messagingRecovery.test.ts
  - apps/desktop/src/runtimes/messagingRecoveryRuntime.ts
  - apps/desktop/src/runtimes/messagingRecoveryRuntime.test.ts
  - apps/desktop/src/messaging/runtime.ts
  - apps/desktop/src/messaging/runtime.test.ts
  - tooling/development/secure_content/runtime_owner.py
referenced-by: []
related:
  - docs/architecture/domains/chat/messaging/decisions.md
  - docs/architecture/shared/security/secure-content/operations.md
detected: 2026-10-19
---

# Fresh Recovery Cannot Require An Active Messaging Engine

## Symptom

CSS-09 passed AS17 through AS22, then its Bob replacement client authenticated
but never reached Moments readiness. Desktop repeatedly reported:

```text
identity continuity conflict: no local identity seed matches the Station continuity record
```

The recovery command then could not run because it required the missing active
Messaging Engine. Even after recovery itself stopped requiring an Engine, the
private Moment read path still required a Secure Content lease and the Moments
runtime invalidated its whole actor scope when private bootstrap failed, so the
safe pre-recovery projection remained unobservable.

## Root Cause

A fresh installation does not yet possess the Actor Identity seed contained in
the encrypted recovery archive. Normal profile activation must reject a newly
generated conflicting seed, but recovery incorrectly depended on that rejected
activation having already created an Engine. The Acceptance runtime owner made
the cycle stricter by waiting for post-recovery Moments readiness before
invoking recovery.

The remaining cycle crossed two runtime owners: Messaging had no typed
profile-level recovery readiness after the continuity rejection, while Moments
treated optional Secure Content startup as a prerequisite for its public
projection and actor scope.

## Mitigation

- The recovery command serializes under the Desktop identity-transition lock,
  while the Engine registry serializes normal profile activation against
  recovery installation.
- It fetches and decrypts the archive under the authenticated session.
- When no profile Engine exists, recovery reconciles authority redactions
  through the Station client, resolves the installation DSK from the live store
  or its platform-secure backup, and verifies Station enrollment before atomic
  replacement. Only an installation without registered signing material may
  generate a new DSK. An enrolled device missing its DSK fails before replacing
  data; absence of an Engine never authorizes signing-key rotation.
- Existing-profile recovery retains its continuity-preserving path.
- Auth records a typed, actor-bound `RecoveryRequired` profile readiness when
  Actor Identity continuity rejects normal activation. Successful activation,
  recovery, or deactivation clears that state.
- An authenticated private Moment read may project `RECOVERY_REQUIRED` from
  that typed state before a Messaging Engine or Secure Content lease exists.
  No plaintext, content metadata, or untyped error-string parsing participates
  in this path.
- The Moments runtime keeps its public projection and actor scope alive while
  private bootstrap is unavailable, then retries private bootstrap during
  reconciliation.
- Recovery export includes only conversations backed by a verified local
  authority head. A Station-hydrated, headless projection is reconstructible
  authority data, not recoverable local history, and must not invalidate the
  whole encrypted archive.
- Replacement clients start to an authenticated session, perform recovery and
  enrollment, and only then require Moments readiness.
- Chat's password-login Harness returns the canonical Actor PTID from the
  authenticated Session. It must not install Chat runtimes or initialize Social
  encryption as part of authentication; a replacement device's Engine may only
  become available after recovery. Explicit `hydrateActiveActor` remains the
  post-recovery Chat readiness operation and propagates Engine failures.
- Recovery status and revision reads use the authenticated Session before an
  Engine exists. Typed Registry readiness validates Actor binding; missing
  local identity stays null. The UI exposes Restore only for an actual backup,
  while phrase generation and backup creation require the real local identity.
- The Recovery runtime bootstraps before Messaging, resets on accepted Session
  and Station edges and periodically reconciles. Its store fences every
  asynchronous completion and failure by Actor, Session epoch and reset
  generation, and invalidates older status reads after create/restore.
  Actor-keyed UI lifetime clears recovery phrase drafts.
- Native restore returns the committed Actor/Profile/Home Station/Endpoint
  binding under the identity-transition lock. Recovery publishes typed
  `messaging.profile_activated` before fetching backup status. Messaging
  validates the Session epoch and native scope readback, invalidates old scope
  immediately and owns the new bootstrap. Missing pre-recovery Engine must
  not remove its periodic retry. Queued work cannot survive teardown or a new
  same-Actor Session. Recovery status, authentication events and committed
  inbox invalidations are distinct; none may fabricate another owner's event.

## How To Detect A Recurrence

```bash
pnpm --dir apps/desktop exec vitest run \
  src/acceptance/chat/harness.test.ts \
  src/acceptance/chat/passwordLogin.test.ts \
  src/store/messagingRecovery.test.ts \
  src/messaging/runtime.test.ts \
  src/runtimes/messagingRecoveryRuntime.test.ts
```

The native replacement-device Journey must authenticate with empty identity,
show the real backup, operate the visible Restore control, recover, refresh
identity and then reach Chat readiness. A direct restore command cannot prove
the visible entry is usable.
Native restoration must populate the existing group projection and continue
encrypted receiving on the replacement endpoint without Gate-installed Chat
bootstrap. Unit checks must cover same-Actor Session replacement, activation
binding mismatch, lost activation wake and teardown of queued refreshes.

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  fresh_profile_restore_installs_recovered_actor_with_new_device
```

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  recovery_required_readiness_is_cleared_by_activation_and_deactivation
```

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  recovery_export_waits_for_authority_head_before_including_hydrated_projection
```

```bash
pnpm --dir apps/desktop exec vitest run \
  src/runtimes/momentsRuntime.test.ts \
  -t "keeps public projection active while private bootstrap retries"
```

```bash
python3 -m unittest \
  tooling.development.secure_content.test_runtime_owner.RuntimeOwnerTest.test_start_authenticated_client_does_not_require_moments_readiness
```

AS23 must reach `RECOVERY_REQUIRED -> CONTENT_READY` on a replacement client
whose storage and Actor Identity root start empty. Preloading the recovered
Actor seed into that client is not equivalent proof.

## Crosswalks

- `MP-D08` requires fresh-device recovery without copying live crypto state.
- `MP-W08` requires fresh Actor Identity recovery, fresh enrollment, and
  continued encrypted messaging.
