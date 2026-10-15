# FLOW-02：可选任务、明确计划与恢复

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-02",
  "workstreamId": "FLOW-TASKS",
  "title": "复杂任务可选记录与恢复不占用整个工作区",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "optional-task-recovery",
  "journeyId": "DEV-J02",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/local-dev/dev-work.mjs",
    "tooling/scripts/local-dev/dev-work.test.mjs",
    "tooling/scripts/local-dev/task-progress-store.mjs",
    "tooling/scripts/local-dev/development-close.mjs",
    "tooling/scripts/local-dev/development-close.test.mjs",
    "tooling/scripts/plan",
    "tooling/skills/pt-plan-and-document",
    "tooling/skills/pt-architecture-execution-methodology",
    "docs/architecture/engineering/development-workflow/data-model.md"
  ],
  "readSet": [
    "docs/architecture/engineering/development-workflow",
    "docs/knowledge",
    "tooling/scripts/local-dev",
    "tooling/acceptance"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 30},
  "checks": [
    {
      "id": "task-source",
      "command": "node --test tooling/scripts/plan/planctl.test.mjs tooling/scripts/local-dev/dev-work.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "task-recovery",
      "command": "node --test tooling/scripts/local-dev/dev-work.test.mjs tooling/scripts/local-dev/development-close.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "task-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "小改动和明确 no-Plan 不建立任务或替代计划记录",
    "复杂任务使用 worktree 内单一 checksum 原子快照，不新增事件账本或机器总账",
    "同工作区多任务明确选择且分别短锁写入，不按 mtime 或分支猜选",
    "原子替换中断保留旧值；损坏 JSON 或 checksum 不自动补成功，也不阻止无关任务",
    "计划文档与进度分离，查询和使用不需要 PlanMount",
    "收尾只跟踪本任务操作和实际资源，解除全工作区新任务守卫",
    "任务完成、取消或记录损坏不封存 worktree；固定 worktree 核对当前源码与实际资源后可承接下一任务",
    "FLOW-A02、A07—A10、A15 的工具合同回归通过"
  ],
  "failureBehavior": [
    "不修改本机历史记录，不导入旧 PASS，不自动迁移其他任务",
    "副作用结果未知先查目标或幂等结果，禁止盲目再次执行",
    "不以记录损坏或聊天结束自动释放真实资源",
    "尚有活引用的旧模块留到其消费者迁移后删除，不加兼容新入口",
    "任务 schema 或计划结构通过不表示运行环境和用户功能通过"
  ],
  "updatedAt": "2026-10-14T00:00:00.000Z"
}
```

## 完整闭环

本项把已有开始、更新、查询和收尾入口改为可选任务用途，复用存储原语。
先通过多任务和中断恢复，再移交审查、状态及 Acceptance 消费者给 FLOW-03；
旧总账与 mount 的最终删除归 FLOW-04，避免未迁移消费者断裂。

## Current Snapshot

固定合同引用：FLOW-A02、A07—A10、A15。无持久进度与证据写入本文件；
各检查需在实现后按实际目标源码执行。
