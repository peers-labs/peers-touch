# CCP-07-MOBILE-SUGGESTIONS - Mobile Kernel Projection

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-07-MOBILE-SUGGESTIONS",
  "workstreamId": "CCP-CLIENTS",
  "title": "Integrate verified snapshot cache and unverified suggestions into Mobile without mutating verified Station state",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "ccp-mobile-suggestions",
  "journeyId": "CCP-J06-CCP-J07-MOBILE",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile",
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
      "id": "ccp-mobile-source",
      "command": "pnpm --dir apps/mobile run check && pnpm --dir apps/mobile exec vitest run src/features/station && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml client_control station_route --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-mobile-projection-review",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/station/StationSelector.test.tsx src/features/station/clientControl.test.ts",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "Mobile uses the shared Rust verification policy with platform HTTP and secure-storage adapters",
    "Local launch and verified Station selection remain available while refresh is unavailable, rejected, or stale",
    "Station Selector distinguishes suggestions, stale material, discovery, trust confirmation, invalid identity, and verified Stations",
    "Selecting a suggestion invokes the existing Rust Station route owner and commits only after identity, route, and trust verification",
    "Cloud changes cannot alter activeStationPeerId, route revision, lifecycle generation, Session, or locally hidden/verified state",
    "Matching release descriptors are typed, target-filtered, and non-executable"
  ],
  "failureBehavior": [
    "Do not implement signature or rollback policy independently in TypeScript",
    "Do not make a Relay origin or catalog seed the Station identity",
    "Do not claim iOS, Android, Simulator, or physical-device UI Acceptance from this source closure"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Complete the Mobile implementation contract with the same trust policy and
claim boundary as Desktop.

## Current Snapshot

- Mobile persists only verified Station entries keyed by Station PeerID.
- Station Selector has no remote suggestion source or signed cache.
- Mobile has no Client Control lifecycle or release projection.
