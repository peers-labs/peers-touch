# UI-F02 — 确认后的基础基准

基础逐项确认与推进指令是执行前置条件；缺少任何一项不得晋升或修改 active 值。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028", "taskId": "UI-F02", "workstreamId": "UI",
  "title": "确认后的基础基准", "workClass": "refactor", "completionClass": "source",
  "executionMode": "build", "closureId": "ui-foundation-baseline",
  "journeyId": "UI-FOUNDATION-PROMOTION", "runtimeClass": "source-only",
  "writeSet": ["docs/client/common/ui-identity", "packages/ui/tokens", "packages/ui/assets"],
  "readSet": ["docs/architecture/platform/client/ui-system/prototype", "docs/architecture/engineering/experience-design"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [{"id": "UI-F02-grammar", "command": "node tooling/scripts/experience-design/experience-design.mjs check", "verificationClass": "SOURCE_CHECK"}],
  "doneWhen": ["每个晋升值对应用户明确确认来源", "语义角色、适用范围、禁止组合与例外统一归属UI Identity及闭合Grammar", "只形成基准，不迁移消费者"],
  "failureBehavior": ["确认缺失保持draft", "Grammar冲突回归原Owner，不增加平行语法"],
  "updatedAt": "2026-10-28T08:00:00.000Z"
}
```
