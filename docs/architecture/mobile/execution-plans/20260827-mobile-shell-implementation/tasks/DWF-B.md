# DWF-B - Development Workflow D13/D14 Self-Hosting

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "mobile-shell-20260827",
  "taskId": "DWF-B",
  "workstreamId": "DWF-B",
  "title": "Development Workflow D13/D14 self-hosting migration",
  "workClass": "infrastructure",
  "executionMode": "build",
  "closureId": "DWF-B",
  "journeyId": "DWF-AS01..DWF-AS04",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "Makefile",
    "apps/mobile/scripts/check-chat-history-search.mjs",
    "debug-mobile-list-history.md",
    "docs/architecture/api-ownership/execution-plans/20260906-conversation-authority-hard-cut.md",
    "docs/architecture/development-workflow",
    "docs/architecture/mobile/README.md",
    "docs/architecture/mobile/execution-plans",
    "tmp/development-workflow-task-slices",
    "tooling/acceptance",
    "tooling/make",
    "tooling/scripts",
    "tooling/skills"
  ],
  "readSet": [
    "docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "dwf-package-integrity",
      "command": "node tooling/scripts/plan/planctl.mjs validate --plan docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/plan.md && node -e \"const fs=require('node:fs');const crypto=require('node:crypto');const crosswalk=JSON.parse(fs.readFileSync('docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/migration-crosswalk.json','utf8'));const digest=crypto.createHash('sha256').update(fs.readFileSync('docs/architecture/mobile/execution-plans/20260827-mobile-shell-implementation/archive/legacy-plan.md')).digest('hex');if(digest!==crosswalk.archiveSha256||digest!==crosswalk.legacySha256)process.exit(1)\"",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "dwf-control-plane",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mobile-shell-implementation --gate development-workflow-control-plane",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "dwf-control-plane-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "The locked migration commits exactly one active Mobile package with DWF-B current",
    "The legacy plan is byte-identical in archive and absent from live discovery",
    "active_work first mirrors DWF-B, then planctl atomically closes DWF-B and selects W5"
  ],
  "failureBehavior": [
    "Stop on the first typed migration or review failure",
    "Complete or roll back an interrupted locked transaction",
    "Never activate both legacy and package plans"
  ],
  "updatedAt": "2026-09-16T00:00:00.000Z",
  "completionClass": "functional"
}
```

## Objective

Finish DWF-B3 through DWF-B5 without changing Mobile product behavior.

## Current Snapshot

- B1 parser/declaration/Session tooling and B2 workflow Skills are verified.
- B3 package preparation and both B4 reviews passed before the cut.
- B5 committed the reviewed file transaction with DWF-B current. Tracking
  must mirror that manifest state before `planctl advance` closes DWF-B and
  selects the W5 product source Task.
