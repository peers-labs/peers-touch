# UI-F01 — 编辑式元素表达样本

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-F01",
  "workstreamId": "UI",
  "title": "编辑式元素表达样本",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-foundation-candidates",
  "journeyId": "UI-ELEMENT-EXPRESSION-REVIEW",
  "runtimeClass": "service",
  "writeSet": ["packages/ui/tokens", "packages/ui/web/src/index.ts", "packages/prototypes/shared/ui-system", "docs/architecture/platform/client/ui-system/prototype", "docs/architecture/engineering/architecture-governance/architecture-modules.json"],
  "readSet": ["docs/client/common/ui-identity", "docs/architecture/engineering/experience-design", "packages/ui/contracts"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F01-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F01-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "现有 Frontend Eles 默认展示按钮、分段选择、输入区、信息面板四项编辑式表达样本，明显呈现构图、排版与材质",
    "所有控件沿用现有方圆几何，候选为draft，局部演示不接业务runtime",
    "保留130项目录；原20基础外观不再作为审阅样本",
    "真实浏览验证四项样本的主题、窄宽、文案扩展、点击、选择、输入、深链、焦点与几何，并目视截图",
    "用户确认、EDX独立准入、审美品质、Agent收益仍未证明"
  ],
  "failureBehavior": ["候选不写入active token；展示失败只修本闭包", "到预算终止采集，保留UNPROVEN与清理预留；既有server留给用户审阅"],
  "updatedAt": "2026-10-29T00:00:00.000Z"
}
```
