# DSR-04: Atomic App-Scoped Runtime Cut

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DESKTOP-STATION-RUNTIME-20261012",
  "taskId": "DSR-04",
  "workstreamId": "DSR-RUNTIME-CUT",
  "title": "Replace the sole proxy adapter with one AppState-owned Direct/Circuit runtime",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dsr-runtime-cut",
  "journeyId": "DSR-G01",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/bootstrap.rs",
    "apps/desktop/src-tauri/src/state",
    "apps/desktop/src-tauri/src/application/station_binding",
    "apps/desktop/src-tauri/src/application/station_runtime",
    "apps/desktop/src-tauri/src/infrastructure/station",
    "apps/desktop/src-tauri/src/infrastructure/station_client.rs",
    "apps/desktop/src-tauri/src/infrastructure/station_discovery.rs",
    "apps/desktop/src-tauri/src/infrastructure/station_registry.rs",
    "apps/desktop/src-tauri/src/infrastructure/station_transport.rs",
    "packages/station-libp2p-http",
    "tooling/acceptance/gates/station_access",
    "tooling/scripts/node-connectivity-journey.py",
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/platform/station/access",
    "docs/client/desktop/lifecycle.md"
  ],
  "readSet": [
    "apps/station/frame/core/plugin/native/transport/securehttp",
    "apps/station/frame/core/plugin/native/relay"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "desktop-runtime-source",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --lib",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "old-runtime-removal",
      "command": "sh -c '! rg -n \"STATION_PROXY|P2P_TRANSPORT|active_transport_origin|serve_proxy_connection|station_base_url\\\\(\" apps/desktop/src-tauri/src'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "desktop-runtime-functional",
      "command": "python3 tooling/scripts/node-connectivity-journey.py --closure dsr-runtime-cut --functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "desktop-runtime-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate DSR-G01",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "application/station_runtime is the composition/lifecycle owner; infrastructure/station contains only persistence, identity, resource and Direct/Circuit adapters.",
    "Tauri AppState owns one StationRuntime; setup starts it and ExitRequested stops admission, drains boundedly, closes sessions and joins the owner.",
    "Station Access alone publishes RouteLease and mutates active binding; transport executes leases without registry writes.",
    "The single injected adapter switches atomically from current proxy to Direct/Circuit and STATION_PROXY, P2P_TRANSPORT, global registry/binding, active_transport_origin, localhost origin and raw HTTP1 proxy framing are deleted."
  ],
  "failureBehavior": [
    "No process-global Weak/OnceLock runtime bridge, compatibility flag, fallback data plane or infrastructure-to-application import.",
    "No partial DSR-04 source is releasable; rollback is source/deployment revert.",
    "Station or route replacement cannot commit stale callback or resource projection results."
  ],
  "updatedAt": "2026-10-13T00:00:00.000Z"
}
```

## Current Snapshot

DSR-02 and DSR-03 have already moved consumers behind stable request, stream and
resource ports while retaining one current adapter. This task changes only that
single implementation and removes the old lifecycle owner.

## Verification Contract

The functional run launches the real native Desktop, completes discovery and
Access Gate through Direct and Circuit routes, reads a Station resource, changes
route, then quits. Source checks prove old globals, proxy framing and forbidden
dependency directions have zero live production references.
