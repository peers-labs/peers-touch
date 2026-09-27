# Canonical Contracts And Registration

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PEERS-DEV-CANONICAL-20260926",
  "taskId": "DWF-CAN04-CONTRACTS",
  "workstreamId": "DWF-CONTRACTS",
  "title": "Publish the product contract, executable guide, and Gate registration",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "canonical-contracts",
  "journeyId": "DEV-J04",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "Makefile",
    "docs/architecture/development-workflow",
    "docs/architecture/prototypes/execution-plans/20260622-prototype-portal.md",
    "docs/global/workflow.md",
    "docs/knowledge",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/make/local-dev.mk",
    "tooling/scripts/README.md",
    "tooling/skills"
  ],
  "readSet": [
    "apps/dev",
    "tooling/scripts/local-dev"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 60,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "workflow-doctor",
      "command": "make workflow-doctor IDE=trae",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "registry-validation",
      "command": "python3 tooling/scripts/acceptance-validate.py --infra",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Product and architecture contracts use canonical decision numbering",
    "The human guide maps every promise to Workflow Doctor",
    "Existing Acceptance coverage remains registered",
    "New Peers Dev Gates are additive"
  ],
  "failureBehavior": [
    "Do not copy stale workspace identity or historical proof",
    "Do not remove an existing Gate or registry rule",
    "Do not duplicate the host execution binding contract"
  ],
  "updatedAt": "2026-09-26T10:00:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: contract and registration integration in progress.
- The erroneous Plan is historical input only.
- Shared registries use additive semantic reconciliation.
