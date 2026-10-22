---
kind: pitfall
title: Mobile enrollment must use the current profile revision
status: active
owns:
  - apps/mobile/src-tauri/src/messaging/
referenced-by: []
related:
  - docs/architecture/domains/chat/messaging/decisions.md
  - docs/architecture/domains/chat/messaging/data-model.md
  - docs/knowledge/invariants/mobile-session-device-identity.md
detected: 2026-10-17
---

# Mobile enrollment must use the current profile revision

## Symptom

Mobile Messaging activation succeeded for an Actor whose profile revision was
`1`, then failed for an Actor whose current profile revision was `8`:

```text
ACTOR_IDENTITY_STALE_PROFILE_VERSION
```

The second Actor had a valid Session, PTID, device ID, and fresh local
Simulator storage. Station correctly rejected its device certificate because
the certificate still declared observed profile version `1`.

## Root cause

Mobile generated every fresh Actor Device certificate with
`INITIAL_ACTOR_IDENTITY_PROFILE_VERSION`, regardless of the authenticated
Actor's current `/actor/profile.profile_revision`. Desktop already resolved and
validated the canonical profile revision before enrollment; Mobile had a
parallel, weaker activation path.

## Mitigation

### What was done in code

- Mobile Messaging reads `/actor/profile` through its authenticated,
  device-bound Station transport before activation.
- The profile PTID must match the authenticated Session and the revision must
  be positive.
- Fresh device certificates use that canonical revision.
- Existing local certificates advance monotonically to the current revision
  while preserving the Actor identity key, device ID, and device signing key.
- Station's stale/future profile-version checks remain strict.

### What guards against regression

Focused Mobile Rust tests require the authenticated Actor binding and prove
that reopening a local profile advances its device certificate from revision
`1` to revision `8` without replacing device identity. The
`station-access-scope-isolation-e2e` Gate exercises the same path with two
Actors whose real profile revisions differ.

## How to detect a recurrence

```bash
rg -n 'INITIAL_ACTOR_IDENTITY_PROFILE_VERSION' \
  apps/mobile/src-tauri/src/messaging
```

The search must return no matches.

```bash
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  messaging::transport::tests::actor_profile_revision_requires_the_authenticated_actor \
  -- --exact

cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  messaging::engine::tests::reopening_profile_refreshes_the_device_certificate_revision \
  -- --exact
```

Then run `station-access-scope-isolation-e2e` against fixture Actors with
different current profile revisions. Both Mobile runtimes must become ready.

## Crosswalks

- `MP-D15` in `docs/architecture/domains/chat/messaging/decisions.md`
- `docs/knowledge/invariants/mobile-session-device-identity.md`
