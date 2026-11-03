# UI-F03 — 基础组件逐项样本

执行需要基础确认和本批明确推进；本闭包限已选定的一批基础组件。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028", "taskId": "UI-F03", "workstreamId": "UI",
  "title": "基础组件逐项样本", "workClass": "refactor", "completionClass": "functional",
  "executionMode": "build", "closureId": "ui-basic-specimens",
  "journeyId": "UI-BASIC-SPECIMEN-REVIEW", "runtimeClass": "service",
  "writeSet": ["packages/prototypes/shared/ui-system", "packages/ui/web", "docs/architecture/platform/client/ui-system/prototype"],
  "readSet": ["packages/ui/contracts", "docs/client/common/ui-identity"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F03-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F03-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": ["本批组件绑定已确认基础、目录ID、使用合同和禁用模式", "完成本批真实显示证据；明确认可才解锁下一批", "多个批次需要新versionId，禁止借一个Task宣称20项全通过"],
  "failureBehavior": ["尚未确认的组件不替换消费者", "无法在预算内关闭本批则先修订拆分Task"],
  "updatedAt": "2026-10-28T08:00:00.000Z"
}
```
