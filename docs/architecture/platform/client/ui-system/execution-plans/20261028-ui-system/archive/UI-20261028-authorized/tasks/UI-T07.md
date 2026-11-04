# UI-T07 — 全能力 Gallery

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T07",
  "workstreamId": "UI",
  "title": "全能力 Gallery",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-gallery",
  "journeyId": "UI-J7",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages/prototypes/shared/ui-system"
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
      "id": "UI-T07-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure gallery",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T07-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure gallery",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T07-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure gallery",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "每项独立 specimen、有效反例和真实控件行为",
    "Gate UI-GATE-SPECIMEN 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
