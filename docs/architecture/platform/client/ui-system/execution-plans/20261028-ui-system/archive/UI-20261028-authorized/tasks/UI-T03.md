# UI-T03 — 浮层与导航

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T03",
  "workstreamId": "UI",
  "title": "浮层与导航",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-overlay-navigation",
  "journeyId": "UI-J3",
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
      "id": "UI-T03-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure overlay-navigation",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T03-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure overlay-navigation",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T03-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure overlay-navigation",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "堆叠、焦点、anchor、escape 和 dirty dismiss",
    "Gate UI-GATE-SPECIMEN 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
