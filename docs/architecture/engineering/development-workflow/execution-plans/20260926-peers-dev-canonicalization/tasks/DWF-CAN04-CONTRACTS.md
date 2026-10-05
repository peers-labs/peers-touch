# Canonical Contracts And Registration

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PEERS-DEV-CANONICAL-20260926",
  "taskId": "DWF-CAN04-CONTRACTS",
  "workstreamId": "DWF-CONTRACTS",
  "title": "Publish workflow contracts and project resource planning",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "canonical-contracts",
  "journeyId": "DEV-J06",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "Makefile",
    "docs/architecture/development-workflow",
    "docs/architecture/local-dev-control-plane",
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "docs/architecture/prototypes/execution-plans/20260622-prototype-portal.md",
    "docs/global/code-review-framework.md",
    "docs/global/workflow.md",
    "docs/knowledge",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/registry.yaml",
    "tooling/make/local-dev.mk",
    "tooling/make/review.mk",
    "tooling/review-fixtures",
    "tooling/scripts/README.md",
    "tooling/scripts/check-frontend-runtime-registry.mjs",
    "tooling/scripts/skill-rollout-audit.py",
    "tooling/scripts/skill-rollout-audit-test.py",
    "tooling/scripts/skill-rollout-control.py",
    "tooling/scripts/local-dev",
    "tooling/scripts/review",
    "tooling/skills"
  ],
  "readSet": [
    "apps/dev"
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
    },
    {
      "id": "review-framework",
      "command": "tooling/scripts/review/skill-check.sh && tooling/scripts/review/run.sh --range HEAD",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "resource-planning",
      "command": "node --test tooling/scripts/local-dev/dev-resource-plan.test.mjs tooling/scripts/local-dev/dev-work.test.mjs tooling/scripts/local-dev/completion-review.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Product and architecture contracts use canonical decision numbering",
    "The human guide maps every promise to Workflow Doctor",
    "Existing Acceptance coverage remains registered",
    "New Peers Dev Gates are additive",
    "Code structure review has stable rule IDs, blocking boundaries, exceptions, and examples",
    "Source changes route through the code-structure profile and advisory signals",
    "Semantic structure verdicts are bound to source and rubric identity before aggregation",
    "Structure review callers select only a range, path/depth, or PR while tooling derives scope, exclusions, signals, hashes, and coverage",
    "Fixture schema validates blocking, passing, false-positive, and rubric-reference anchors",
    "Cross-model conformance claims require a separate recorded evaluation",
    "Module Skills emit standard ModuleImpact without selecting concrete deployment targets",
    "Dev Workflow aggregates multi-module resource requirements before runtime acquisition",
    "Resource preparation deduplicates reusable accounts, services, clients, devices, fixtures, and automation sessions",
    "Wave-level mandatory matching prevents flexible demand from starving constrained targets; real capacity conflicts park only affected lanes and never partially reserve a resource bundle",
    "Runtime owners retain physical lifecycle and quarantine authority while business Gates remain attach-only",
    "Completion Review can close a successful Task into deterministic fixed-point exhaustion when only blocked branches remain"
  ],
  "failureBehavior": [
    "Do not copy stale workspace identity or historical proof",
    "Do not remove an existing Gate or registry rule",
    "Do not duplicate the host execution binding contract",
    "Do not create a second resource orchestrator or move physical lifecycle ownership into module Skills",
    "Park a capacity-conflicted target without partially publishing its claims or blocking independent targets"
  ],
  "updatedAt": "2026-09-30T07:38:00.000Z",
  "durableEvidence": []
}
```

## Current Snapshot

- State: contract, registration, and project resource planning integration in progress.
- The erroneous Plan is historical input only.
- Shared registries use additive semantic reconciliation.
