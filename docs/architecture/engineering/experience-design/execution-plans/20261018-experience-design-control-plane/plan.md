# Experience Design Control Plane Execution Plan

> **Plan ID**: EDX-20261018
> **Version ID**: 20261018-accepted-v1
> **Created**: 2026-10-18T15:49:22.000Z
> **Owner**: Developer Experience / Product Design

本计划实现已接受的 Experience Design 架构。实现完成前，module registry 保持
`capabilities: []`，Skills 仍按当前行为运行；只有 EDX-04 原子切换通过后才登记
机器 capability 和正式 consumer。

## Goal And Boundary

北极星：让 Agent 在进入高保真原型前，以一个闭合、可校准、可独立评审的合同
识别内容语义、信息架构、路径、状态恢复、动作表达和 contract drift，并让缺失的
视觉、动态、辅助技术或性能证据保持 `UNPROVEN`。

本计划不修改任何产品业务行为、生产 UI、Lark 产品合同或 Mobile Station
原型。已知案例只作为 calibration；明日用户提供的实际案例保留为 holdout/blind
验收，不在实现阶段预写 expectation。

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "EDX-20261018",
  "versionId": "20261018-accepted-v1",
  "createdAt": "2026-10-18T15:49:22.000Z",
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "docs/architecture/engineering/experience-design/README.md",
      "docs/architecture/engineering/experience-design/design.md",
      "docs/architecture/engineering/experience-design/decisions.md",
      "docs/architecture/engineering/experience-design/data-model.md",
      "docs/architecture/engineering/experience-design/module-layout.md",
      "docs/architecture/engineering/experience-design/integration.md"
    ],
    "decisions": [
      "EDX-D01",
      "EDX-D02",
      "EDX-D03",
      "EDX-D04",
      "EDX-D05",
      "EDX-D06",
      "EDX-D07",
      "EDX-D08"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "docs/architecture/engineering/experience-design",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/client/common/interaction-design-methodology.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/client/common/ui-identity/grammar-bindings.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/agent/lark",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "packages/prototypes/mobile/chat",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/experience-design",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/review/skill-check.sh",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/review/code_structure_decision.py",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev/completion-review.mjs",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/skills/pt-product-design-methodology",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-prototype-design",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-quality-check",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "修改产品业务行为、生产 UI、Lark 产品合同或 Mobile Station 原型",
      "让确定性 evaluator 自动批准产品、原型、代码或发布",
      "从截图文件存在推断视觉、动态、辅助技术或性能通过",
      "把已知回归案例伪装成 blind acceptance",
      "push、PR、部署、环境重置或历史改写；本地原子 checkpoint 除外"
    ]
  },
  "tasks": [
    {
      "id": "EDX-01-CONTRACT-INTAKE",
      "workstreamId": "EDX-CONTRACT",
      "path": "tasks/EDX-01-CONTRACT-INTAKE.md",
      "dependsOn": []
    },
    {
      "id": "EDX-02-WIREFLOW-EVALUATOR",
      "workstreamId": "EDX-EVALUATOR",
      "path": "tasks/EDX-02-WIREFLOW-EVALUATOR.md",
      "dependsOn": [
        "EDX-01-CONTRACT-INTAKE"
      ]
    },
    {
      "id": "EDX-03-EVIDENCE-CALIBRATION",
      "workstreamId": "EDX-EVIDENCE",
      "path": "tasks/EDX-03-EVIDENCE-CALIBRATION.md",
      "dependsOn": [
        "EDX-02-WIREFLOW-EVALUATOR"
      ]
    },
    {
      "id": "EDX-04-WORKFLOW-CUTOVER",
      "workstreamId": "EDX-CUTOVER",
      "path": "tasks/EDX-04-WORKFLOW-CUTOVER.md",
      "dependsOn": [
        "EDX-03-EVIDENCE-CALIBRATION"
      ]
    },
    {
      "id": "EDX-05-CLOSURE-REVIEW",
      "workstreamId": "EDX-REVIEW",
      "path": "tasks/EDX-05-CLOSURE-REVIEW.md",
      "dependsOn": [
        "EDX-04-WORKFLOW-CUTOVER"
      ]
    }
  ],
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed",
      "amend": "denied"
    },
    "delivery": {
      "push": "denied",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [],
      "destructiveResetScopes": []
    },
    "history": {
      "rewrite": "denied"
    }
  }
}
```

## Vertical Closures

1. **Contract intake** accepts one closed case, UI Grammar and Rule Catalog;
   verifies signatures, total references and claim-specific evidence shape; and
   emits stable structured errors without mutation.
2. **Wireflow evaluation** derives semantic, IA, path, state, action, trace and
   drift findings from the validated case, including known regression and
   positive/boundary controls.
3. **Evidence and calibration** performs exact evidence-cell matching,
   signed review-receipt validation, content-addressed holdout validation and
   exact three-class calibration without reading blind expectations.
4. **Workflow cutover** makes Product, Prototype and Quality Skills consume the
   canonical methodology/CLI, adds governance checks, then atomically registers
   the evaluator capability and consumers.
5. **Closure review** binds Plan/module validation, code-structure review and
   completion audit to current source, remediates findings, then creates the
   single local atomic-cut checkpoint.

## Dependency DAG

```text
EDX-01-CONTRACT-INTAKE
  -> EDX-02-WIREFLOW-EVALUATOR
    -> EDX-03-EVIDENCE-CALIBRATION
      -> EDX-04-WORKFLOW-CUTOVER
        -> EDX-05-CLOSURE-REVIEW
```

## Atomic Cutover And Rollback

- Schema, Rule Catalog and Grammar validation land together; no parser accepts
  unknown fields or candidate-authored verdict/cost.
- Core evaluator lands with positive, negative and boundary fixtures for every
  enabled rule.
- Evidence/review/holdout support lands before Skills can claim the control
  plane is available.
- EDX-04 updates Skills and module registry, and runs the existing shared
  skill-check without modifying it. There is no fallback evaluator or
  duplicated rule table.
- After EDX-05 reviews pass, one local atomic-cut checkpoint is created.
  Rollback is a VCS revert of that checkpoint; no runtime toggle or
  compatibility path remains. Push and PR remain denied.

## Verification Model

All implementation proof is source-only and local:

- Node unit tests cover closed schema, references, cost derivation, graph
  reachability, action tuple, drift, evidence matching, Ed25519 signatures,
  holdout content addressing and calibration exactness.
- Known regressions prove detection only; positive and boundary cases prove the
  rules do not reject legal forms.
- Skill integration checks prove canonical references and no duplicated rule
  table.
- Module governance and Plan validation prove discoverability and ownership.

No product runtime, screenshot, Mobile, Desktop Native or field-performance
claim is made.

## Acceptance Execution

```json
{
  "closures": {
    "contract-intake": [],
    "wireflow-evaluation": [],
    "evidence-calibration": [],
    "workflow-cutover": [],
    "closure-review": []
  },
  "completion": [],
  "full": []
}
```

## Completion And Non-Claims

Completion requires all five Task checks, exact fixture calibration, known
regression detection, Skill integration, Plan validation, architecture module
governance, independent code-structure review and completion audit.

Completion does not claim that an unseen design is good. Tomorrow's practical
blind evaluation must use a holdout without expected findings, freeze its first
result, then compare it with independent human/Agent review.
