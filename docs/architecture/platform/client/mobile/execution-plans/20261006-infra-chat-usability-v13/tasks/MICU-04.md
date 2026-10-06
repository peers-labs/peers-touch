# MICU-04 - Usability Report And Close

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-infra-chat-usability-20261006",
  "taskId": "MICU-04",
  "workstreamId": "MICU-RELEASE",
  "title": "Aggregate exact-source usability evidence and close resources",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "MICU-04-usability-report",
  "journeyId": "MICU-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "reports/mobile-infra-chat-usable"
  ],
  "readSet": [
    "docs/architecture/platform/client/mobile/execution-plans/20261006-infra-chat-usability-v13",
    "tooling/acceptance/reports",
    "apps/mobile/src-tauri/src/runtime/oauth",
    "apps/mobile/src-tauri/src/messaging",
    "apps/desktop/src/acceptance",
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
    "Every required Journey is PASS or names its first actionable failure",
    "Agent, Moments, cross-Station, Android, physical OAuth, and physical-device scope remain explicit non-claims",
    "Quality, gap, and completion audits use final exact source",
    "Simulator, Appium, Desktop, Station deployment, and workflow resources are released or explicitly retained by their owners"
  ],
  "failureBehavior": [
    "Do not convert stale or source-only evidence into a PASS",
    "Do not hide blocked or unrun scope",
    "Do not push or create a pull request"
  ],
  "updatedAt": "2026-10-06T06:50:55.000Z"
}
```

## Objective

Produce the complete user-facing usage report and bounded readiness claim for
the exact Mobile Infra/Chat scope.

## Current Snapshot

- State: blocked by MICU-02 and MICU-03.
- Common Mobile provisioner, shared Native Desktop driver, closed lifecycle
  scope contract, and SAL-G05 Acceptance injection impacts are explicit in the
  v13 contract.
- No final readiness claim exists for the continuation source.
- Next boundary: aggregate only final exact-source evidence, then close resources.
