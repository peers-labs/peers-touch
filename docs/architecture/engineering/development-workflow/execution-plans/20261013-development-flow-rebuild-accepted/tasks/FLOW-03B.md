# FLOW-03B：Acceptance 与质量消费者独立

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "DWF-REBUILD-20261013",
  "taskId": "FLOW-03B",
  "workstreamId": "FLOW-EVIDENCE",
  "title": "Acceptance 与质量工具使用明确范围和正式证据",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "acceptance-evidence-independent",
  "journeyId": "DEV-J05",
  "runtimeClass": "source-only",
  "writeSet": [
    "tooling/scripts/acceptance-run.py",
    "tooling/scripts/review",
    "tooling/make/acceptance.mk",
    "tooling/make/review.mk",
    "tooling/scripts/acceptance-gap-detect.py",
    "tooling/scripts/acceptance-gap-detect-test.py",
    "tooling/scripts/quality-evidence.py",
    "tooling/scripts/quality-evidence-test.py",
    "tooling/acceptance",
    "tooling/development/secure_content",
    "tooling/skills/pt-quality-check",
    "tooling/skills/pt-github-review",
    "tooling/skills/pt-github-pr",
    "tooling/skills/pt-acceptance-gap-detector",
    "docs/architecture/engineering/development-workflow",
    "docs/architecture/engineering/acceptance",
    "docs/architecture/engineering/quality"
  ],
  "readSet": [
    "docs/knowledge",
    "tooling/scripts/local-dev",
    "tooling/scripts/plan/plan-package.mjs",
    "tooling/scripts/plan/planctl.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 300,
    "functionalRunSeconds": 300,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "acceptance-evidence-source",
      "command": "python3 tooling/scripts/acceptance-run-test.py && python3 -m unittest tooling.acceptance.tests.test_execution_plan && python3 tooling/scripts/quality-evidence-test.py",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "acceptance-evidence-functional",
      "command": "python3 tooling/scripts/acceptance-gap-detect-test.py && python3 tooling/scripts/acceptance-infra-boundary-test.py && python3 tooling/scripts/quality-evidence-test.py",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "acceptance-evidence-formal",
      "command": "python3 tooling/scripts/acceptance-run.py --gate acceptance-infra-validation --gate acceptance-plan-self --gate acceptance-workflow-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "Acceptance runner、Gap Detector、Quality、PR review 和 schema 激活无需 OWNER、登记、mount 或成功 Session",
    "Acceptance runner 与 Gap Detector 直接拥有各自显式范围，不存在独立 admission owner",
    "无 Plan 时显式接收需求范围和完成义务，有 Plan 时只读取调用者明确提供的版本",
    "当前源码、产物、义务及证据摘要由规范 owner 读取，伪造、旧证据和任意 caller PASS 不能通过",
    "正式证明仍由 Acceptance 正式入口产生，framework 自测和业务通过分别呈现",
    "业务 Acceptance 的环境、运行时和断言强度保持不变，Infra 不替业务补造证明",
    "FLOW-A16、A17、A19 的消费者回归和证据边界通过"
  ],
  "failureBehavior": [
    "不为校验补造身份、计划、PASS、mock 业务证明或改写机器证据",
    "不以可选记录缺失拒绝普通工作，不以审查通过推导发布权限",
    "业务缺口交给业务 owner，Acceptance Infra 不降低断言或伪造当前源码证明",
    "未迁移调用保留为待处理缺口，不把 framework PASS 当成产品 PASS"
  ],
  "updatedAt": "2026-10-14T00:00:00.000Z"
}
```

## 完整闭环

从 Acceptance runner、Gap Detector、Quality evidence、PR review 和
`tooling/development/secure_content` 的实际调用进入，解除开发登记依赖。
修改只覆盖准入输入和证据连接，既有业务场景、运行时与 receiver-visible
断言保持不变。

## Current Snapshot

固定合同引用：FLOW-A16、A17、A19。结果由当前源码检查和正式 Gate 产生。
