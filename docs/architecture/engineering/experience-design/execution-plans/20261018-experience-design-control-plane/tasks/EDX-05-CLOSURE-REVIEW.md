# EDX-05: Current-Source Closure Review

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "EDX-20261018",
  "taskId": "EDX-05-CLOSURE-REVIEW",
  "workstreamId": "EDX-REVIEW",
  "title": "Review, remediate and checkpoint the atomic Experience Design cutover",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "closure-review",
  "journeyId": "EDX-J05",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/architecture/engineering/experience-design",
    "docs/client/common/interaction-design-methodology.md",
    "docs/client/common/ui-identity/grammar-bindings.json",
    "tooling/scripts/experience-design",
    "tooling/skills/pt-product-design-methodology",
    "tooling/skills/pt-prototype-design",
    "tooling/skills/pt-quality-check"
  ],
  "readSet": [
    "tooling/scripts/review/code_structure_decision.py",
    "tooling/scripts/local-dev/completion-review.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 120,
    "cleanupSeconds": 20
  },
  "checks": [
    {
      "id": "frozen-plan-validation",
      "command": "uv run --with PyYAML==6.0.2 make plan-validate PLAN=docs/architecture/engineering/experience-design/execution-plans/20261018-experience-design-control-plane/plan.md",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "module-registry-validation",
      "command": "uv run --with PyYAML==6.0.2 node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "code-structure-decision",
      "command": "python3 tooling/scripts/review/code_structure_decision.py verify --range HEAD",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "completion-audit",
      "command": "node tooling/scripts/local-dev/completion-review.mjs assess --repo-root \"$PWD\" --scope-paths 'docs/README.md,docs/architecture/engineering/README.md,docs/architecture/engineering/architecture-governance/architecture-modules.json,docs/architecture/engineering/experience-design,docs/client/common,tooling/scripts/architecture/module-governance.test.mjs,tooling/scripts/experience-design,tooling/skills/pt-product-design-methodology,tooling/skills/pt-prototype-design,tooling/skills/pt-quality-check' --obligations '[\"Experience Design contract intake\",\"Wireflow findings\",\"Evidence and blind integrity\",\"Product Prototype Quality cutover\"]' --evidence \"$(cat /tmp/experience-design-completion-evidence.json)\" --findings \"$(cat /tmp/experience-design-completion-findings.json)\"",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "control-plane-functional",
      "command": "node tooling/scripts/experience-design/experience-design.mjs check",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Frozen Plan and active module registry validate against current source",
    "Independent code-structure review has no blocking finding",
    "Completion audit has no source-backed P0 or P1 finding",
    "All source and functional checks pass on the exact pre-checkpoint workspace digest",
    "One local checkpoint contains the complete cutover and no unrelated file"
  ],
  "failureBehavior": [
    "Do not record a PASS decision before reading every authored file",
    "Do not treat completion-review input generation as product or runtime proof",
    "Do not create multiple partial commits or amend unrelated history",
    "Do not push, open a PR or claim blind acceptance"
  ],
  "updatedAt": "2026-10-18T15:49:22.000Z"
}
```

## Closure

The review owner records findings against the uncommitted workspace, remediates
them, reruns affected checks, then creates one local checkpoint. User-facing
blind acceptance remains a separate next-day activity.

## Current Snapshot

Frozen contract only. Execution state and evidence remain outside this file.
