# MPS-08C-LIFECYCLE - Background Restart And Scope Isolation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "MPS-20261006",
  "taskId": "MPS-08C-LIFECYCLE",
  "workstreamId": "MPS-MOBILE-SOCIAL",
  "title": "Preserve legal Social state across background and restart while purging old Station or account scope",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "mps-lifecycle",
  "journeyId": "MSP-J09",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/mobile/src/features/social",
    "apps/mobile/src/runtimes",
    "apps/mobile/src/services",
    "apps/mobile/src-tauri/src/social",
    "packages/locales",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/station",
    "docs/architecture/domains/social/core",
    "docs/architecture/platform/client/mobile/social-parity",
    "docs/architecture/shared/security/secure-content"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 4200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "mps-lifecycle-source",
      "command": "pnpm --dir apps/mobile exec vitest run src/runtimes/socialProjectionRuntime.test.ts src/runtimes/privateMomentsRuntime.test.ts src/features/social/socialStore.profileSessionFence.test.ts src/components/recovery && cargo test --manifest-path apps/mobile/src-tauri/Cargo.toml social",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Background preserves encrypted drafts, admitted commands and bounded verified projections while writes wait for revalidation",
    "Restart restores encrypted draft and command state and derives pages from runtime projection",
    "Station or account switch hides the old tree before opening the new scope",
    "Scope teardown purges old plaintext, object URLs, key references, callbacks, listeners, timers and worker state",
    "Generation fences reject every stale completion after scope switch"
  ],
  "failureBehavior": [
    "Do not persist private plaintext or draft material in Web storage",
    "Do not let stale generation callbacks repopulate the new scope",
    "Do not retain a cross-scope draft except as explicitly quarantined content bound to its original scope"
  ],
  "updatedAt": "2026-10-06T10:11:00.000Z"
}
```

## Objective

只关闭 MSP-J09 的 lifecycle 结果，让后台、重启和 scope switch 复用 Mobile lifecycle
kernel，而不把页面变成 freshness 或 teardown owner。

## Current Snapshot

- Social runtime has generation and projection foundations.
- Full Social draft, media, callback and key-reference teardown is not proven as one scope boundary.
- Background/restart behavior is split across public and private owners.
