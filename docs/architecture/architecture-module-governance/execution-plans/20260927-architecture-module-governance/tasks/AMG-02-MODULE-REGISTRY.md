# Architecture Module Registry

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AMG-20260927",
  "taskId": "AMG-02-MODULE-REGISTRY",
  "workstreamId": "AMG-CONTRACT",
  "title": "Implement the positive module and capability contract",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "amg-module-registry",
  "journeyId": "AMG-J02",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/architecture-module-governance/architecture-modules.json",
    "tooling/scripts/architecture",
    "tooling/acceptance/gates.yaml"
  ],
  "readSet": [
    "docs/README.md",
    "docs/architecture/architecture-module-governance",
    "docs/architecture/station-access-lifecycle",
    "docs/architecture/api-ownership/station-api-capabilities.yaml",
    "docs/knowledge"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 120,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "module-governance-unit",
      "command": "node --test tooling/scripts/architecture/module-governance.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "module-governance-current-tree",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "architecture-module-governance",
      "command": "python3 tooling/scripts/acceptance-run.py --gate architecture-module-governance",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "One strict registry declares active modules and governed paths",
    "Required documents are derived from module characteristics",
    "Capability IDs, owners, roots, consumers and dependencies are positive allowlists",
    "External capability references resolve to current registry IDs",
    "Changed active architecture modules without a declaration fail closed"
  ],
  "failureBehavior": [
    "Do not add legacy, retired, alias, denylist or superseded schema fields",
    "Do not make the machine registry a second semantic design source"
  ],
  "updatedAt": "2026-09-27T03:10:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "14 module governance parser and fail-closed contract tests passed"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "Current registry validates architecture-module-governance and station-access-lifecycle"
    }
  ]
}
```

## Current Snapshot

- State: implementation complete; clean-source workflow proof pending.
- Scope: shared parser, strict registry, path matcher and deterministic tests.
