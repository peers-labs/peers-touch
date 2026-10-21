# RD-T06 — 治理、文档和交付边界

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T06",
  "workstreamId": "RD",
  "title": "Register implemented architecture and preserve explicit delivery proof obligations",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rd-module-activation",
  "journeyId": "RD-J06",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/release-distribution",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/architecture/engineering/README.md",
    "docs/README.md",
    "docs/global/local-dev-environment.md"
  ],
  "readSet": ["tooling/scripts/architecture"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 1, "cleanupSeconds": 60},
  "checks": [
    {"id": "rd-module-shape", "command": "node tooling/scripts/architecture/module-governance.mjs validate", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-plan-shape", "command": "make plan-validate PLAN=docs/architecture/engineering/release-distribution/execution-plans/20261021-release-distribution-review/plan.md", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "Implemented architecture has all six required docs including data-model; stateMachine/persistence characteristics are true and registry paths reference current implemented resources.",
    "Scope and evidence obligations distinguish functional candidate checks from formal Acceptance; registry uses existing valid evidence references, never invented rd-* proof.",
    "Architecture, platform and user-install documentation agree on stable manifest discovery, versioned package URLs, candidate/public trust boundaries, updater runtime registration and backup-safe rollback.",
    "README indexes link the current revision and required state contract; old frozen package is retained unchanged and not selected for execution.",
    "Completion source review reports missing runtime/formal proof as UNPROVEN; no data restore or release is performed by this task."
  ],
  "failureBehavior": [
    "Unimplemented paths or missing current evidence prevent an implemented/verified delivery claim.",
    "Never clear obligations or rewrite old plan contents to pass a validator.",
    "Active status and a registry entry do not by themselves establish product readiness."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Current Snapshot

- Documentation and registry closure follows implementation of the declared contract.
- This revision request only updates design/plan artifacts; no implementation lifecycle is marked done.
