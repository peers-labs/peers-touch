# Canonical Proof And Cleanup

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PEERS-DEV-CANONICAL-20260926",
  "taskId": "DWF-CAN05-PROOF-CLEANUP",
  "workstreamId": "DWF-DELIVERY",
  "title": "Prove the canonical product and close local workflow state",
  "workClass": "infrastructure",
  "completionClass": "acceptance-aggregate",
  "executionMode": "fix",
  "closureId": "canonical-final-proof",
  "journeyId": "DEV-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/development-workflow/execution-plans/20260926-peers-dev-canonicalization",
    "tooling/acceptance/gates/dev"
  ],
  "readSet": [
    "AGENTS.md",
    "Makefile",
    "apps/dev",
    "docs/architecture/development-workflow",
    "docs/global/workflow.md",
    "docs/knowledge",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/make/local-dev.mk",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan",
    "tooling/scripts/README.md",
    "tooling/skills"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 420,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "workflow-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "peers-dev-product",
      "command": "python3 tooling/scripts/acceptance-run.py --gate peers-dev-product --gate machine-dev-registry-self",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Workflow source, Doctor, and both browser viewports pass from canonical root",
    "No migrated file references the erroneous workspace identity",
    "No operation mutates or removes the sibling peers-dev-product worktree",
    "peers-touch-git remains unchanged",
    "No push, pull request, merge, or history rewrite is created"
  ],
  "failureBehavior": [
    "Do not mutate or remove the sibling peers-dev-product worktree under this Plan Run",
    "Do not claim historical receipts as canonical proof",
    "Do not hide tests that were not run"
  ],
  "updatedAt": "2026-09-26T10:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: ready after all implementation lanes reconciled.
- Cleanup boundary: local workflow state only; `peers-dev-product` is untouched.
- Delivery boundary: working tree only; commit and push remain denied.
