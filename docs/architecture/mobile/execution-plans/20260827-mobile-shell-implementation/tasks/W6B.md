# W6B - Moments Product Closure

## Task Slice

```json
{
    "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "W6B",
  "workstreamId": "W6B",
  "title": "Moments source closure",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "W6B-source",
  "journeyId": "MS-J05-source",
  "runtimeClass": "source-only",
  "writeSet": ["model/domain/social", "apps/station/frame/touch/model", "apps/station/app/subserver/social", "apps/desktop/src/gen/proto/domain/social", "apps/mobile/src/gen/proto/domain/social", "apps/mobile/src-tauri/src/commands", "apps/mobile/src-tauri/src/platform", "apps/mobile/src-tauri/src/runtime", "apps/mobile/src/features/social", "apps/mobile/src/services/gateways", "apps/mobile/src/services/mobileCommands.ts", "apps/mobile/src/pages/MomentsPage.tsx", "apps/mobile/src/pages/moments", "packages/client-media-security", "tooling/acceptance/gates/mobile"],
  "readSet": ["docs/architecture/mobile", "docs/architecture/secure-content", "docs/architecture/social-runtime", "docs/client/mobile"],
  "budgets": {"focusedCheckSeconds": 600, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {"id": "moments-model", "command": "make model-lint", "verificationClass": "SOURCE_CHECK"},
    {"id": "moments-owner", "command": "go test ./apps/station/app/subserver/social/...", "verificationClass": "SOURCE_CHECK"},
    {"id": "moments-source", "command": "pnpm --dir apps/mobile run check", "verificationClass": "SOURCE_CHECK"},
    {"id": "moments-native-media", "command": "cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml --lib", "verificationClass": "SOURCE_CHECK"},
    {"id": "moments-focused", "command": "pnpm --dir apps/mobile exec vitest run src/services/gateways/momentsGateway.test.ts src/services/gateways/momentMediaGateway.test.ts src/services/mobileCommands.test.ts src/features/social/momentsFeedStore.test.ts src/pages/MomentsPage.test.ts src/pages/moments/MomentCommentsSection.test.tsx src/pages/moments/MomentComposer.test.ts src/pages/moments/MomentFeedItem.test.ts", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": ["Feed/detail/comment/reaction source converges under one bounded runtime", "Feed empty, filtered empty, detail hidden, deleted, and unavailable remain distinct owner-authored outcomes", "Rust stages picker handles, verifies bytes, encrypts and uploads media, and returns canonical descriptors", "Late, duplicate, cancelled, expired, and permission-required picker callbacks are generation-fenced"],
  "failureBehavior": ["Do not replace pagination during targeted readback", "Do not derive policy truth in Mobile", "Do not pass Web paths or raw native handles into business APIs", "Native receiver proof remains in W6B-PROOF"],
  "updatedAt": "2026-09-19T11:20:00Z",
  "durableEvidence": [
    {"verificationClass": "SOURCE_CHECK", "result": "PASS", "ref": "Development Session MOBILE-W6B-CLOSURE / mobile-w6b-source-20260919 / w6b-ms-d21-source-checks-v2"}
  ]
}
```

## Objective

Complete bounded, authoritative Moments source behavior across feed and detail projections.

## Current Snapshot

- Existing wire, state, render, feed recovery, and draft UX closures remain
  complete.
- `MS-D25` is accepted and integrates the implemented Social-authored
  feed/detail outcomes with the Rust-owned picker staging, encryption, upload,
  promotion, and cleanup lifecycle.
- The approval records the existing W6B source closure; it does not reopen the
  completed source Task or promote optional physical diagnostics.
- Required simulator multi-actor proof belongs to W6B-PROOF.
