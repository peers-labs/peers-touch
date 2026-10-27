# EDX-04: Product, Prototype And Quality Cutover

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "EDX-20261018",
  "taskId": "EDX-04-WORKFLOW-CUTOVER",
  "workstreamId": "EDX-CUTOVER",
  "title": "Adopt the control plane without a parallel design authority",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "workflow-cutover",
  "journeyId": "EDX-J04",
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
    "docs/architecture/agent/lark",
    "packages/prototypes/mobile/chat",
    "tooling/scripts/review/skill-check.sh"
  ],
  "budgets": {
    "focusedCheckSeconds": 240,
    "functionalRunSeconds": 120,
    "cleanupSeconds": 20
  },
  "checks": [
    {
      "id": "skill-integration",
      "command": "node --test tooling/scripts/experience-design/integration.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "experience-control-plane",
      "command": "node tooling/scripts/experience-design/experience-design.mjs check",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "skill-governance",
      "command": "tooling/scripts/review/skill-check.sh",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "architecture-governance",
      "command": "uv run --with PyYAML==6.0.2 node --test tooling/scripts/architecture/module-governance.test.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "Product Design emits the canonical semantic, IA, path, state, action and evidence contract for material UI",
    "Prototype Design requires evaluated Wireflow before high fidelity and preserves trace plus UNPROVEN cells",
    "Quality Check reports Experience findings, independent review status and evidence gaps without approving them",
    "Skills cite canonical sources and contain no copied Rule Catalog or UI Grammar",
    "Experience integration tests enforce canonical Skill markers while the existing shared skill-check remains green",
    "Module registry atomically adds evaluator paths, consumers and experience.design.evaluate capability only after all checks pass"
  ],
  "failureBehavior": [
    "Do not add a parallel pt-* design Skill",
    "Do not leave registry capability active if CLI or consumers fail",
    "Do not rewrite Product or Prototype truth from Quality review",
    "Do not claim Desktop, Mobile, Browser or production UX evidence from source tests"
  ],
  "updatedAt": "2026-10-18T15:49:22.000Z"
}
```

## Closure

This is the atomic consumer cutover. The module registry remains honest until
the CLI, fixtures and all consumers are present and verified.

## Current Snapshot

Frozen contract only. Execution state and evidence remain outside this file.
