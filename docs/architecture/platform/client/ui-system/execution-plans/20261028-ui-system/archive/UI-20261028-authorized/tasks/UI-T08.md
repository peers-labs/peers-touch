# UI-T08 — 全局壳与设置

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T08",
  "workstreamId": "UI",
  "title": "全局壳与设置",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-settings-shell",
  "journeyId": "UI-J8",
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
      "id": "UI-T08-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure settings-shell",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T08-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure settings-shell",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T08-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure settings-shell",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "全局入口、保存/失败/关闭重开保持草稿",
    "Gate UI-GATE-JOURNEY 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
