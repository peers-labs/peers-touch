# CSG-BATCH-02：Mobile 批量会话清理

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-BATCH-20260927",
  "taskId": "CSG-BATCH-02-mobile",
  "workstreamId": "CSG-BATCH-MOBILE",
  "title": "交付 Mobile 存储列表批量清理与窄屏恢复状态",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "csg-batch-mobile",
  "journeyId": "CSG-J07",
  "runtimeClass": "native-mobile",
  "writeSet": [
    "docs/architecture/chat-storage-governance",
    "packages/client-chat-core",
    "packages/locales",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/runtimes",
    "tooling/acceptance"
  ],
  "readSet": [
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
      "id": "mobile-chat-storage-batch-unit",
      "command": "pnpm --dir apps/mobile exec vitest run src/pages/settings/SettingsSections.test.tsx src/runtimes/chatStorageRuntime.test.ts",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "chat-storage-mobile-batch-functional",
      "command": "python3 -m tooling.acceptance.gates.mobile.simulator_social_e2e --scenario storage-batch-clear",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "chat-storage-mobile-batch-clear-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-mobile-batch-clear-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Mobile Storage list exposes narrow-screen manage mode, row selection and select-all for current search results",
    "Confirmation and progress remain readable without overlapping the list or bottom navigation",
    "Mobile consumes the shared serial batch helper and canonical single-conversation command",
    "Partial failure preserves failed IDs and exposes a retry action",
    "Exact-source native Mobile Journey proves two selected conversations are cleared and remain absent after restart"
  ],
  "failureBehavior": [
    "Do not copy Desktop-only layout or hover interactions",
    "Do not keep the action sheet or confirmation tree alive after close",
    "Do not clear filtered-out or unselected conversations",
    "Do not carry selection or result across a scope change"
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

- State: pending.
- Dependency: `CSG-BATCH-01-desktop`.
- Foundation: Mobile Storage list and canonical single-conversation clear already exist.

## Closure

Mobile users receive the same batch semantics through platform-appropriate controls and feedback.

## Concurrency Decision

- Mode: serial after Desktop.
- Reason: Mobile consumes the shared helper and accepted batch result contract.
