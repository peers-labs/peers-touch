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
    "docs/architecture/architecture-module-governance",
    "docs/architecture/chat-storage-governance",
    "packages/client-chat-core",
    "packages/locales",
    "apps/mobile/package.json",
    "apps/mobile/scripts/ios-dev-sim.sh",
    "apps/mobile/src-tauri/src/messaging/adapter.rs",
    "apps/mobile/src-tauri/src/messaging/storage_governance_test.rs",
    "apps/mobile/src/acceptance",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src/runtimes",
    "docs/architecture/mobile/mobile-acceptance-environment.md",
    "docs/client/mobile/acceptance-setup.md",
    "pnpm-lock.yaml",
    "tooling/acceptance",
    "tooling/scripts/architecture/module-governance.test.mjs"
  ],
  "readSet": [
    "apps/mobile/src/pages/ChatPage.tsx",
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
  "updatedAt": "2026-09-27T16:16:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "Development Session CSG-BATCH-02-mobile-R8 / functional run 20260927T160103560863Z-38dfe29d35cbcb8757758a091ec03fa0 at 0b5a5d4c8"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance-run 20260927T160339708176Z-e25c9c01d44696e66e03619699de4879; gate 20260927T160339938886Z-e766626e9dd2f09a23471d684d684a51; gap detector PROVEN/0; review cc30ff5bc2df1a8f70f21fd16e4e7521f1d547fb43df7bc71063b4a9628b88fc"
    }
  ]
}
```

## Current Snapshot

- State: done; final source `0b5a5d4c8` is `PASS/DONE/PROVEN`.
- Dependency: `CSG-BATCH-01-desktop` done.
- Evidence: filtered current-result select-all, explicit second selection,
  unselected control preservation, partial retry, scope reset, physical
  reclamation and restart stability passed on iPhone 17 / 17 Pro Max.

## Closure

Mobile users receive the same batch semantics through platform-appropriate controls and feedback.

## Concurrency Decision

- Mode: serial after Desktop.
- Reason: Mobile consumes the shared helper and accepted batch result contract.
