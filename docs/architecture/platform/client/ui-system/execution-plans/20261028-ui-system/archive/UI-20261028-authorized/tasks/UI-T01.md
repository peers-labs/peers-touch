# UI-T01 — 具名动作与单边界字段

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T01",
  "workstreamId": "UI",
  "title": "具名动作与单边界字段",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-foundation",
  "journeyId": "UI-J1",
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
      "id": "UI-T01-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure foundation",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T01-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure foundation",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T01-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure foundation",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "动作、IME、错误关联和 disabled reason 可操作",
    "Gate UI-GATE-SPECIMEN 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
