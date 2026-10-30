# UI-F07 — 框架收益独立比较

独立样本和审核人就绪后再执行；不得由样本作者生成独立评审身份。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028", "taskId": "UI-F07", "workstreamId": "UI",
  "title": "框架收益独立比较", "workClass": "refactor", "completionClass": "source",
  "executionMode": "build", "closureId": "ui-framework-outcome",
  "journeyId": "UI-AGENT-DESIGN-BENEFIT", "runtimeClass": "source-only",
  "writeSet": ["docs/architecture/platform/client/ui-system/execution-plans/20261028-ui-system/outcome-comparison.md"],
  "readSet": ["docs/architecture/engineering/experience-design", "docs/client/common/ui-identity", "packages/ui/contracts"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [{"id": "UI-F07-source", "command": "node tooling/scripts/experience-design/experience-design.mjs check", "verificationClass": "SOURCE_CHECK"}],
  "doneWhen": ["按既有CER冻结相同任务/Oracle/Context，收集独立A/B与blind review", "选择、评审、纠偏与执行的真实效果分别记录当前证据、成本与偏差", "canonical source check只证明工具，不证明框架收益"],
  "failureBehavior": ["缺少可比证据或独立审核保持UNPROVEN", "不修改Oracle以适配候选，不继承旧PASS"],
  "updatedAt": "2026-10-28T08:00:00.000Z"
}
```
