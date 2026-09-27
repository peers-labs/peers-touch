# CSG-BATCH-01：双端批量会话清理源码

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-BATCH-20260927",
  "taskId": "CSG-BATCH-01-desktop",
  "workstreamId": "CSG-BATCH-SOURCE",
  "title": "交付共享批量编排与双端存储列表交互",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "csg-batch-source",
  "journeyId": "CSG-J07",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/README.md",
    "docs/architecture/chat-storage-governance",
    "docs/architecture/local-dev-control-plane",
    "packages/client-chat-core",
    "packages/locales",
    "apps/desktop/src/acceptance/chat",
    "apps/desktop/src/components/settings",
    "apps/desktop/src/runtimes",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/messaging",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/runtimes",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop/src/components/chat",
    "apps/mobile/src/pages/ChatPage.tsx",
    "apps/mobile/src-tauri/src/messaging",
    "packages/messaging-core/src/storage_governance"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "chat-storage-batch-unit",
      "command": "pnpm --filter @peers-touch/client-chat-core test && pnpm --dir apps/desktop exec tsc --noEmit -p tsconfig.json --pretty false && pnpm --dir apps/desktop exec vitest run src/acceptance/chat/nativeBridge.test.ts src/components/settings/ChatStorageSettings.test.tsx src/runtimes/chatStorageRuntime.test.ts && pnpm --dir apps/mobile exec tsc --noEmit -p tsconfig.json --pretty false && pnpm --dir apps/mobile exec vitest run src/pages/settings/SettingsSections.test.tsx src/runtimes/chatStorageRuntime.test.ts src/acceptance/registry.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-storage-batch-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.storage_governance_contract_test tooling.acceptance.gates.chat.storage_governance_runner_test tooling.acceptance.gates.mobile.simulator_social_e2e_test",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Desktop and Mobile Storage lists expose manage mode, row selection and select-all for current search results",
    "Confirmation shows selected count, estimated reclaimable bytes and current-device scope",
    "Shared helper executes canonical conversation clears serially and reports progress",
    "Partial failure preserves failed IDs for retry and never restores successful items",
    "Both native Journey adapters and Gate contracts are source-complete"
  ],
  "failureBehavior": [
    "Do not clear any conversation without explicit selection and confirmation",
    "Do not execute multiple compactions concurrently",
    "Do not report estimated bytes as physically released bytes",
    "Stop pending work when the Station, actor, device or activation scope changes"
  ],
  "updatedAt": "2026-09-27T04:30:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "packages/client-chat-core/tests/storage-batch.test.mjs"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "tooling/acceptance/gates/chat/storage_governance_contract_test.py"
    }
  ]
}
```

## Current Snapshot

- State: source checks passed.
- Shared serial batch helper, Desktop/Mobile UI, scope fencing, localization and
  native Journey adapters are implemented.
- Desktop and Mobile TypeScript checks, focused component/runtime tests, Rust
  acceptance-feature compilation and Acceptance Infra validation pass.
- Native product proof remains owned by successor Tasks.

## Closure

Both clients expose the accepted batch interaction and one source-owned serial execution contract.

## Concurrency Decision

- Mode: serial source integration.
- Reason: both clients consume the same helper and shared locale/Acceptance registries.
