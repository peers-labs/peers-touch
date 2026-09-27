# Architecture Governance Enforcement

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AMG-20260927",
  "taskId": "AMG-03-ENFORCEMENT",
  "workstreamId": "AMG-ENFORCEMENT",
  "title": "Wire shared governance into PreToolUse, Plan validation and Review",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "amg-enforcement",
  "journeyId": "AMG-J03",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/architecture-module-governance",
    "docs/knowledge",
    "tooling/acceptance/gates.yaml",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts/architecture",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan",
    "tooling/scripts/review",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/skills/pt-architecture-design-methodology",
    "tooling/skills/pt-plan-and-document",
    "tooling/skills/pt-github-review",
    "tooling/make/review.mk"
  ],
  "readSet": [
    "docs/architecture/development-workflow",
    "AGENTS.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 180,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "governance-integration-unit",
      "command": "node --test tooling/scripts/architecture/module-governance.test.mjs tooling/scripts/plan/planctl.test.mjs tooling/scripts/local-dev/workflow-kernel.test.mjs tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "governance-edit-flow",
      "command": "node tooling/scripts/architecture/module-governance.mjs context --changed-file tooling/scripts/plan/plan-package.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "architecture-module-governance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate architecture-module-governance",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "PreToolUse emits a deterministic knowledge and architecture receipt",
    "Plan validation checks registered architecture source semantics",
    "Review and CI validate changed architecture modules through the shared parser",
    "Host adapters preserve existing authorization and fail-closed behavior"
  ],
  "failureBehavior": [
    "Do not let Hook context grant write authorization",
    "Do not duplicate registry parsing in Hook, Plan or Review callers",
    "Do not persist pre-edit receipts as workflow authority"
  ],
  "updatedAt": "2026-09-27T06:54:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "184 governance, Plan, Hook and host-adapter tests passed in architecture-module-governance run 20260927T055822742825Z-99d703b4680fb411dcc3dd9b830df1ce"
    },
    {
      "verificationClass": "ACCEPTANCE_PROOF",
      "result": "PASS",
      "ref": "architecture-module-governance is DONE/PROVEN at ce11ecff9a9247f970cbdf2b236edb39920b1764"
    }
  ]
}
```

## Current Snapshot

- State: done.
- Scope: one parser consumed by three enforcement boundaries.
- Proof: Hook, Plan, Review/CI and integration audit passed against the same
  current-source governance contract.
