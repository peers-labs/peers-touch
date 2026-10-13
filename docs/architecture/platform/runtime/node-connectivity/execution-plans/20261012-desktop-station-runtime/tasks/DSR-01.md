# DSR-01: Owned Rust Transport Kernel

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DESKTOP-STATION-RUNTIME-20261012",
  "taskId": "DSR-01",
  "workstreamId": "DSR-TRANSPORT",
  "title": "Give the Rust libp2p transport one bounded owner and reusable route sessions",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dsr-transport-kernel",
  "journeyId": "DSR-G01",
  "runtimeClass": "service",
  "writeSet": [
    "packages/station-libp2p-http",
    "apps/desktop/src-tauri/src/infrastructure/station_transport.rs",
    "docs/architecture/platform/runtime/node-connectivity"
  ],
  "readSet": [
    "apps/station/frame/core/plugin/native/transport/securehttp",
    "apps/station/frame/core/plugin/server/hertz"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "rust-transport",
      "command": "cargo test --manifest-path packages/station-libp2p-http/Cargo.toml --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "go-rust-interop",
      "command": "cargo test --manifest-path packages/station-libp2p-http/Cargo.toml --test go_interop --locked -- --nocapture",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "The package exposes one non-clone lifecycle owner and cloneable request handle with explicit idempotent shutdown and joined driver termination.",
    "Command admission and per-route/per-traffic-class HTTP2 session counts are finite; cancellation closes request work without abandoning the driver.",
    "Direct interop, Circuit TLS/SPKI, SSE, cancellation and 32 MiB streaming remain functional without another production protocol."
  ],
  "failureBehavior": [
    "Do not register a second Desktop production data plane.",
    "Do not move Station binding mutation, Session state or business retry policy into the package.",
    "No infinite queue, detached driver thread or process-exit-only cleanup."
  ],
  "updatedAt": "2026-10-12T15:54:38.000Z"
}
```

## Current Snapshot

The package starts a detached Tokio runtime, uses an unbounded command channel
and performs stream/TLS/HTTP2 setup inside each request. Desktop stores only a
cloneable handle in a process global and cannot join the driver.

## Verification Contract

Interop uses the existing real Go securehttp fixture. Tests observe driver
start/stop, bounded admission, connection/session reuse and cancellation. This
closure proves the reusable transport kernel only; it does not claim the
Desktop lifecycle cut or product readiness.
