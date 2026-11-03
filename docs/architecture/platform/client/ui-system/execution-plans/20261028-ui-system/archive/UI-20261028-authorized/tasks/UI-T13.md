# UI-T13 — 统一切换与旧路径删除

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T13",
  "workstreamId": "UI",
  "title": "统一切换与旧路径删除",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-foundation-cutover",
  "journeyId": "UI-J13",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages"
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
      "id": "UI-T13-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure foundation-cutover",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T13-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure foundation-cutover",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T13-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure foundation-cutover",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "零高层供应商、旧包、双主题和未登记导出",
    "Gate UI-GATE-BOUNDARY 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
