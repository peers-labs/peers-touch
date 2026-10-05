# LDCP-P5: Plan-Aware Development Observability

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PROGRESS-20260917",
  "taskId": "LDCP-P5",
  "workstreamId": "LDCP-PLAN-OBSERVABILITY",
  "title": "Plan-aware development observability",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ldcp-plan-observability",
  "journeyId": "LDCP-J05-plan-aware-observability",
  "runtimeClass": "browser",
  "writeSet": [
    "Makefile",
    "apps/dev",
    "docs/architecture/development-workflow",
    "docs/architecture/local-dev-control-plane",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 240,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "ldcp-declaration-tests",
      "command": "node --test tooling/scripts/local-dev/dev-work.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ldcp-plan-projection-tests",
      "command": "node --test apps/dev/server/*.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ldcp-plan-projection-visual",
      "command": "browser screenshots at desktop and mobile viewport",
      "verificationClass": "UX_REVIEW"
    },
    {
      "id": "ldcp-workflow-contract",
      "command": "bash tooling/scripts/review/skill-check.sh",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "development declarations carry a repository-relative Plan locator and stable Plan and Task identity",
    "Peers Dev resolves package progress through the canonical Plan Package parser without exposing canonical paths",
    "active and stale declarations remain visible with typed lifecycle state",
    "work execution state is independent from environment health and resource conflicts",
    "workflow heartbeat and registry source-identity synchronization rules prevent avoidable silent staleness"
  ],
  "failureBehavior": [
    "reject absolute or escaping Plan paths",
    "surface missing, mismatched, legacy or invalid plans as typed progress state",
    "never infer a Plan from a work item identifier",
    "never classify environment dirtiness as work execution failure",
    "never use a stale declaration to authorize mutation or resource possession"
  ],
  "updatedAt": "2026-09-17T12:42:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "development declaration and Plan Package suites (15/15 and 105/105)"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "Peers Dev server and projection suites (14/14); Machine Dev suites (33/33)"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "profile resolution (12/12), skill-check, plan validation, and git diff check"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "live API: Agent 3/8 (37.5%), Chat 1/9 (11.11%), Federation stale legacy-visible"
    },
    {
      "verificationClass": "UX_REVIEW",
      "result": "PASS",
      "ref": "Chrome headless 1440x900 and 390x844 renders with split Work/Environment state and no overlap"
    }
  ]
}
```

## Objective

Make the public development declaration the explicit join between a running
work item and its Plan Package, then project truthful progress and independent
environment health in Peers Dev.

## Current Snapshot

- Explicit declaration locators validate Plan, Task, binding, and source
  identity while preserving legacy ledger records during rollout.
- Peers Dev resolves canonical Plan Package progress and uses validated Session
  identity only as a read-only mixed-version bridge.
- Active and stale work remain visible; only live declarations contribute
  runtime intent.
- Work state, environment health, and dirty server source identity are
  independently projected and visually verified.
