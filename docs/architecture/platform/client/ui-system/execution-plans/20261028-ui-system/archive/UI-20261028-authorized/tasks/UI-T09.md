# UI-T09 — 消息与附件恢复

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T09",
  "workstreamId": "UI",
  "title": "消息与附件恢复",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-messaging",
  "journeyId": "UI-J9",
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
      "id": "UI-T09-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure messaging",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T09-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure messaging",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T09-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure messaging",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "身份、发送、接收回读、滚动与资源生命周期",
    "Gate UI-GATE-JOURNEY 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
