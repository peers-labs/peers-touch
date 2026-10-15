---
kind: invariant
title: Desktop Actor identity scope migration preserves continuity
status: active
owns:
  - apps/desktop/src-tauri/src/application/auth/
  - apps/desktop/src-tauri/src/domain/crypto/
  - apps/desktop/src-tauri/src/infrastructure/local_scope.rs
  - apps/desktop/src-tauri/src/messaging/
referenced-by: []
related:
  - docs/architecture/domains/chat/messaging/decisions.md
  - docs/architecture/domains/chat/messaging/data-model.md
  - docs/knowledge/invariants/actor-identity-boundary.md
detected: 2026-10-14
---

# Desktop Actor identity scope migration preserves continuity

## What must hold

Changing the Desktop Actor identity key reference MUST migrate the existing seed
before any new seed is generated. If canonical and legacy candidates disagree,
the Station Actor Identity fingerprint MUST select the only legal seed; without
that trust anchor the migration MUST fail closed. After selection, canonical
scope is the sole read path.

Legacy candidate discovery MUST include the verified Station PeerID scope and
every known route-origin scope for that same logical Station. Selecting only the
currently active route misses installations created before signed Station
identity or while another Direct/Relay route was active.

The Messaging Store MUST re-sign the existing device certificate with that
Actor seed while preserving `device_id`, device-signing seed/public key, and
signing-key ID. The profile revision may advance but must not regress, and a
rebound certificate must return to `awaiting_device_enrollment`.

## Why this is non-negotiable

Actor Identity pins one long-lived public key per PTID. Generating a new seed
after a local scope rename creates a valid local certificate that the Station
must reject with `ACTOR_IDENTITY_CONTINUITY_CONFLICT`.

Migrating only the seed is also insufficient. A previously opened Messaging
Store can retain a certificate signed by the discarded seed. Rotating its
device ID or device-signing key would abandon local device continuity, while
accepting the stale certificate would reproduce the Station conflict.

## How to verify

- `cargo test --bin peers-touch-desktop identity_scope_migration --no-default-features`
  from `apps/desktop/src-tauri` must pass.
- `cargo test --bin peers-touch-desktop legacy_identity_scope --no-default-features`
  from `apps/desktop/src-tauri` must prove PeerID and all known route-origin
  candidates are included without duplicates.
- `cargo test --bin peers-touch-desktop actor_identity_scope_rebind_preserves_device_and_signing_key --no-default-features`
  from `apps/desktop/src-tauri` must pass.
- `cargo test --bin peers-touch-desktop profile_engine_owns_stable_cross_signed_endpoint_identity --no-default-features`
  from `apps/desktop/src-tauri` must pass.
- NCP-G03 must authenticate the retained Actor, enroll its existing local
  endpoint under Station continuity, and complete the Native product Journey.

## Crosswalks

- `MP-D15` defines Actor-cross-signed device enrollment.
- `actor-identity-boundary.md` defines PTID and Actor Identity ownership.
