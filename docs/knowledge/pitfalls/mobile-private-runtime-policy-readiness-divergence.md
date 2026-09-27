---
kind: pitfall
title: Mobile private runtimes must share policy and readiness
status: active
owns:
  - apps/mobile/src-tauri/src/secure_content/
  - apps/mobile/src-tauri/src/station_origin.rs
  - apps/mobile/src/runtimes/privateMomentsRuntime.ts
  - apps/mobile/src/runtimes/privateMomentsRuntime.test.ts
referenced-by:
  - docs/knowledge/README.md
related:
  - docs/client/mobile/lifecycle.md
  - docs/architecture/secure-content/decisions.md
detected: 2026-09-27
---

# Mobile private runtimes must share policy and readiness

## Symptom

The exact-source iOS Secure Content Journey reached an authenticated shell, and
the lifecycle snapshot reported every runtime as `ready`, but the first private
Moment publish failed with:

```text
mobile.privateSocial.runtimeInactive
```

A direct native diagnostic exposed the hidden activation error:

```text
private Social first-use trust requires HTTPS or loopback HTTP
```

## Root cause

Private Social implemented its own Station-origin policy instead of consuming
the shared Mobile policy. It therefore rejected the approved non-loopback HTTP
development origin that Messaging and Station identity already admitted.
Its session-transition queue also caught activation failures internally rather
than publishing them through the lifecycle readiness owner, so the graph
reported `private-social` as ready while its business scope was inactive.

## Mitigation

### What was done in code

- Private Social transport now consumes the shared `StationOriginPolicy`:
  development builds admit canonical HTTP origins and release builds remain
  HTTPS-only.
- Private Social session transitions now use the generation-bound lifecycle
  readiness helper, wait for declared dependencies, and propagate current-scope
  activation failures.
- Focused Rust and TypeScript regressions cover both policy modes and failed
  activation readiness.

### What guards against regression

- `private_social_uses_the_shared_station_origin_policy` verifies development
  HTTP admission and release HTTP rejection.
- `publishes activation failure through lifecycle readiness` verifies that a
  failed native activation cannot resolve bootstrap as ready.

## How to detect a recurrence

Run:

```bash
cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml \
  private_social_uses_the_shared_station_origin_policy
pnpm --dir apps/mobile exec vitest run \
  src/runtimes/privateMomentsRuntime.test.ts
```

Then inspect Mobile Station-origin validation and session transition owners:

```bash
rg -n "StationOriginPolicy|runRuntimeSessionTransition" \
  apps/mobile/src-tauri/src/secure_content \
  apps/mobile/src/runtimes/privateMomentsRuntime.ts
```

Private Social must not add a parallel transport policy or swallow a
current-scope activation failure outside lifecycle readiness.

## Crosswalks

- `docs/client/mobile/lifecycle.md` defines debug/release Station-origin policy
  and generation-bound asynchronous runtime readiness.
- `SC-D22` requires W9 Mobile product proof to use the real production runtime
  path on the exact source.
