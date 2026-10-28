---
kind: invariant
title: X Config must not block local client startup
status: active
owns:
  - apps/desktop/src-tauri/src/application/x_config/
  - apps/desktop/src-tauri/src/state/
  - apps/desktop/src/runtimes/xConfigRuntime.ts
  - apps/desktop/src/services/xConfig.ts
related:
  - docs/architecture/platform/client/control-plane/design.md
  - docs/architecture/platform/client/control-plane/experience-contract.md
detected: 2026-10-26
---

# X Config must not block local client startup

X Config is an optional source of signed suggestions. Its constructor must not
read secure storage, snapshot files, or the network. Its refresh I/O must not
hold any lock used by projection or suggestion-material readers. Profile
discovery and verified Station access must remain usable when cloud
configuration or secure storage is unavailable.

An unknown or denied watermark must never be interpreted as an absent
watermark. macOS Keychain reads and writes must fail without authentication UI
for this optional lifecycle, with a policy scoped to the individual operation.
Do not disable authentication globally, skip protected items as if absent,
switch normal debug builds to file watermarks, or accept a snapshot before its
watermark commit.

Concurrent refresh requests must coalesce. A failed or unwinding worker must
leave the published view readable. Cached state must become visible before
network fetch, and stale suggestions must remain nonactionable even if no new
refresh completes.

## How to verify

Run the focused Desktop `application::x_config::` tests. They cover corrupt
and inaccessible watermark initialization, retry/backoff, blocked-worker
reads/coalescing, cached-state publication before fetch, expiry, rejected
remote candidates, rollback and worker unwind.

Run `make desktop` with the reviewed development Profile and task-owned
storage. Verify a real Native window and Profile Station access with cloud
configuration unavailable. Unit-test file watermark fixtures do not prove
normal Native Keychain behavior; report that observation separately.
