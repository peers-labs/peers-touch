# UI-T06 — 既有实体投影复用

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T06",
  "workstreamId": "UI",
  "title": "既有实体投影复用",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-domain-views",
  "journeyId": "UI-J6",
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
      "id": "UI-T06-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure domain-views",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T06-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure domain-views",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T06-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure domain-views",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "相同实体同一语义与原 Owner action",
    "Gate UI-GATE-JOURNEY 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
