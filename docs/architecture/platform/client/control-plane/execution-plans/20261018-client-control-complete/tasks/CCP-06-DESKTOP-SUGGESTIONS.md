# CCP-06-DESKTOP-SUGGESTIONS - Desktop Kernel Projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-06-DESKTOP-SUGGESTIONS",
  "workstreamId": "CCP-CLIENTS",
  "title": "Integrate verified snapshot cache and unverified suggestions into Desktop without mutating the Station registry",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "ccp-desktop-suggestions",
  "journeyId": "CCP-J06-CCP-J07-DESKTOP",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop",
    "packages/locales",
    "tooling/acceptance",
    "docs/architecture/platform/client/control-plane",
    "docs/architecture/platform/station/access"
  ],
  "readSet": [
    "packages/client-control-core",
    "model/domain/client_control",
    "model/domain/peer"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 60,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "ccp-desktop-source",
      "command": "pnpm --dir apps/desktop run check && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml client_control station_registry station_binding --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-desktop-projection-review",
      "command": "pnpm --dir apps/desktop exec vitest run src/components/common/StationPicker.test.tsx src/services/clientControl.test.ts",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "Desktop loads embedded and last-known-good signed data before a bounded background refresh",
    "Secure storage protects the accepted sequence, digest, and key watermark against ordinary cache rollback",
    "Station Picker renders verified Stations and cloud suggestions as distinct typed states",
    "Selecting a suggestion passes its connection material into canonical signed Station discovery and commits only a verified route",
    "Catalog removal, fetch failure, invalid signature, expiry, or identity mismatch cannot alter active Station, registry, Session, lifecycle generation, or user-owned routes",
    "Matching release descriptors are projected to the updater boundary without initiating installation"
  ],
  "failureBehavior": [
    "Do not fetch or verify snapshots inside React components",
    "Do not persist an unverified suggestion as a Station entry or auto-select catalog order",
    "Do not claim installed Desktop rendering or interaction Acceptance from this source closure"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Complete the Desktop implementation contract while preserving the explicit
API-only initial evidence boundary.

## Current Snapshot

- Desktop persists identity-verified Station entries and supports one
  environment discovery seed.
- Station Picker has no remote suggestion projection.
- No Client Control cache, watermark, refresh owner, or release projection
  exists.
