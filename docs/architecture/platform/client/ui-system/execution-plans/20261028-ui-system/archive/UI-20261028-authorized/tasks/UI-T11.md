# UI-T11 — 其它产品和应用

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T11",
  "workstreamId": "UI",
  "title": "其它产品和应用",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-other-consumers",
  "journeyId": "UI-J11",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps"
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
      "id": "UI-T11-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure other-consumers",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T11-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure other-consumers",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T11-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure other-consumers",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "每个选择范围页面拥有完整可操作路径",
    "Gate UI-GATE-JOURNEY 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
