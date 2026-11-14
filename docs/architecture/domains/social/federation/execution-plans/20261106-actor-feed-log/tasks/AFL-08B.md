# AFL-08B · 动态/圈友真实数据接入与旧页面删除

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-08B",
  "workstreamId": "DESKTOP-INTEGRATION",
  "title": "原型产品化接真实投影/同步；moments-data 假人全部移除；旧 Moments 实现同批删除",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "journeyId": "afl-j08b-integration",
  "closureId": "afl-08b-desktop-integration",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop/src/pages/moments",
    "apps/desktop/src/components/moments",
    "packages/locales"
  ],
  "readSet": [
    "apps/desktop/src",
    "packages/ui",
    "packages/prototypes/shared/ui-system/moments"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl08b-check",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl08b-build",
      "command": "pnpm --dir apps/desktop run build",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl08b-journey",
      "command": "pnpm --dir apps/desktop exec playwright test moments-integration",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "moments-data.ts 本地示例全部替换为真实 projection/feed API（HOME/PUBLIC/用户页/圈友分组/搜索）",
    "动态/圈友 tab、排序、composer+受众、ImageGrid/Lightbox、评论/reaction、FollowButton、UserProfileHeader、CircleManage 接通；全 i18n 零硬编码",
    "import 机械检查：仅来自 @peers-touch/ui* 与允许的 data/hook 层；被替代旧 Moments 实现（components 24+pages 10+store）同批删除，无双页面并存"
  ],
  "failureBehavior": [
    "不做 Mobile 新 UI"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

真实数据接入与旧实现删除的纵向闭环；假人示例不进产品。
