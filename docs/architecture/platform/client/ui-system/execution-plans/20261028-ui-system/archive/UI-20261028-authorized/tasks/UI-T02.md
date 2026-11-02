# UI-T02 — 选择与表单草稿

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T02",
  "workstreamId": "UI",
  "title": "选择与表单草稿",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-selection",
  "journeyId": "UI-J2",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages/ui"
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
      "id": "UI-T02-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure selection",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T02-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure selection",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T02-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure selection",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "键盘选择、校验、草稿回读与失败保留",
    "Gate UI-GATE-SPECIMEN 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
