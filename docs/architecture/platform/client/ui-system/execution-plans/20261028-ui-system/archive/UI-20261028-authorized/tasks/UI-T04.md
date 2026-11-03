# UI-T04 — 结构化内容与大列表

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T04",
  "workstreamId": "UI",
  "title": "结构化内容与大列表",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-structured-content",
  "journeyId": "UI-J4",
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
      "id": "UI-T04-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure structured-content",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T04-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure structured-content",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T04-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure structured-content",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "极端数据、稳定轨道和可访问读取",
    "Gate UI-GATE-SPECIMEN 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
