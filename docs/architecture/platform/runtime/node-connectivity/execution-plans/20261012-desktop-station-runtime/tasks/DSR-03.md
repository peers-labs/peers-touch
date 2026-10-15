# DSR-03: Typed Streaming And Resource Projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DESKTOP-STATION-RUNTIME-20261012",
  "taskId": "DSR-03",
  "workstreamId": "DSR-RESOURCE-INJECTION",
  "title": "Move streams and Station-owned resources behind typed transport-independent ports",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "dsr-resource-injection",
  "journeyId": "DSR-G03",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src-tauri/src/application/agent_event_stream.rs",
    "apps/desktop/src-tauri/src/application/agent_turn",
    "apps/desktop/src-tauri/src/application/applet_store.rs",
    "apps/desktop/src-tauri/src/application/applets",
    "apps/desktop/src-tauri/src/application/oss",
    "apps/desktop/src-tauri/src/application/profile",
    "apps/desktop/src-tauri/src/infrastructure/avatar_cache",
    "apps/desktop/src-tauri/src/infrastructure/event_stream",
    "apps/desktop/src-tauri/src/infrastructure/oss_cache",
    "apps/desktop/src-tauri/src/interface/http_gateway",
    "apps/desktop/src-tauri/src/messaging/attachment_transfer.rs",
    "apps/desktop/src-tauri/src/social",
    "tooling/acceptance/gates/station_access",
    "tooling/acceptance/features",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/acceptance/capabilities/station-access.yaml",
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/platform/station/access"
  ],
  "readSet": [
    "apps/desktop/src-tauri/src/infrastructure/station_client.rs",
    "apps/desktop/src-tauri/src/infrastructure/station_transport.rs"
  ],
  "budgets": {
    "focusedCheckSeconds": 420,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "desktop-resource-source",
      "command": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --lib",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "resource-origin-removal",
      "command": "sh -c '! rg -n \"station_base_url\\\\(\" apps/desktop/src-tauri/src/application/agent_event_stream.rs apps/desktop/src-tauri/src/application/agent_turn apps/desktop/src-tauri/src/application/applet_store.rs apps/desktop/src-tauri/src/application/applets apps/desktop/src-tauri/src/application/oss apps/desktop/src-tauri/src/application/profile apps/desktop/src-tauri/src/infrastructure/avatar_cache apps/desktop/src-tauri/src/infrastructure/event_stream apps/desktop/src-tauri/src/infrastructure/oss_cache apps/desktop/src-tauri/src/interface/http_gateway apps/desktop/src-tauri/src/messaging/attachment_transfer.rs apps/desktop/src-tauri/src/social'",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "resource-functional",
      "command": "python3 tooling/scripts/node-connectivity-journey.py --closure dsr-resource-injection --functional",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "resource-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate DSR-G03",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "SSE/turn streams and attachment bodies use typed streaming ports with cancellation and bounded body flow while the current proxy remains the sole transport adapter.",
    "Avatar, OSS cache, profile media and applet bundle values use StationResourceRef rather than active route origin.",
    "Native loaders materialize through the Station client; WebView consumers receive only scope-checked app-local URIs.",
    "External absolute or presigned URLs remain ExternalResourceUrl and are never rewritten through Station transport."
  ],
  "failureBehavior": [
    "Do not expose active Direct/Relay/localhost origin as durable resource identity.",
    "Do not register the replacement Direct/Circuit adapter before DSR-04.",
    "A stale lifecycle generation cannot read or project a StationResourceRef."
  ],
  "updatedAt": "2026-10-13T00:00:00.000Z"
}
```

## Current Snapshot

Streaming and resource callers use `station_base_url()` directly. Some issue
requests, while avatar/OSS/profile/applet code also derives cache identity or
WebView-readable URLs from that transport origin.

## Verification Contract

The native functional Journey covers SSE, avatar materialization, OSS range
read, applet bundle loading and a 32 MiB attachment through the current sole
adapter. It proves the consumer contracts before the data-plane cut, preventing
resource behavior from being hidden inside DSR-04.
