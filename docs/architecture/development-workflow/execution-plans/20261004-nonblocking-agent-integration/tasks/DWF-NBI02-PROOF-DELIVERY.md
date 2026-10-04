# Nonblocking Integration Proof And Delivery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-NONBLOCKING-INTEGRATION-20261004",
  "taskId": "DWF-NBI02-PROOF-DELIVERY",
  "workstreamId": "DWF-INTEGRATION-DELIVERY",
  "title": "Prove control-action isolation and prepare delivery",
  "workClass": "infrastructure",
  "completionClass": "acceptance-aggregate",
  "executionMode": "fix",
  "closureId": "nonblocking-control-proof",
  "journeyId": "DEV-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/development-workflow/execution-plans/20261004-nonblocking-agent-integration",
    "tooling/acceptance",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/review",
    "tooling/skills/pt-github-review"
  ],
  "readSet": [
    "Makefile",
    "docs/architecture/development-workflow",
    "docs/knowledge/invariants/owner-rooted-workflow-binding.md",
    "tooling/make/setup.mk",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/local-dev"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "nonblocking-integration-complete-source",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py && node --test tooling/scripts/local-dev/workflow-*.test.mjs tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "nonblocking-integration-structure",
      "command": "tooling/scripts/review/skill-check.sh && node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "nonblocking-integration-acceptance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation --gate acceptance-plan-self --gate acceptance-workflow-contract --gate development-workflow-control-plane",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "All DWF-D34 source and Acceptance checks pass on exact source",
    "Architecture, invariant, command help, audit, and implementation agree",
    "Review finds no authorization weakening, cleanup escape, or compatibility shim",
    "Commit and pull request contain no pre-existing generated capability changes"
  ],
  "failureBehavior": [
    "Do not run the real machine hard cut or GC as source proof",
    "Do not claim product runtime behavior from source-only checks",
    "Do not include unrelated generated capability files in the commit",
    "Do not merge or rewrite history"
  ],
  "updatedAt": "2026-10-04T01:50:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: pending on `DWF-NBI01-CONTROL-ACTIONS`.
- No formal evidence recorded.
