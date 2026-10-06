# MICU-04 - Usability Report Audit Boundary And Close

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-infra-chat-usability-20261006",
  "taskId": "MICU-04",
  "workstreamId": "MICU-RELEASE",
  "title": "Correct the source-only audit boundary and close the usability report",
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
    "docs/architecture/platform/client/mobile/execution-plans/20261006-infra-chat-usability-v33",
    "docs/architecture/platform/client/mobile/execution-plans/20261006-infra-chat-usability-v34",
    "tooling/acceptance/gates/chat/messaging_platform_contract_test.py",
    "tooling/acceptance/reports",
    "packages/messaging-core/src/recovery",
    "apps/desktop/src/components/chat/ChatDetailPanel.tsx",
    "apps/mobile/src-tauri/src/messaging",
    "apps/mobile/src-tauri/src/runtime/oauth",
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
    "The report links source-bound dual-iOS Simulator UDIDs, bundle identity, visible login and Chat screenshots, Appium source, and cleanup evidence",
    "The report distinguishes immutable product evidence from the final source-only review checkpoint",
    "The MICU-02 and MICU-03 product Gap artifacts remain PROVEN and are not relabeled as final-source product execution",
    "Code structure, quality, Completion Review, and close audits bind the final report commit",
    "Every required Journey is PASS or names its first actionable failure",
    "Agent, Moments, cross-Station, Android, physical OAuth, and physical-device scope remain explicit non-claims",
    "Repository-wide validation failures outside the report delta remain explicit residual evidence rather than hidden or relabeled regressions",
    "Simulator, Appium, Desktop, Station deployment, and workflow resources are released or explicitly retained by their owners"
  ],
  "failureBehavior": [
    "Do not invoke or claim a new product Gap result for the source-only report delta",
    "Do not convert stale, source-only, or repository-wide unrelated evidence into a product PASS",
    "Do not relabel the completed MICU-02 or MICU-03 Gate source identity",
    "Do not restore retired implementation locations or APIs to satisfy stale string assertions",
    "Do not hide blocked, failed, or unrun scope",
    "Do not push or create a pull request"
  ],
  "updatedAt": "2026-10-06T20:22:36.000Z"
}
```

## Objective

Correct the report's audit boundary so product proof remains attached to the
immutable native Acceptance runs, while final source-only delivery review
binds the report checkpoint itself.

## Current Snapshot

- MICU-02 and MICU-03 remain formally `PROVEN/DONE`.
- The stale Chat contract assertions are already repaired and clean-source
  structural checks passed under v34.
- v35 changes only the report wording and final review boundary.
- Next boundary: update the report, rerun the four source checks, complete
  source review, and close resources.
