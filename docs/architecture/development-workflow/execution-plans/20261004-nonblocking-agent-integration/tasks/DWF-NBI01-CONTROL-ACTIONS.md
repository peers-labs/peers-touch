# Nonblocking Integration Control Actions

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-NONBLOCKING-INTEGRATION-20261004",
  "taskId": "DWF-NBI01-CONTROL-ACTIONS",
  "workstreamId": "DWF-INTEGRATION-CONTROL",
  "title": "Freeze the native-only workflow and Plan-mount architecture",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "nonblocking-control-actions",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "Makefile",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/development-workflow",
    "docs/architecture/frontend-runtime",
    "docs/architecture/local-dev-control-plane",
    "docs/architecture/runtime/desktop-runtime-architecture.md",
    "docs/client/desktop",
    "docs/global",
    "docs/knowledge",
    "tooling/scripts/review",
    "tooling/skills"
  ],
  "readSet": [
    "apps/desktop",
    "apps/dev",
    "tooling/acceptance",
    "tooling/devctl",
    "tooling/make",
    "tooling/scripts"
  ],
  "budgets": {
    "focusedCheckSeconds": 420,
    "functionalRunSeconds": 420,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "integration-control-source",
      "command": "make plan-validate PLAN=docs/architecture/development-workflow/execution-plans/20261004-nonblocking-agent-integration/plan.md",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "native-only-architecture-source",
      "command": "rg -n 'DWF-D38|DWF-D39|LDCP-D19|D-18' docs/architecture/development-workflow/decisions.md docs/architecture/local-dev-control-plane/decisions.md docs/architecture/frontend-runtime/decisions.md",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "PlanVersion and PlanMount are separate concepts and execution copies executionBinding into an immutable ExecutionPlanSnapshot",
    "One mounted Plan occupies one worktree until completion, cancellation, or explicit owner unmount",
    "Mount, runtime lease, and atomic lock are the only resource-conflict classes",
    "Desktop browser mode and the Peers Dev 4177 browser dashboard are explicitly unsupported",
    "Native Desktop launch and native Acceptance are the only Desktop runtime and proof paths",
    "Tauri WebView, system-browser OAuth handoff, and independent Web products remain in scope",
    "Target module layout and knowledge explicitly identify NBI02 as the implementation cutover owner"
  ],
  "failureBehavior": [
    "Do not weaken OWNER binding or cross-worktree write enforcement",
    "Do not issue a skills projection grant or allow its installation receipt to authorize cleanup",
    "Do not accept caller-supplied delegation provenance or weaken immutable current-source review",
    "Do not treat a short machine lock as global-idle proof",
    "Do not retain browser aliases, fallback launchers, browser runtime classes, or browser proof substitution",
    "Do not delete Plan, Session, Completion Review, lease, or Acceptance stores",
    "Do not modify docs/architecture/federation/data-model.md"
  ],
  "updatedAt": "2026-10-04T14:35:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: architecture source committed at `8e5d5040f`; reviewer remediation in progress.
- The prior browser-backed runtime evidence is invalid for this closure.
- Next: close independent reviewer findings, then advance to
  `DWF-NBI02-NATIVE-PLAN-MOUNT-CUTOVER`.
