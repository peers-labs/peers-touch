# DSR-02: Injected Unary Station Client

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DESKTOP-STATION-RUNTIME-20261012",
  "taskId": "DSR-02",
  "workstreamId": "DSR-CLIENT-INJECTION",
  "title": "Move unary JSON and protobuf consumers behind one injected Station client port",
  "workClass": "refactor",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "dsr-client-injection",
  "journeyId": "DSR-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop/src-tauri/src/application",
    "apps/desktop/src-tauri/src/infrastructure",
    "apps/desktop/src-tauri/src/interface",
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/platform/station/access",
    "docs/client/desktop/lifecycle.md"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/contracts.rs",
    "tooling/acceptance/gates/station_access"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "desktop-rust",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-check",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "client-injection-inventory",
      "command": "sh -c '! rg -n \"station_client::(request|post|upload|probe)|use crate::infrastructure::station_client\" apps/desktop/src-tauri/src/application apps/desktop/src-tauri/src/interface'",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Application and interface unary JSON/protobuf callers receive one StationRequestExecutor/StationClient port instead of reading process globals.",
    "The current local-proxy transport remains the only production adapter; no Direct/Circuit replacement is registered in this closure.",
    "Request deadlines, auth/device headers and replay intent are represented by the injected contract and existing unary behavior remains covered."
  ],
  "failureBehavior": [
    "Do not introduce a global runtime bridge or a second transport implementation.",
    "Do not migrate streaming/resource consumers in this closure.",
    "The temporary current adapter has one removal owner and is deleted by DSR-04."
  ],
  "updatedAt": "2026-10-12T15:54:38.000Z"
}
```

## Current Snapshot

Most application and Tauri interface modules consume free `station_client`
request helpers. They can be moved to a stable injected port without changing
the sole active proxy/data-plane implementation.

## Verification Contract

Focused tests cover unary request encoding, auth/device headers, typed errors
and timeouts. This closure proves consumer injection only and makes no transport
or product Journey claim.
