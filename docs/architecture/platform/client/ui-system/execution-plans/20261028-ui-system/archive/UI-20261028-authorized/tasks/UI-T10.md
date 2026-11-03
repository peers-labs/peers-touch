# UI-T10 — 关系、权限与设备决策

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T10",
  "workstreamId": "UI",
  "title": "关系、权限与设备决策",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-decisions",
  "journeyId": "UI-J10",
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
      "id": "UI-T10-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure decisions",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T10-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure decisions",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T10-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure decisions",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "等待、过期、其它设备处理与真实业务终态",
    "Gate UI-GATE-JOURNEY 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
