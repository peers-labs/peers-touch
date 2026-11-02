# UI-F03 — 基础组件逐项样本

用户明确授权整批20项基础组件，继承当前 Agent 材质表达，全部保持 draft。
本闭包负责可审阅样本；逐项确认及生产消费者替换仍由后续授权决定。

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "UI-20261028", "taskId": "UI-F03", "workstreamId": "UI",
  "title": "基础组件逐项样本", "workClass": "refactor", "completionClass": "functional",
  "executionMode": "build", "closureId": "ui-basic-specimens",
  "journeyId": "UI-BASIC-SPECIMEN-REVIEW", "runtimeClass": "service",
  "writeSet": ["packages/prototypes/shared/ui-system", "packages/ui/web", "packages/ui/tokens", "docs/architecture/platform/client/ui-system/prototype"],
  "readSet": ["packages/ui/contracts", "docs/client/common/ui-identity"],
  "budgets": {"focusedCheckSeconds": 180, "functionalRunSeconds": 180, "cleanupSeconds": 60},
  "checks": [
    {"id": "UI-F03-source", "command": "pnpm --filter @peers-touch/prototype-ui-system check", "verificationClass": "STRUCTURAL_CHECK"},
    {"id": "UI-F03-preview", "command": "make run-prototype", "verificationClass": "FUNCTIONAL_CHECK"}
  ],
  "doneWhen": [
    "既有20基础ID全部展示，公共组件承载材质样式；总览与单项共享同一renderer",
    "基础动作、身份、反馈、文字和布局绑定现有能力合同，支持标准、长文案、禁用样本",
    "公共quiet按钮hover不引入意外边框，Segmented焦点位于选择轨道内部；Agent样本复用公共Segmented",
    "真实浏览覆盖20项、菜单与焦点、标签移除恢复、计数、快捷键、浅深主题、宽窄、长文案、禁用、深链与退出卸载，并检视截图",
    "20项仅为已制作样本，不声明全部合同、审美、用户认可或正式Acceptance通过"
  ],
  "failureBehavior": ["尚未确认的组件不替换消费者", "无法在预算内关闭本批则先修订拆分Task"],
  "updatedAt": "2026-10-29T04:00:00.000Z"
}
```
