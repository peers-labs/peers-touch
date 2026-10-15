# FLOW-06：完整工具闭环与现场验证准备

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-06",
  "workstreamId": "FLOW-PROOF",
  "title": "用合成 workspace 夹具证明无 Hook、隔离、恢复与真实运行保护",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "flow-end-to-end",
  "journeyId": "DEV-J01—DEV-J07",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/local-dev/development-flow.integration.test.mjs",
    "tooling/acceptance/gates.yaml",
    "tooling/acceptance/gates",
    "tooling/acceptance/tests",
    "docs/architecture/engineering/development-workflow"
  ],
  "readSet": [
    "AGENTS.md",
    "docs/README.md",
    "docs/global/workflow.md",
    "docs/architecture/engineering/local-dev",
    "docs/architecture/engineering/toolchain",
    "docs/architecture/engineering/architecture-governance",
    "docs/architecture/engineering/acceptance",
    "docs/architecture/engineering/quality",
    "docs/knowledge",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/review",
    "tooling/skills",
    "tooling/plugins/pt-ew-plugin",
    "tooling/devctl",
    "tooling/acceptance"
  ],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 600, "cleanupSeconds": 60},
  "checks": [
    {
      "id": "flow-structure",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate && bash tooling/scripts/review/skill-check.sh",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "flow-functional",
      "command": "node --test tooling/scripts/local-dev/development-flow.integration.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "flow-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-flow-tool-e2e --gate machine-dev-registry-self --gate development-workflow-control-plane --gate acceptance-workflow-contract --gate acceptance-runtime-provisioning-self",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "development-flow.integration.test.mjs 以独立 test case 覆盖 FLOW-A01—A04、A06—A20，每项含前置动作、二元断言和失败时的 scenario ID",
    "development-flow-tool-e2e Gate 直接运行上述测试和 residue 检查，不能只消费调用者提供的 PASS",
    "两个合成 workspace fixture 或独立临时 Git 仓库的修改、知识、任务与安装互不串扰",
    "脏状态、冲突、恢复和验证路径中，没有用户显式要求时 git worktree add 调用次数为零",
    "真正 OS 锁和受控进程竞争、身份核对及资源释放有实际结果",
    "未授权和 stable 等拒绝在受控副作用替身中验证零执行",
    "共享 Suite 只准备一次，场景附着并按自己数据清理，启动与复用计数可审查",
    "实际消费者无旧机制活引用，正式 Gate 与规范合同一致",
    "真实宿主 smoke 保持支持性诊断，不成为 completion/full Gate",
    "FLOW-A05 与实际 Profile/远端/Native 现场场景分别标记，工具证明不扩大为产品证明"
  ],
  "failureBehavior": [
    "测试只使用临时目录、合成 workspace fixture 或独立临时 Git 仓库，不调用 git worktree add，也不读取或操作现有目标外工作区",
    "不连接真实 Station、不创建环境、不重置 stable、不占用真实设备或前台",
    "工具替身和 framework PASS 不替代业务验收",
    "证据缺失、过期或 Gate 不支持时报告具体缺口，不降低断言",
    "问题归还对应实施项修复，不在集成测试旁增加兼容补丁"
  ],
  "updatedAt": "2026-10-14T00:00:00.000Z"
}
```

## 完整闭环

本项新增的 integration test 是未来工具测试，使用真实 CLI、临时目录、合成
workspace fixture、独立临时 Git 仓库、OS 锁和受控进程完成使用者入口验证；
禁止调用 `git worktree add`。每个 FLOW-A 场景必须是独立 test case，测试名带
scenario ID，不能用字符串存在、总退出码或单一 happy path 代替。它不是浏览器或
Native 业务验收。
正式 Gate 复用既有 runner 并保存当前源码证据。

需要诊断宿主差异时，现场 smoke 另行声明目标、授权范围、断言和收尾策略；未执行
只表示该宿主未观察，不阻塞工具闭环。

## Current Snapshot

稳定义务：工具场景与支持性现场观察分别表达；本文件不记录运行状态或证据。
