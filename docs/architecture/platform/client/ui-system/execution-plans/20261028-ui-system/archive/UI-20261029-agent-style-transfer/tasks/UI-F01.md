# UI-F01 — Agent 元素风格转译

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028",
  "taskId": "UI-F01",
  "workstreamId": "UI",
  "title": "Agent 元素风格转译",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ui-foundation-candidates",
  "journeyId": "UI-AGENT-STYLE-REVIEW",
  "runtimeClass": "service",
  "writeSet": ["packages/ui/tokens", "packages/ui/web/src/index.ts", "packages/prototypes/shared/ui-system", "docs/architecture/platform/client/ui-system/prototype", "docs/architecture/engineering/architecture-governance/architecture-modules.json"],
  "readSet": ["docs/client/common/ui-identity", "docs/architecture/engineering/experience-design", "packages/ui/contracts"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F01-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F01-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "现有 Frontend Eles 展示 Agent Groups 成员选择、输入与动作、协作组预览三个样本，共用当前组对象",
    "使用现有产品字段和原型身份，将参考的紧凑内容组织、排版、黑白对比、琥珀选中态与对象附着关系用于 Agent 内容",
    "不导入参考的地图、外部业务域、第三方品牌、业务模型；本地状态和主题保持独立",
    "所有控件沿用现有方圆几何，候选为draft，局部演示不接业务runtime",
    "保留130项目录；原20基础外观不再作为审阅样本",
    "真实浏览验证组合与单项聚焦的主题、窄宽、方圆几何、成员/编排选择、名称/目标输入、摘要计数、讨论、深链、键盘和卸载，并目视截图",
    "用户确认、EDX独立准入、审美品质、Agent收益仍未证明"
  ],
  "failureBehavior": ["候选不写入active token；展示失败只修本闭包", "到预算终止采集，保留UNPROVEN与清理预留；既有server留给用户审阅"],
  "updatedAt": "2026-10-29T02:00:00.000Z"
}
```
