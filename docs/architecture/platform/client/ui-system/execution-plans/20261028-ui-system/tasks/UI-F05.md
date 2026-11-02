# UI-F05 — 交互与动效语法

执行限已确认外观的选定交互闭包；高保真前走既有 EDX 准入。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028", "taskId": "UI-F05", "workstreamId": "UI",
  "title": "交互与动效语法", "workClass": "refactor", "completionClass": "functional",
  "executionMode": "build", "closureId": "ui-interaction-grammar",
  "journeyId": "UI-INTERACTION-RECOVERY", "runtimeClass": "service",
  "writeSet": ["packages/prototypes/shared/ui-system", "docs/architecture/platform/client/ui-system/prototype"],
  "readSet": ["packages/ui/semantics", "docs/client/common/ui-identity", "docs/architecture/engineering/experience-design"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F05-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F05-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["所选闭包完成状态、焦点、输入保留、恢复、空间连续性与reduced-motion证据", "动效说明因果或空间归属，用户确认后才成为Agent参考"],
  "failureBehavior": ["不将Promise结果当业务成功", "缺失EDX独立准入或真实交互证据保持UNPROVEN"],
  "updatedAt": "2026-10-28T08:00:00.000Z"
}
```
