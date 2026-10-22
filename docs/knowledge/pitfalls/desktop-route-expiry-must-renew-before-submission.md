---
kind: pitfall
title: Desktop route expiry requires pre-submission renewal
status: active
owns:
  - apps/desktop/src-tauri/src/application/station_runtime/
  - apps/desktop/src-tauri/src/application/station_binding/
related:
  - ../../architecture/platform/station/access/design.md
  - ../../architecture/platform/runtime/node-connectivity/design.md
detected: 2026-10-18
---

# Desktop route expiry requires pre-submission renewal

## Symptom

The Native Group lifecycle journey completed role, owner, leave, dissolve and
restart/history operations. A later Direct seed remained locally queued with
authority sequence zero; the receiver never observed it. Desktop logged
`The active Station route is unavailable or expired`.

## Root cause

Station route attestations have a maximum lifetime of five minutes. Desktop
committed discovery refreshes correctly, but only manual Station add/probe
performed discovery. Once the committed route expired, Binding refused to
issue a lease. Request failover required an existing lease and therefore could
not repair this pre-submission failure.

## Mitigation

### What was done in code

StationRuntime prepares requests by renewing the selected route within 15
seconds of expiry, including after expiry. It reuses signed endpoint discovery
and the same Binding commit path as manual probe. The transition lock, pinned
identity, monotonic epoch/generation, lifecycle and cancellation prevent
renewal from replacing a Station or reviving stale work. Private Relay renewal
retains its existing connection grant.

The old lease is cancelled after commit; Session scope remains unchanged.
Pre-submission renewal applies to `ReplayPolicy::Never` without permitting
replay of a submitted command. Discovery failure remains a typed no-route
error and does not alter the binding.

### What guards against regression

StationRuntime checks cover near-expiry and expired proofs, warm proof reuse,
identity/route/node/epoch changes, cancellation and stale lifecycle. Native
Group lifecycle remains the receiver-visible regression journey across the
five-minute boundary.

## How to detect a recurrence

```bash
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml \
  application::station_runtime::tests -- --test-threads=1
```

Run `chat-lifecycle-interactions-group-e2e` with `desktop-macos-native` against
current-source Stations. The post-lifecycle revoke seed must be visible on the
receiver before device revocation; sender-local queued state is insufficient.

## Crosswalks

- Station Access design §5.1 owns Binding composition and renewal semantics.
- Node Connectivity owns route signature, attestation lifetime and grants.
