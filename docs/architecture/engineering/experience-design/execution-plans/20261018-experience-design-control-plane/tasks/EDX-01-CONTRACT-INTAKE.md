# EDX-01: Closed Contract Intake

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "EDX-20261018",
  "taskId": "EDX-01-CONTRACT-INTAKE",
  "workstreamId": "EDX-CONTRACT",
  "title": "Validate one complete Experience Case, Rule Catalog and UI Grammar",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "contract-intake",
  "journeyId": "EDX-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/experience-design"
  ],
  "readSet": [
    "docs/architecture/engineering/experience-design",
    "docs/client/common/interaction-design-methodology.md",
    "docs/client/common/ui-identity/grammar-bindings.json"
  ],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 60,
    "cleanupSeconds": 10
  },
  "checks": [
    {
      "id": "contract-schema-unit",
      "command": "node --test tooling/scripts/experience-design/schema.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "contract-intake-cli",
      "command": "node tooling/scripts/experience-design/experience-design.mjs validate tooling/scripts/experience-design/fixtures/positive/complete-setup.json",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "contract-source-shape",
      "command": "node tooling/scripts/experience-design/experience-design.mjs validate-sources",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Closed schemas reject unknown fields, empty material collections, unresolved references, orphans and partial Journey coverage",
    "Rule Catalog and UI Grammar are validated as independent canonical inputs",
    "Contract, candidate, evidence and expectation authors bind to verified signed digests",
    "Validation is read-only, deterministic and emits stable structured errors"
  ],
  "failureBehavior": [
    "Do not infer missing Product Intent or repair caller input",
    "Do not accept unsigned or author-mismatched material cases",
    "Do not embed Rule Catalog or UI Grammar duplicates in evaluator source"
  ],
  "updatedAt": "2026-10-18T15:49:22.000Z"
}
```

## Closure

This closure establishes the only legal input boundary. It may include fixture
signing keys owned solely by tests, but no repository production private key.

## Current Snapshot

Frozen contract only. Execution state and evidence remain outside this file.
