# AFL-08C · 跨站/搜索/圈友闭环与原型视觉对齐

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-08C",
  "workstreamId": "DESKTOP-JOURNEYS",
  "title": "跨站浏览、入站评论可见、搜索与圈友分组 Journey + 截图比对",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j08c-journeys",
  "closureId": "afl-08c-desktop-journeys",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src",
    "tooling/acceptance"
  ],
  "readSet": [
    "apps/desktop/src",
    "packages/prototypes/shared/ui-system/moments"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl08c-check",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl08c-journey",
      "command": "pnpm --dir apps/desktop exec playwright test moments-cross-station",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "Desktop native：跨站看到他站动态与非关注者评论、搜索、圈友分组、受众发帖端到端通过；截图与钉版原型比对通过",
    "验收 feature 登记新 Journey；不把视觉截图单独当验收证明（DOM+painted 断言为准）"
  ],
  "failureBehavior": [
    "不做 Mobile UI"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

跨站与视觉验收闭环，DOM+painted 断言为准，截图仅辅助。
