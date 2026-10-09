# MPS-07-REACTION-CONVERGENCE - Reaction And Remote Convergence

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-07-REACTION-CONVERGENCE",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Converge public and private reactions and remote interaction unknown outcomes without duplication",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "mps-reaction-convergence",
  "journeyId": "MSP-J05-J07-J08",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social",
    "apps/mobile/src/pages/moments",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "apps/mobile/src-tauri/src/social",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/domains/social/cross-station",
    "docs/architecture/platform/client/mobile/social-parity",
    "docs/architecture/shared/federation",
    "model/domain/social"
  ],
  "budgets": {
    "focusedCheckSeconds": 2100,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 240
  },
  "checks": [
    {
      "id": "mps-reaction-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/features/social src/pages/moments/MomentFeedItem.test.ts src/runtimes/privateMomentsRuntime.test.ts && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Five canonical reactions and unreact work for public and private local and remote Moments",
    "Pending, retrying, rejected and unknown-outcome states remain visible and owner-specific",
    "Lost responses trigger authoritative command or resource readback before replay",
    "Duplicate commands and Federation frames change no projection after the first valid commit",
    "Delete, friend loss, block and unblock invalidate interaction state in source ordering"
  ],
  "failureBehavior": [
    "Do not optimistic-commit an unverified private reaction as final",
    "Do not blind-retry may-commit interaction commands",
    "Do not add a Social-specific cross-Station transport or client-to-remote-Station call"
  ],
  "updatedAt": "2026-10-06T10:11:00.000Z"
}
```

## Objective

把 private Reaction 缺口和 remote interaction failure semantics 一起关闭，使 Mobile
在失响应、重放和撤销条件下与 source Social 收敛。

## Current Snapshot

- Public reaction rollback exists in Mobile.
- Private Social has publish/read/media/comment/recovery but no complete reaction path.
- Remote interaction unknown outcomes are not uniformly projected or reconciled.
