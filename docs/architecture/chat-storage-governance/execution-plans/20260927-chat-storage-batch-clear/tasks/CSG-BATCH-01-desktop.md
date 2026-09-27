# CSG-BATCH-01：Desktop 批量会话清理

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-BATCH-20260927",
  "taskId": "CSG-BATCH-01-desktop",
  "workstreamId": "CSG-BATCH-DESKTOP",
  "title": "交付共享批量编排与 Desktop 存储列表批量清理",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "csg-batch-desktop",
  "journeyId": "CSG-J07",
  "runtimeClass": "native-desktop",
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
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop/src/components/chat",
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
      "command": "pnpm --filter @peers-touch/client-chat-core test && pnpm --dir apps/desktop exec vitest run src/components/settings/ChatStorageSettings.test.tsx src/runtimes/chatStorageRuntime.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-storage-desktop-batch-functional",
      "command": "PT_ACCEPTANCE_RUNTIME_CELL=desktop-macos-native python3 -m tooling.acceptance.gates.chat.storage_batch_desktop_runner",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-storage-desktop-batch-clear-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-desktop-batch-clear-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop Storage list exposes manage mode, row selection and select-all for current search results",
    "Confirmation shows selected count, estimated reclaimable bytes and current-device scope",
    "Shared helper executes canonical conversation clears serially and reports progress",
    "Partial failure preserves failed IDs for retry and never restores successful items",
    "Exact-source native Desktop Journey proves two selected conversations are cleared and remain absent after restart"
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
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "NOT_RUN",
      "ref": "Prepared plan; execution not started"
    }
  ]
}
```

## Current Snapshot

- State: in progress.
- Shared serial batch helper, Desktop manage/select/confirm/progress/result UI and
  acceptance-only two-conversation fixture are implemented.
- Focused TypeScript, Python contract and Desktop Rust acceptance-feature checks pass.
- Next: create an exact-source checkpoint and run the native Desktop Journey.

## Closure

Desktop users can select and clear multiple current-device conversations with durable per-item results.

## Concurrency Decision

- Mode: serial.
- Reason: shared helper, Desktop UI and Desktop native Journey define the first batch contract.
