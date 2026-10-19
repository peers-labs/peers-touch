# EDX-02: Wireflow Evaluator

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "EDX-20261018",
  "taskId": "EDX-02-WIREFLOW-EVALUATOR",
  "workstreamId": "EDX-EVALUATOR",
  "title": "Evaluate semantics, hierarchy, path, state, action, trace and drift",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "wireflow-evaluation",
  "journeyId": "EDX-J02",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/experience-design"
  ],
  "readSet": [
    "docs/architecture/engineering/experience-design",
    "docs/architecture/agent/lark",
    "packages/prototypes/mobile/chat"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 90,
    "cleanupSeconds": 10
  },
  "checks": [
    {
      "id": "wireflow-rules-unit",
      "command": "node --test tooling/scripts/experience-design/evaluator.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "semantic-regression-evaluation",
      "command": "node tooling/scripts/experience-design/experience-design.mjs evaluate tooling/scripts/experience-design/fixtures/negative/semantic-redundancy.json --expect-disposition changes-required",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "drift-regression-evaluation",
      "command": "node tooling/scripts/experience-design/experience-design.mjs evaluate tooling/scripts/experience-design/fixtures/negative/lark-contract-drift.json --expect-disposition changes-required",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Concept budgets catch semantic repetition while legal accessibility, safety and separated-context repetition remains valid",
    "Every surface has one accepted main subject and owned regions",
    "Path cost derives from one contiguous start-to-success chain and checks every dimension independently",
    "Every recoverable branch validates action, preservation, focus, return and authority reconciliation",
    "Action tuple validates risk, mutation, representation, adapter, confirmation and server authority proof",
    "Trace and drift detect inserted, removed, reordered or changed required states and actions",
    "Disposition and owners derive only from rules.json"
  ],
  "failureBehavior": [
    "Do not use lexical similarity as a semantic verdict",
    "Do not trust candidate-authored aggregate path cost",
    "Do not patch accepted contracts from evaluator findings",
    "Do not treat calibration detection as blind generalization proof"
  ],
  "updatedAt": "2026-10-18T15:49:22.000Z"
}
```

## Closure

The evaluator emits findings and derived costs only. It cannot create a review
receipt, change a fixture expectation or return `passed`.

## Current Snapshot

Frozen contract only. Execution state and evidence remain outside this file.
