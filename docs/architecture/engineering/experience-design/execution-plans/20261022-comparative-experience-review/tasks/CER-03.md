# CER-03：Control Plane Atomic Cutover

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CER-20261022",
  "taskId": "CER-03",
  "workstreamId": "CONTROL-PLANE-CUTOVER",
  "title": "原子接入 CER CLI、校准、Skills、active docs 与 capability registry",
  "workClass": "infrastructure",
  "completionClass": "source",
  "executionMode": "build",
  "closureId": "cer-control-plane-cutover",
  "journeyId": "experience.compare.same-journey",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs/architecture/engineering/experience-design",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "docs/architecture/README.md",
    "docs/architecture/references.md",
    "docs/client/common/interaction-design-methodology.md",
    "tooling/scripts/architecture/module-governance.test.mjs",
    "tooling/scripts/experience-design/comparative-calibration.mjs",
    "tooling/scripts/experience-design/comparative-calibration.test.mjs",
    "tooling/scripts/experience-design/fixtures/comparative",
    "tooling/scripts/experience-design/source-version.mjs",
    "tooling/scripts/experience-design/source-version.test.mjs",
    "tooling/scripts/experience-design/integration.test.mjs",
    "tooling/skills/pt-product-design-methodology/SKILL.md",
    "tooling/skills/pt-prototype-design/SKILL.md",
    "tooling/skills/pt-quality-check/SKILL.md",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [
    "docs/architecture/engineering/quality",
    "docs/knowledge/pitfalls/experience-review-binding-and-graph-closure.md",
    "tooling/scripts/architecture/module-governance.mjs",
    "tooling/scripts/experience-design/calibration.mjs",
    "tooling/scripts/experience-design/holdout.mjs"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 600,
    "cleanupSeconds": 60
  },
  "checks": [
    {
      "id": "cer03-control-plane",
      "command": "node tooling/scripts/experience-design/experience-design.mjs check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "cer03-tests",
      "command": "node --test tooling/scripts/experience-design/*.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "cer03-governance",
      "command": "env PATH=/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.cargo/bin:/opt/homebrew/bin node --test tooling/scripts/architecture/module-governance.test.mjs",
      "verificationClass": "SOURCE_CHECK"
    }
  ],
  "doneWhen": [
    "canonical CLI 暴露 compare validate/evaluate/blind-review/disposition-review/project-target，未知或阶段错误参数 fail closed",
    "control-plane source digest 包含所有 comparative implementation files",
    "positive、negative、boundary comparative fixtures 被 canonical check 执行并精确匹配期望",
    "Product、Prototype 和 Quality Skills 只消费 canonical CER source，不复制 schema、priority 或 disposition 规则",
    "architecture registry 登记唯一 experience.design.compare capability、owner、contract roots、consumers 和 evidence boundary",
    "README、design、decisions、data-model、module-layout、integration 与 comparative guide 同步为 active current source",
    "tree-wide search 不存在第二套 compare evaluator、legacy alias、compatibility shim 或声称 blind A/B PASS 的文本",
    "framework incremental-value 状态仍为 UNPROVEN，并明确下一步需要 external sealed blind A/B"
  ],
  "failureBehavior": [
    "不因 source checks 通过而把 framework value、future comparison quality 或 product readiness 标记为 PASS",
    "不把 calibration fixture 当 fresh holdout",
    "不引入 host-specific browser、credential 或 evidence mutation 到 evaluator",
    "若 active docs、registry、Skills 或 source digest 任一未同步，则 atomic cutover 未完成"
  ],
  "updatedAt": "2026-10-22T03:00:00.000Z"
}
```

## 完整闭环

本 Task 让 CER 成为 Product、Prototype、Review 与 Quality 共用的一个入口，并用
source-only 证据证明机制闭合。外部 sealed blind A/B 是后续独立证明活动，不在
本地校准中伪造。
