# UI-F04 — 高级组合逐批样本

执行需要基础组件确认及选定批次；业务语义仍由业务模块拥有。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028", "taskId": "UI-F04", "workstreamId": "UI",
  "title": "高级组合逐批样本", "workClass": "refactor", "completionClass": "functional",
  "executionMode": "build", "closureId": "ui-advanced-specimens",
  "journeyId": "UI-ADVANCED-SPECIMEN-REVIEW", "runtimeClass": "service",
  "writeSet": ["packages/prototypes/shared/ui-system", "docs/architecture/platform/client/ui-system/prototype"],
  "readSet": ["packages/ui/contracts", "docs/client/common/ui-identity", "docs/architecture/engineering/experience-design"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F04-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F04-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["选定批次具备组合理由、禁止模式、极值和真实视觉证据", "确认仅适用于对应批次；未制作的89高级/21业务项仍未证明"],
  "failureBehavior": ["不复制业务projection/action/协议", "新批次先修订frozen Task，未确认不推进"],
  "updatedAt": "2026-10-28T08:00:00.000Z"
}
```
