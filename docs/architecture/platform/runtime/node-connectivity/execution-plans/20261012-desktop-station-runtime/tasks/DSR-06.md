# DSR-06: Native Product And Removal Proof

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DESKTOP-STATION-RUNTIME-20261012",
  "taskId": "DSR-06",
  "workstreamId": "DSR-PROOF",
  "title": "Prove final native behavior, resource projection and complete removal",
  "workClass": "refactor",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "dsr-final-proof",
  "journeyId": "NCP-G03",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/acceptance",
    "tooling/scripts/node-connectivity-journey.py",
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/platform/station/access",
    "docs/client/desktop/lifecycle.md"
  ],
  "readSet": [
    "apps/desktop/src-tauri",
    "packages/station-libp2p-http",
    "apps/station/frame"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "architecture-source",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "desktop-final-source",
      "command": "cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "native-final-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate DSR-G01 --gate DSR-G02 --gate DSR-G03 --gate NCP-G03 --gate NCP-G07 --gate NCP-G08",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Two real native Desktop actors exchange text, delivered/read receipts and a 32 MiB attachment through Circuit; receiver render/decrypt and authoritative readback agree.",
    "SSE, avatar/OSS/applet resource projection, scoped identity, route renewal/revocation, overload, ambiguous mutation and shutdown cleanup pass on final exact source.",
    "Tree-wide removal checks find no live transport globals, localhost Station proxy, raw HTTP1 proxy parser, active_transport_origin, side-effecting station_base_url or route-origin resource identity.",
    "Architecture, Station Access and Desktop lifecycle documents describe the single current owner and module governance validates."
  ],
  "failureBehavior": [
    "Source/build checks cannot substitute for native receiver and WebView resource proof.",
    "Do not claim Mobile runtime, latency superiority, Station cluster behavior or external deployment completion.",
    "No commit, push, pull request, profile creation or destructive reset without explicit owner authorization."
  ],
  "updatedAt": "2026-10-13T00:00:00.000Z"
}
```

## Current Snapshot

NCP-G03, NCP-G07 and NCP-G08 already exercise the standard Circuit product path.
This aggregate adds app-owned runtime, resource projection, scoped identity and
typed failure evidence on the final source.

## Verification Contract

The final Suite records source/artifact identity, endpoint-scoped PeerIDs,
active Station/route generation, resource projection outcomes, owner resource
counts and receiver-visible behavior. Cleanup receipts are mandatory. Any source
change after a Gate result invalidates the affected proof.
