# Canonical Plan Generation

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PEERS-DEV-CANONICAL-20260926",
  "taskId": "DWF-CAN01-PLAN-GENERATION",
  "workstreamId": "DWF-CANONICAL-OWNER",
  "title": "Allow explicit sequential Plans in one canonical owner workspace",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "canonical-plan-generation",
  "journeyId": "DWF-J31",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "docs/architecture/development-workflow",
    "docs/global/workflow.md",
    "docs/knowledge",
    "tooling/make/local-dev.mk",
    "tooling/acceptance/core/execution_plan.py",
    "tooling/acceptance/tests/test_execution_plan.py",
    "tooling/scripts/plan",
    "tooling/scripts/acceptance-plan.py",
    "tooling/scripts/acceptance-plan-test.py",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-plan-and-document"
  ],
  "readSet": [
    "tooling/scripts/local-dev"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 420,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "plan-generation-tests",
      "command": "node --test tooling/scripts/plan/workspace-plan-binding.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "plan-generation-journey",
      "command": "node --test --test-name-pattern='advances.*generation|concurrent.*advance' tooling/scripts/plan/workspace-plan-binding.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "plan-generation-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate workspace-plan-generation-self --gate development-workflow-control-plane",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "An unfinished Plan generation cannot be replaced",
    "A completed and quiescent generation advances by compare-and-swap",
    "Every generation keeps immutable machine-local lineage",
    "Project rules prohibit Agent-created worktrees as a binding workaround"
  ],
  "failureBehavior": [
    "Do not delete or overwrite a binding file directly",
    "Do not infer the next Plan from repository contents",
    "Do not create another worktree to bypass a failed advance"
  ],
  "updatedAt": "2026-09-26T10:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: recovery implementation in progress under explicit user correction.
- Owner: workspace Plan binding and workflow policy.
- Claim boundary: no current machine binding is changed until focused tests pass.
