# UI-T05 — 媒体与编辑能力

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-T05",
  "workstreamId": "UI",
  "title": "媒体与编辑能力",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-media-editing",
  "journeyId": "UI-J5",
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
      "id": "UI-T05-source",
      "command": "node tooling/scripts/ui-system/check.mjs --closure media-editing",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "UI-T05-journey",
      "command": "node tooling/scripts/ui-system/journey.mjs --closure media-editing",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "UI-T05-proof",
      "command": "node tooling/scripts/ui-system/prove.mjs --closure media-editing",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "engine 边界、解析安全、取消与资源释放",
    "Gate UI-GATE-BOUNDARY 的 required scope 有当前源码证据；缺口仍 UNPROVEN。"
  ],
  "failureBehavior": [
    "预算到期冻结已观察证据并清理；修复 Owner 后只重跑受影响 scope。",
    "不把样本结果推广到未验证平台和业务对象。"
  ],
  "updatedAt": "2026-10-28T00:00:00.000Z"
}
```
