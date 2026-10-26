---
kind: pitfall
title: Mobile route renewal must precede expiry and coalesce
status: active
owns:
  - apps/mobile/src-tauri/src/runtime/station_route.rs
  - apps/mobile/src/runtimes/stationRuntime.ts
related:
  - ../../client/mobile/ios-host.md
  - ../../architecture/platform/station/access/design.md
detected: 2026-10-25
---

# Mobile route renewal must precede expiry and coalesce

## Symptom

A fixed-clock reproduction of the native owner skipped discovery with 30
seconds left on the proof, although the Web runtime schedules renewal 60
seconds before expiry. Two expired-route callers independently discovered
the same binding; one committed and the other returned `routeChanged`.

The Mobile Messaging Journey also reported a reset before Search scenarios.
That observation alone does not attribute the reset to these source defects.

## Root cause

The native renewal path tested only whether a proof had already expired and
performed concurrent discovery without single renewal ownership. Optimistic
commit correctly fenced selection changes but rejected another matching
renewal as if it were an unrelated selection.

## Mitigation

### What was done in code

The shared native owner renews within the existing 60-second timer window.
Renewal callers serialize and read the current proof after ownership is
acquired. The owner validates requested selection before discovery and checks
the exact active and cached candidates before commit. Removal, identity change,
revocation and stale selection remain failures. Failed discovery leaves the
old lifetime unchanged; submitted mutations are never replayed.

### What guards against regression

Native tests cover near-expiry renewal, one-discovery concurrent reuse, stale
selection, removed routes, failed discovery, pinned identity and monotonic
generation/epoch. The existing Mobile Station lifecycle Gate supplies the
receiver/runtime evidence across the signed lifetime; source tests alone do
not prove that Journey.

## How to detect a recurrence

```bash
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  --lib runtime::station_route::tests --locked
```

Use the canonical `mobile-simulator-station-lifecycle-e2e` Gate for its owning
runtime scope. Review both native and Web renewal windows together. Treat a
proxy `response_binding` failure separately from transport failure kind and
submission phase; neither diagnostic substitutes for receiver-visible proof.

## Crosswalks

- Mobile host behavior defines shared renewal and restore fences.
- Station Access defines pre-submission renewal and mutation replay policy.
