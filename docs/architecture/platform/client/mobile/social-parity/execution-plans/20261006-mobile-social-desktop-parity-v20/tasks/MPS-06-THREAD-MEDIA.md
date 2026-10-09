# MPS-06-THREAD-MEDIA - Inline Thread And Media Overlay

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-06-THREAD-MEDIA",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Keep ordinary Moment comments and replies inline and open verified media in a temporary overlay",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "mps-thread-media",
  "journeyId": "MSP-J05-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/MomentsPage.tsx",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "apps/mobile/src-tauri/src/social",
    "docs/client/common/ui-identity/frontend-component-tree-registry.md",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop",
    "docs/architecture/domains/social/core",
    "docs/architecture/platform/client/mobile/social-parity",
    "docs/architecture/shared/security/secure-content"
  ],
  "budgets": {
    "focusedCheckSeconds": 2100,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mps-thread-media-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/pages/moments/MomentCommentsSection.test.tsx src/pages/moments/MomentImage.test.tsx src/pages/moments/MomentFeedItem.test.ts src/pages/MomentsPage.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "mps-thread-media-ux",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate mobile-social-thread-media-native",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "mps-detail-old-path-removal",
      "command": "if rg -n 'if \\(activePostId\\)|mobile-detail-page' apps/mobile/src/pages/MomentsPage.tsx; then exit 1; else test $? -eq 1; fi",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Only one Feed thread is expanded and one comment composer is mounted at a time",
    "The first 10 public or private comments show by default and overflow folds without losing cursor or anchor",
    "Reply, delete and pagination use canonical interaction identities and survive reload",
    "Image and video use a temporary verified overlay with no route mutation and restore exact Feed position",
    "Direct links use exception Detail only when the Feed cannot safely carry the requested state"
  ],
  "failureBehavior": [
    "Do not navigate ordinary Moment reading or commenting to a Detail page",
    "Do not expose opaque private object URLs to unverified Web fetches",
    "Do not mount one composer or unbounded comment tree for every feed item"
  ],
  "updatedAt": "2026-10-06T10:11:00.000Z"
}
```

## Objective

实现 Owner 已确认的 Feed-first 交互，复用同一 public/private interaction contract，
并保持 feed anchor、资源生命周期和渲染预算。

## Current Snapshot

- Existing comments and image components are public-oriented.
- Private comment/media commands exist below the unified product projection.
- Normal Moment interaction does not yet enforce one inline thread and temporary overlay semantics.
