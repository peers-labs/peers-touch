# UI-T15 — 独立用途比较

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T15",
  "workstreamId": "UI",
  "title": "独立用途比较",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-usefulness",
  "journeyId": "UI-J15",
  "runtimeClass": "source-only",
  "writeSet": [
    "docs"
  ],
  "readSet": [
    "docs/architecture/platform/client/ui-system",
    "packages/ui"
  ],
  "budgets": {
    "focusedCheckSeconds": 180,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "UI-T15-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure usefulness",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T15-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure usefulness",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T15-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure usefulness",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "冻结新 cohort、盲审、真实效果和成本，可证伪结果",
    "Gate UI-GATE-USEFULNESS 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
