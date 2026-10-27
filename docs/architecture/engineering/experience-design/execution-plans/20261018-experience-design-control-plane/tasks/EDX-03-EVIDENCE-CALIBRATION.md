# EDX-03: Evidence, Review And Calibration Integrity

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "EDX-20261018",
  "taskId": "EDX-03-EVIDENCE-CALIBRATION",
  "workstreamId": "EDX-EVIDENCE",
  "title": "Match exact evidence cells and protect independent blind review",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "evidence-calibration",
  "journeyId": "EDX-J03",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/experience-design"
  ],
  "readSet": [
    "docs/architecture/engineering/experience-design",
    "docs/client/common/ui-identity/grammar-bindings.json"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 90,
    "cleanupSeconds": 10
  },
  "checks": [
    {
      "id": "evidence-review-unit",
      "command": "node --test tooling/scripts/experience-design/evidence.test.mjs tooling/scripts/experience-design/review-receipt.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "calibration-suite",
      "command": "node tooling/scripts/experience-design/experience-design.mjs calibrate",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "holdout-isolation",
      "command": "node --test tooling/scripts/experience-design/holdout.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Evidence matches exact source/artifact digest, platform, runtime, input, locale, viewport, resolved theme, content, state and assertion cells",
    "Performance evidence matches requirement-owned environment, workload, method, sample policy and percentile",
    "Ed25519 author and review attestations validate through explicit trusted issuer keys",
    "Accepted review requires a ready evaluator result, complete finding binding and zero blocking independent findings",
    "Holdout IDs bind to one immutable case/result/review chain and calibration never discovers holdouts",
    "Positive, negative and boundary expectations match the exact rule and finding sets"
  ],
  "failureBehavior": [
    "Do not ship a repository private review key",
    "Do not infer visual quality from artifact existence",
    "Do not promote a changed or reused holdout ID",
    "Do not let one preserving recovery branch hide another data-losing branch"
  ],
  "updatedAt": "2026-10-18T15:49:22.000Z"
}
```

## Closure

This closure proves evidence integrity and calibration mechanics. It does not
produce tomorrow's independent blind review or certify an unseen design.

## Current Snapshot

Frozen contract only. Execution state and evidence remain outside this file.
