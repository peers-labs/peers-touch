# Architecture Document Contract

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AMG-20260927",
  "taskId": "AMG-01-DOCUMENT-CONTRACT",
  "workstreamId": "AMG-DOCUMENTS",
  "title": "Unify architecture content requirements and current-state vocabulary",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "amg-document-contract",
  "journeyId": "AMG-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/desktop/src/services/mock-gateway.ts",
    "docs/README.md",
    "docs/global/architecture-document-standard.md",
    "docs/global/coding-guide/common/testing.md",
    "docs/global/coding-guide/desktop/service-api.md",
    "docs/architecture/architecture-module-governance",
    "docs/architecture/station-access-lifecycle",
    "docs/architecture/boundaries",
    "tooling/acceptance"
  ],
  "readSet": [
    "docs/architecture/api-ownership/station-api-capabilities.yaml",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 30,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "plan-package-structure",
      "command": "make plan-validate PLAN=docs/architecture/architecture-module-governance/execution-plans/20260927-architecture-module-governance/plan.md",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "current-architecture-vocabulary",
      "command": "rg -n 'Status|Document Scope|核心原则|决策索引' docs/architecture/architecture-module-governance docs/architecture/station-access-lifecycle",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "station-access-interface-contract",
      "command": "python3 -m unittest tooling.acceptance.gates.station_access.capability_contract_test",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "Architecture format and content requirements have one active standard",
    "Document status values are consistent across registered modules",
    "Station Access documents describe only the current target state",
    "Protocol, state, ownership and integration documents are complete"
  ],
  "failureBehavior": [
    "Do not preserve removed interface names in active architecture",
    "Do not weaken required documents to make an incomplete module pass"
  ],
  "updatedAt": "2026-09-27T02:04:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "AMG and SAL Plan Packages validated after document contract update"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "22 Station Access capability, Federation boundary and aggregate unit tests passed"
    }
  ]
}
```

## Current Snapshot

- State: done.
- Architecture content profiles and status rules are active.
- Station Access docs and complete client-surface validation now use current capability inventory only.
