# CSG-BATCH-03：批量清理聚合验收

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CSG-BATCH-20260927",
  "taskId": "CSG-BATCH-03-aggregate",
  "workstreamId": "CSG-BATCH-ACCEPTANCE",
  "title": "证明双端批量清理与发布构建",
  "workClass": "product-behavior",
  "completionClass": "acceptance-aggregate",
  "executionMode": "build",
  "closureId": "csg-batch-aggregate",
  "journeyId": "CSG-J07-release",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/chat-storage-governance",
    "apps/desktop/src/store/session.ts",
    "apps/desktop/src/store/session.test.ts",
    "apps/desktop/src/services/appRuntime.ts",
    "apps/desktop/src-tauri/src/main.rs",
    "apps/mobile/src/features/social",
    "apps/mobile/src/runtimes",
    "apps/station/app/subserver/conversation",
    "apps/station/app/subserver/social/infrastructure",
    "packages/sdk/dart/lib/src/gen",
    "packages/sdk/go/gen",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop/src/components/settings",
    "apps/desktop/src/runtimes",
    "apps/desktop/src-tauri/src/messaging",
    "apps/mobile/src/pages/settings",
    "apps/mobile/src-tauri/src/messaging",
    "packages/client-chat-core",
    "packages/locales",
    "packages/messaging-core"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 14400,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "chat-storage-batch-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.chat.storage_governance_contract_test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "desktop-release-build",
      "command": "python3 tooling/scripts/acceptance-run.py --gate desktop-release-build",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "mobile-native-build",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-native-build",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "acceptance-infra-validation",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation",
      "verificationClass": "ACCEPTANCE_PROOF"
    },
    {
      "id": "chat-storage-batch-clear-aggregate-e2e",
      "command": "python3 tooling/scripts/acceptance-run.py --gate chat-storage-batch-clear-aggregate-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Desktop and Mobile batch-clear Gates are DONE and PROVEN on one exact source",
    "Desktop release and Mobile native builds pass on the same source",
    "Acceptance infrastructure validation passes",
    "No batch path bypasses canonical single-conversation cleanup",
    "Final aggregate rejects stale evidence and the worktree is clean"
  ],
  "failureBehavior": [
    "Do not waive a native Journey with unit, static or screenshot evidence",
    "Do not aggregate evidence from another source identity",
    "Do not mark partial batch success as complete",
    "Do not run a Tauri release build with less than 20 GiB free disk"
  ],
  "updatedAt": "2026-09-27T18:00:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "39 Python tests, 66 focused Mobile Vitest cases, Mobile check, Chat domain validation, and forbidden-path contract checks"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "acceptance://acceptance-run/latest/reports/run.json and acceptance://acceptance-gap-detect/latest/reports/gap-report.json; exact-source closure and zero-gap proof"
    }
  ]
}
```

## Current Snapshot

- State: implementing final integrated-source remediation after the branch
  advanced beyond the previously proven source.
- Dependencies: `CSG-BATCH-01-desktop`, `CSG-BATCH-02-mobile` are done.
- Review: final exact-source Acceptance, Gap Detector and independent
  plan-scope completion review must be rerun after remediation.

## Closure

Final exact-source evidence proves both native batch journeys, release builds and workflow integrity.

## Concurrency Decision

- Mode: serial aggregate after both functional closures.
- Reason: aggregate evidence must bind one final committed source identity.
