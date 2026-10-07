# MICU-04 - Usability Report And Close

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-infra-chat-usability-20261006",
  "taskId": "MICU-04",
  "workstreamId": "MICU-RELEASE",
  "title": "Repair the stale Chat contract Gate, aggregate exact-source evidence, and close resources",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "MICU-04-usability-report",
  "journeyId": "MICU-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "reports/mobile-infra-chat-usable",
    "tooling/acceptance/gates/chat/messaging_platform_contract_test.py"
  ],
  "readSet": [
    "docs/architecture/platform/client/mobile/execution-plans/20261006-infra-chat-usability-v33",
    "tooling/acceptance/reports",
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/src/messaging",
    "packages/messaging-core/src/recovery",
    "apps/desktop/src/acceptance",
    "apps/desktop/src/components/chat/ChatDetailPanel.tsx",
    "apps/station/app/subserver/conversation"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "mobile-contract-static",
      "command": "python3 tooling/scripts/acceptance-run.py --gate mobile-contract-static",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "station-messaging-unit",
      "command": "python3 tooling/scripts/acceptance-run.py --gate station-messaging-unit",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "messaging-platform-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --gate messaging-platform-contract",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "architecture-module-governance",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "The report records source, Station, Desktop, Mobile, account, and Gate identities",
    "The report links source-bound iOS Simulator UDIDs, bundle identity, visible login and Chat screenshots, Appium source, and cleanup evidence",
    "The Chat contract Gate follows the canonical messaging-core recovery owner and messagingCommands group membership API",
    "Every required Journey is PASS or names its first actionable failure",
    "Agent, Moments, cross-Station, Android, physical OAuth, and physical-device scope remain explicit non-claims",
    "Quality, gap, and completion audits use final exact source",
    "Simulator, Appium, Desktop, Station deployment, and workflow resources are released or explicitly retained by their owners"
  ],
  "failureBehavior": [
    "Do not convert stale or source-only evidence into a PASS",
    "Do not restore retired implementation locations or APIs to satisfy stale string assertions",
    "Do not hide blocked or unrun scope",
    "Do not push or create a pull request"
  ],
  "updatedAt": "2026-10-06T20:00:50.000Z"
}
```

## Objective

Repair the two stale Chat business-Gate assertions, then produce the complete
user-facing usage report and bounded readiness claim for the exact Mobile
Infra/Chat scope.

## Current Snapshot

- State: MICU-02 and MICU-03 are formally PROVEN in the superseded v33 run.
- The residual source closure repairs only stale static assertions discovered
  by the v33 MICU-04 focused check.
- Next boundary: pass all four focused checks, aggregate final exact-source
  evidence, and close resources.
