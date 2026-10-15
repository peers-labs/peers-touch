# FLOW-03：审查与状态读取独立

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-03",
  "workstreamId": "FLOW-EVIDENCE",
  "title": "明确范围与当前源码直接支持完成审查和状态查询",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "evidence-independent",
  "journeyId": "DEV-J05",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/local-dev/completion-review.mjs",
    "tooling/scripts/local-dev/completion-review.test.mjs",
    "tooling/scripts/local-dev/workflow-snapshot.mjs",
    "tooling/scripts/local-dev/workflow-snapshot-core.mjs",
    "tooling/scripts/local-dev/workflow-snapshot.test.mjs",
    "tooling/scripts/local-dev/workflow-state-inspector.mjs",
    "tooling/scripts/local-dev/workflow-doctor.mjs",
    "tooling/scripts/local-dev/workflow-doctor.test.mjs",
    "tooling/skills/pt-completion-auditor",
    "tooling/skills/pt-context-anchor",
    "docs/architecture/engineering/development-workflow",
    "tooling/scripts/plan/planctl.mjs",
    "tooling/scripts/plan/planctl.test.mjs"
  ],
  "readSet": ["docs/knowledge", "tooling/scripts/local-dev"],
  "budgets": {"focusedCheckSeconds": 300, "functionalRunSeconds": 300, "cleanupSeconds": 30},
  "checks": [
    {
      "id": "evidence-source",
      "command": "node --test tooling/scripts/local-dev/completion-review.test.mjs tooling/scripts/local-dev/workflow-snapshot.test.mjs tooling/scripts/local-dev/workflow-doctor.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "evidence-functional",
      "command": "node --test --test-name-pattern='standalone|corrupt|stale|partial|read-only' tooling/scripts/local-dev/completion-review.test.mjs tooling/scripts/local-dev/workflow-snapshot.test.mjs tooling/scripts/local-dev/workflow-doctor.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "evidence-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate development-workflow-control-plane",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Completion Review、状态、Doctor 和 Context Anchor 无需 OWNER、登记、mount 或成功 Session",
    "无 Plan 时显式接收需求完成义务，有 Plan 时只读取明确输入",
    "当前源码、产物、义务及证据摘要由真实来源读取，伪造和旧证据不能通过",
    "状态查询一次性只读，局部不可读不抹掉其他有效事实",
    "Completion Auditor standalone 模式不读取旧 ledger，损坏机器记录不阻断当前源码审查",
    "FLOW-A09、A16、A18 回归及被替换消费者调用检查通过"
  ],
  "failureBehavior": [
    "不为了校验补造身份、计划、PASS、mock 业务证明或改写机器证据",
    "不以可选记录缺失拒绝普通工作，不以审查通过推导发布权限",
    "未迁移调用保留为待处理缺口，不把部分检查当作整体完成"
  ],
  "updatedAt": "2026-10-13T00:00:00.000Z"
}
```

## 完整闭环

沿 Completion Review、状态、Doctor、Context Anchor 和 Completion Auditor 调用
寻找旧依赖，统一改成显式范围、当前源码与证据。新旧错误夹具放临时目录。

## Current Snapshot

固定合同引用：FLOW-A09、A16、A18。本项检查计划不包含实际执行结果，
正式 Gate 命令待消费者和 registry 同步后运行。
