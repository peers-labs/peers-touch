# FLOW-05：选定工作区安装与旧依赖删除

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-05",
  "workstreamId": "FLOW-INSTALL",
  "title": "安装使用绝对解释器并支持提示降级",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "selected-install",
  "journeyId": "DEV-J03",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-audit-test.py",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/local-dev/development-flow-residue.mjs",
    "tooling/scripts/local-dev/development-flow-residue.test.mjs",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan",
    "tooling/plugins/pt-ew-plugin",
    "tooling/make/setup.mk",
    "tooling/make/local-dev.mk",
    "tooling/scripts/review",
    "tooling/acceptance",
    "tooling/skills",
    "docs/architecture/engineering/development-workflow",
    "docs/architecture/engineering/architecture-governance",
    "docs/knowledge"
  ],
  "readSet": ["AGENTS.md", "docs/global/workflow.md", "tooling/devctl"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 30},
  "checks": [
    {
      "id": "legacy-residue-source",
      "command": "node --test tooling/scripts/local-dev/development-flow-residue.test.mjs && node tooling/scripts/local-dev/development-flow-residue.mjs --repo-root .",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "install-source",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "install-functional",
      "command": "python3 -m unittest tooling/scripts/agent-integration-audit-test.py && node --test tooling/plugins/pt-ew-plugin/scripts/hook-entry.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "install-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-workflow-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "既有安装与审计入口不读取 OWNER、grant、任务总账、PlanMount 和关闭准入",
    "Skill 与 Hook 可用性分别报告，提示失败不阻止 Skill 使用",
    "解释器绝对路径与引号正确，落盘命令原文在受限 PATH 中运行",
    "临时安装仅修改选定工作区，非项目配置、其他根和全局配置保持原内容",
    "空格路径、symlink 越界、多根冲突、缺解释器和安装回退回归通过",
    "剩余总账、会话 authority、Action grant、mount 和全局关闭门禁源码无消费者后删除",
    "development-flow-residue 对 Plan 负清单逐项返回零活引用，历史文档排除规则显式且受测试约束",
    "Make、registry、Skill、知识和正式文档同步删除的能力，无兼容开关或新快任务入口",
    "FLOW-A03、A06、A19、A20 的安装与切换工具合同通过"
  ],
  "failureBehavior": [
    "不安装到本机真实 IDE 或目标外 worktree，不读取目标外实现，不写共享 descriptor",
    "不删除机器历史、旧活跃任务或其他任务资源，不要求全机 idle 才能普通安装",
    "只删除已无活引用的模块，调用残留查全仓并明确排除历史资料",
    "落盘回放通过不冒充真实宿主已接受上下文",
    "安装失败保留可恢复配置并报告实际结果，不伪造 INSTALLED 回执"
  ],
  "updatedAt": "2026-10-13T00:00:00.000Z"
}
```

## 完整闭环

前四项提供已迁移消费者，本项处理 installer 最后的旧准入依赖并统一删除空壳。
复用已有安装入口与配置合并，不增加全局 Hook 或独立解释器引擎。
先在临时根检查写入归属、执行原文、失败恢复和无 Hook 工作，再交真实宿主验证。

## Current Snapshot

固定合同引用：FLOW-A03、A06、A19、A20。实际安装及宿主 proof
不在本节保存；本项只执行临时目录测试，真实 rollout 另按精确授权。
