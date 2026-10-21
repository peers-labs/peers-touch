# RD-T06 — Module Activation And Governance Registration

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "RD-20261021",
  "taskId": "RD-T06",
  "workstreamId": "RD",
  "title": "Flip release-distribution docs to active, cross-link install docs, and register the module projection",
  "workClass": "documentation",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "rd-module-activation",
  "journeyId": "RD-J06",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/release-distribution",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/README.md",
    "docs/global/local-dev-environment.md"
  ],
  "readSet": [
    "tooling/scripts/architecture/module-governance.mjs"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 1, "cleanupSeconds": 60},
  "checks": [
    {"id": "rd-t06-module-governance", "command": "node tooling/scripts/architecture/module-governance.mjs validate", "verificationClass": "SOURCE_CHECK"},
    {"id": "rd-t06-plan-validate", "command": "make plan-validate PLAN=docs/architecture/engineering/release-distribution/execution-plans/20261021-release-distribution-v1/plan.md", "verificationClass": "SOURCE_CHECK"}
  ],
  "doneWhen": [
    "All five module documents carry Status: active and match the registered module status; plan package remains valid.",
    "architecture-modules.json contains module release-distribution with characteristics ownership/moduleLayout/crossRuntime/integration=true and requiredDocuments README/design/decisions/module-layout/integration.",
    "governedPaths are existing non-overlapping paths: the module docs directory, .github/workflows/release.yml, tooling/distribution; tooling/docker and deploy-station.yml are NOT claimed (shared owners).",
    "Capability entries use existing contractRoots/consumers under governed paths; decisionIds list RD-D01..RD-D14.",
    "docs/README.md index entry is changed from draft wording to active; local-dev-environment.md gains a cross-reference to the user install docs.",
    "module governance validator and plan-validate both pass."
  ],
  "failureBehavior": [
    "If any governed path does not yet exist, keep the module draft; never register projected-but-absent capabilities.",
    "Do not claim tooling/docker ownership to satisfy validation; integration.md already records those as cross-module effects."
  ],
  "updatedAt": "2026-10-21T00:00:00.000Z"
}
```

## Scope Notes

- 对应文档标准 §7.1 与 module-layout.md 注册约束。
- 纯治理文档闭环：Acceptance closure 为空 Gate 列表，无运行时 Gate、无完成证明。
- 仅在 RD-T02/T04/T05 全部完成且产物路径真实存在后执行。

## Current Snapshot

- Precondition: RD-T02, RD-T04, RD-T05 done; governed paths exist.
- Produces: active module docs, one positive registry projection, doc cross-links.
