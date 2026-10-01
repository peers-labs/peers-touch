# Canonical Peers Dev UI

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PEERS-DEV-CANONICAL-20260926",
  "taskId": "DWF-CAN03-DEV-UI",
  "workstreamId": "DWF-DEV-UI",
  "title": "Integrate live three-level progress into canonical Peers Dev",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "canonical-dev-ui",
  "journeyId": "DEV-J02",
  "runtimeClass": "browser",
  "writeSet": [
    "apps/dev",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates/dev"
  ],
  "readSet": [
    "tooling/scripts/local-dev",
    "docs/architecture/development-workflow"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 180,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "dev-ui-source",
      "command": "pnpm --dir apps/dev run check && pnpm --dir apps/dev test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "dev-ui-acceptance-source",
      "command": "python3 -m unittest tooling.acceptance.gates.dev.dev_ui_browser_e2e_test && python3 tooling/scripts/acceptance-validate-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "dev-ui-browser",
      "command": "node tooling/acceptance/gates/dev/dev-ui-browser-e2e.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "dev-ui-browser-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate peers-dev-ui-browser-e2e",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Stage, Plan, Task, Review, and Agent activity are visible",
    "SSE updates and polling fallback retain the last valid snapshot",
    "Unregistered worktrees and freshness remain visible",
    "One machine-wide 4177 service is reusable across worktrees",
    "Desktop and narrow browser viewports have no overlap"
  ],
  "failureBehavior": [
    "Do not make the UI a workflow owner",
    "Do not hide an unregistered or stale worktree",
    "Do not require the singleton server source to equal every viewer workspace"
  ],
  "updatedAt": "2026-09-26T10:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: UI and SSE migration in progress.
- Required viewports: 1440x1000 and 390x844.
- Existing discovery, active-work, and freshness behavior must remain intact.
