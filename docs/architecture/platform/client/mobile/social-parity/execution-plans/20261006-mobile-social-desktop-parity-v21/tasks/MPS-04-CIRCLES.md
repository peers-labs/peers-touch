# MPS-04-CIRCLES - Circle Lifecycle

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-04-CIRCLES",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Implement publisher-private Circle name, description, member and delete lifecycle",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "mps-circles",
  "journeyId": "MSP-J03",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/components/MobileShell.tsx",
    "apps/mobile/src/app/navigation",
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/MomentsPage.tsx",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/services/socialNativeAdapter.ts",
    "apps/mobile/src/services/socialNativeAdapter.test.ts",
    "apps/mobile/src/services/stationTransport.ts",
    "apps/mobile/src/services/stationTransport.test.ts",
    "apps/mobile/src/styles.css",
    "apps/mobile/src-tauri/src/runtime/station_transport",
    "apps/mobile/src-tauri/src/social",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station",
    "apps/mobile/src/gen/proto/domain/social/circle_pb.ts",
    "docs/architecture/domains/social/core",
    "docs/architecture/domains/social/cross-station",
    "docs/architecture/platform/client/mobile/social-parity",
    "model/domain/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 3000,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "mps-circles-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social src/pages/moments && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-circles-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-circles-native",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "Mobile creates and edits Circle name and description without changing composer Audience behavior",
    "A full-screen member picker resolves local and remote actors by canonical identity",
    "Add and remove show pending state and finish only after authoritative Circle revision readback",
    "Delete is isolated in a danger group, requires confirmation and invalidates stale Circle projections",
    "Remote resolution failure preserves the entire edit surface and commits no partial member mutation"
  ],
  "failureBehavior": [
    "Do not infer friendship from Circle membership",
    "Do not implement Circle truth or partial member updates in Mobile",
    "Do not activate the full Audience selector in this closure"
  ],
  "updatedAt": "2026-10-06T12:26:00.000Z"
}
```

## Objective

独立关闭 MSP-J03，使 Circle 成为可用的 Station-owned product surface，同时不提前
暴露尚未原子接通的 Audience publish 路径。

## Current Snapshot

- Mobile has no complete Circle list, editor, member picker or delete flow.
- Search/Profile primitives can supply canonical local and remote member identity.
- The existing composer remains unchanged until the next atomic Audience/publish closure.
