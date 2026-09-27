# CSG-BATCH-02A：Desktop 原生批量清理证明

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-BATCH-20260927",
  "taskId": "CSG-BATCH-02A-desktop",
  "workstreamId": "CSG-BATCH-SOURCE",
  "title": "证明 Desktop 批量会话清理",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "csg-batch-desktop",
  "journeyId": "CSG-J07",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/dev",
    "docs/architecture/chat-storage-governance",
    "apps/desktop/src/acceptance/chat",
    "apps/desktop/src/components/settings",
    "apps/desktop/src/runtimes",
    "apps/desktop/src/services/desktop_api.ts",
    "apps/desktop/src-tauri/src/interface/tauri_commands/messaging.rs",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/desktop/src-tauri/src/messaging",
    "tooling/acceptance",
    "tooling/scripts/local-dev",
    "tooling/skills/pt-github-review/FRESHNESS.md",
    "tooling/skills/pt-local-dev-env"
  ],
  "readSet": [
    "packages/client-chat-core",
    "packages/locales",
    "packages/messaging-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "desktop-batch-source",
      "command": "pnpm --dir apps/desktop exec vitest run src/acceptance/chat/nativeBridge.test.ts src/components/settings/ChatStorageSettings.test.tsx src/runtimes/chatStorageRuntime.test.ts && cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --features acceptance-webdriver conversation_clear_ --offline -- --test-threads=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "local-dev-profile-policy",
      "command": "node --test tooling/scripts/local-dev/machine-dev.test.mjs apps/dev/server/status.test.mjs",
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
    "Desktop selects two explicit conversations through the Storage UI",
    "The confirmation reports selected count, estimate and current-device scope",
    "Both conversations clear serially through the canonical command",
    "The result reports physical bytes and cleared plaintext remains absent after restart"
  ],
  "failureBehavior": [
    "Do not substitute browser or Harness-only deletion for visible native UI actions",
    "Do not report partial success as complete",
    "Do not retain an Acceptance fixture command outside acceptance-webdriver builds"
  ],
  "updatedAt": "2026-09-27T05:00:00.000Z",
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

## Closure

Desktop native evidence proves the batch interaction and durable per-conversation results.

## Concurrency Decision

- Mode: runtime-serial.
- Reason: the Gate owns one isolated Desktop runtime and one Station fixture.
