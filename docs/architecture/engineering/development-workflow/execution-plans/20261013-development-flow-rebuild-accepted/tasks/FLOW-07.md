# FLOW-07：宿主支持性观察

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-07",
  "workstreamId": "FLOW-ROLLOUT",
  "title": "保留可选宿主 smoke 而不建立完成门",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "fix",
  "closureId": "host-observation-support",
  "journeyId": "DEV-J03",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/development-workflow"
  ],
  "readSet": [
    "AGENTS.md",
    "docs/global/workflow.md",
    "docs/knowledge",
    "tooling/scripts/agent-integration-audit.py",
    "tooling/scripts/agent-integration-control.py",
    "tooling/scripts/install-agent-integration.sh",
    "tooling/scripts/local-dev",
    "tooling/skills",
    "tooling/plugins/pt-ew-plugin"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 180,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "host-support-source",
      "command": "make agent-integration-audit IDE=trae ROOT=\"$PWD\"",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "安装审计继续验证选定根、绝对解释器、受限 PATH 回放和非项目配置保留",
    "Hook 仅产生 ALLOW、CONTEXT 或 NOOP，不再拥有 DENY、CONTINUE 或 shell intent 分支",
    "真实宿主观察被明确标为可选支持性诊断，不进入 completion 或 full Gate",
    "仓库内真实 Hook 捕获器、证据日志和专用 local-evidence Gate 已删除",
    "未授权安装、配置修改或前台操作不因本任务而执行"
  ],
  "failureBehavior": [
    "宿主 smoke 缺失不阻塞工具闭环或普通研发",
    "需要现场诊断时另行取得精确配置范围授权",
    "现场观察不替代源码检查、运行准入或产品 Acceptance"
  ],
  "updatedAt": "2026-10-14T00:00:00.000Z"
}
```

## 完整闭环

FLOW-07 只保留宿主差异诊断说明和现有安装审计。真实启用、移除或前台操作按具体
配置范围另行授权；没有现场 smoke 时报告未观察，不影响本计划工具闭环完成。

## Current Snapshot

固定合同引用：FLOW-A05。该场景是支持性观察，不产生正式 Gate，也不改变运行权限。
