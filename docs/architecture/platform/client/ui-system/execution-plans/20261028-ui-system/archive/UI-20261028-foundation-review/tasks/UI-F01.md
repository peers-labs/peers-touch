# UI-F01 — 设计基础候选展示

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-F01",
  "workstreamId": "UI",
  "title": "设计基础候选展示",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-foundation-candidates",
  "journeyId": "UI-FOUNDATION-READ-COMPARE",
  "runtimeClass": "service",
  "writeSet": ["packages/ui/tokens", "packages/ui/web/src/index.ts", "packages/prototypes/shared/ui-system", "docs/architecture/platform/client/ui-system/prototype", "docs/architecture/engineering/architecture-governance/architecture-modules.json"],
  "readSet": ["docs/client/common/ui-identity", "docs/architecture/engineering/experience-design", "packages/ui/contracts"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F01-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F01-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "现有 Frontend Eles 展示六基础维度、三方向、同内容及 draft 限制",
    "保留130项目录；原20基础外观不再作为审阅样本",
    "真实浏览验证主题、窄宽、长文案、深链、键盘与几何，并目视截图",
    "用户确认、EDX独立准入、审美品质、Agent收益仍未证明"
  ],
  "failureBehavior": ["候选不写入active token；展示失败只修本闭包", "到预算终止采集，保留UNPROVEN与清理预留；既有server留给用户审阅"],
  "updatedAt": "2026-10-28T08:00:00.000Z"
}
```
