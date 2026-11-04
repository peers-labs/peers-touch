# UI-F06 — Agent 基准发现与选择

执行前需基础确认；沿既有 Skill/EDX 路径消费，无第二推理入口。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028", "taskId": "UI-F06", "workstreamId": "UI",
  "title": "Agent基准发现与选择", "workClass": "refactor", "completionClass": "source",
  "executionMode": "build", "closureId": "ui-agent-discovery",
  "journeyId": "UI-AGENT-SELECT-REVIEW-CORRECT", "runtimeClass": "source-only",
  "writeSet": ["tooling/skills", "docs/architecture/platform/client/ui-system", "packages/ui/contracts"],
  "readSet": ["docs/architecture/engineering/experience-design", "docs/client/common/ui-identity", "packages/prototypes/shared/ui-system"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F06-grammar", "command": "node tooling/scripts/experience-design/experience-design.mjs check", "verificationClass": "SOURCE_CHECK"},
    {"id": "UI-F06-skills", "command": "tooling/scripts/review/skill-check.sh", "verificationClass": "STRUCTURAL_CHECK"}
  ],
  "doneWhen": ["Agent可沿语义角色找到目录ID、使用/禁用合同、确认状态和样本", "缺失合同或未确认项返回draft/UNPROVEN与真实Owner", "效果仍由UI-F07独立评价"],
  "failureBehavior": ["不复制Rule Catalog、Grammar或审批状态", "未确认值不能作为accepted设计依据"],
  "updatedAt": "2026-10-28T08:00:00.000Z"
}
```
