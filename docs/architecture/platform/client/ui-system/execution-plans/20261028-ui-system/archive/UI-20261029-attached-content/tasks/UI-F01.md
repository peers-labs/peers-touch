# UI-F01 — 内容附着与视觉节奏

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-F01",
  "workstreamId": "UI",
  "title": "内容附着与视觉节奏",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-foundation-candidates",
  "journeyId": "UI-ATTACHED-CONTENT-REVIEW",
  "runtimeClass": "service",
  "writeSet": ["packages/ui/tokens", "packages/ui/web/src/index.ts", "packages/prototypes/shared/ui-system", "docs/architecture/platform/client/ui-system/prototype", "docs/architecture/engineering/architecture-governance/architecture-modules.json"],
  "readSet": ["docs/client/common/ui-identity", "docs/architecture/engineering/experience-design", "packages/ui/contracts"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F01-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F01-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "现有 Frontend Eles 默认展示共享任务画布：内容选择、成果附着摘要、输入与参与者共用当前对象",
    "空间草图和两份示例文档可读，观察点与计数对应当前资料，切换保留各自草稿，示例讨论归属当前资料",
    "所有控件沿用现有方圆几何，候选为draft，局部演示不接业务runtime",
    "保留130项目录；原20基础外观不再作为审阅样本",
    "真实浏览验证共享画布与单项聚焦的主题、窄宽、附着几何、内容切换、草稿与讨论隔离、深链、键盘和卸载，并目视截图",
    "用户确认、EDX独立准入、审美品质、Agent收益仍未证明"
  ],
  "failureBehavior": ["候选不写入active token；展示失败只修本闭包", "到预算终止采集，保留UNPROVEN与清理预留；既有server留给用户审阅"],
  "updatedAt": "2026-10-29T01:00:00.000Z"
}
```
