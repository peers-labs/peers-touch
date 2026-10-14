# FLOW-04：普通工作、提示与项目标准

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-04",
  "workstreamId": "FLOW-GUIDANCE",
  "title": "普通工作按规范推进且 Hook 只补充提示",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "ordinary-work-guidance",
  "journeyId": "DEV-J01",
  "runtimeClass": "source-only",
  "writeSet": [
    "AGENTS.md",
    "docs/README.md",
    "docs/global/workflow.md",
    "docs/architecture/engineering/development-workflow",
    "docs/knowledge",
    "tooling/scripts/local-dev/workflow-kernel.mjs",
    "tooling/scripts/local-dev/workflow-kernel.test.mjs",
    "tooling/scripts/local-dev/workflow-host-adapters.mjs",
    "tooling/scripts/local-dev/workflow-host-adapters.test.mjs",
    "tooling/skills/pt-dev-workflow",
    "tooling/skills/pt-god-view",
    "tooling/skills/pt-goal-orchestrator",
    "tooling/skills/pt-execution-plan-guardian",
    "tooling/skills/pt-trae-host-adapter",
    "tooling/skills/pt-cursor-host-adapter",
    "tooling/skills/pt-codex-host-adapter",
    "tooling/skills/pt-plan-and-document",
    "tooling/skills/pt-architecture-design-methodology",
    "tooling/skills/pt-architecture-execution-methodology",
    "tooling/plugins/pt-ew-plugin",
    "tooling/scripts/review/skill-check.sh"
  ],
  "readSet": [
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/install-agent-integration.sh"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 30},
  "checks": [
    {
      "id": "guidance-source",
      "command": "node --test tooling/scripts/local-dev/workflow-host-adapters.test.mjs tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "guidance-functional",
      "command": "node --test tooling/scripts/local-dev/workflow-kernel.test.mjs tooling/scripts/local-dev/workflow-host-adapters.test.mjs tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs && bash tooling/scripts/review/skill-check.sh",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "guidance-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane --gate architecture-module-governance",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "普通修改、编码 Skill 与交付自查不要求登记、OWNER、PlanMount 或总关闭回执",
    "工作组织继承产品或工程北极星并说明本次贡献，不用流程状态、任务数量或 Gate 数量替代结果",
    "没有用户显式要求时，任何 Skill、Hook、计划或恢复路径都不创建 worktree",
    "Hook 只注入当前规范与相关知识，未知事件、缺失身份及内部故障中性退出",
    "Hook 只输出 ALLOW、CONTEXT 或 NOOP；无调用方的 shell intent 分类模块已删除",
    "明确工作区和写入范围继续核对，不声称 Hook 是任意 shell 沙箱",
    "七步规范为唯一操作正文，AGENTS 和相关 Skill 不复制第二套状态机",
    "调度依据实际依赖与冲突，资源统一准备仍由既有 Runtime/Suite 负责",
    "治理与 Gate 正向合同同步新职责，废止知识明确替代范围",
    "FLOW-A01、A02、A04 的无 Hook 和提示降级合同回归通过"
  ],
  "failureBehavior": [
    "不改机器授权或全局 Hook，不生成 OWNER/grant 兼容记录",
    "不为精简数量删除编码、业务标准和真正资源保护",
    "源码尚有消费者的模块不可删除，其余安装消费者交 FLOW-05 集成",
    "草稿和待验收能力不标为已落地，registry 不隐藏真实合同缺口"
  ],
  "updatedAt": "2026-10-14T00:00:00.000Z"
}
```

## 完整闭环

按调用 inventory 迁移 Hook、工作组织与调度，不只改最外层 DENY。
保留事件解析和上下文，去掉 authority 构造；删除已无引用的模块及相应测试。
仍被 installer 使用的总账、binding 或 action 模块在 FLOW-05 最后迁移后删除，
本项不发布中途混合安装。

## Current Snapshot

固定合同引用：FLOW-A01、A02、A04。无 Hook 实际宿主结果交 FLOW-06，
本节只引用稳定义务，不记录执行状态或通过证据。
