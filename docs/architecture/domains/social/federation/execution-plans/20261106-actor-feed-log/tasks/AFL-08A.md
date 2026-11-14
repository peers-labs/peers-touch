# AFL-08A · 朋友圈组件沉淀进 peers-ui（原型版本钉死）

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "AFL-20261106",
  "taskId": "AFL-08A",
  "workstreamId": "PEERS-UI-PARTS",
  "title": "组件差距清单关闭：MomentCard/AuthorCard/IdentityCard 与 7 个复合件全部入 peers-ui",
  "workClass": "product-behavior",
  "completionClass": "source",
  "executionMode": "build",
  "journeyId": "afl-j08a-ui-parts",
  "closureId": "afl-08a-peers-ui-parts",
  "runtimeClass": "source-only",
  "writeSet": [
    "packages/ui"
  ],
  "readSet": [
    "packages/prototypes/shared/ui-system/moments",
    "packages/prototypes/shared/ui-system/identity",
    "packages/ui"
  ],
  "budgets": {
    "focusedCheckSeconds": 1800,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "afl08a-check",
      "command": "pnpm --dir packages/ui run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl08a-tests",
      "command": "pnpm --dir packages/ui run test",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "afl08a-gap",
      "command": "node tooling/scripts/social-ui-gap-check.mjs",
      "verificationClass": "STRUCTURAL_CHECK"
    }
  ],
  "doneWhen": [
    "开工前把 show worktree 原型以 commit hash 同步/钉入执行 worktree 单一来源（show HEAD 已超 6ae2b37f6，两 worktree MomentsFeature.tsx/moments.css 已分叉），差距清单对该版本签字",
    "差距清单显式包含 MomentCard、AuthorCard、其依赖 IdentityCard/IdentityTrigger，以及 MomentsFeature 内 FeedSortFloat/ComposeDialog/StatGrid/ProfileView/CircleCreateDialog/CirclesView/CircleManageDialog 七个复合件，逐一标注 入peers-ui/现成件组合/app数据容器",
    "库内确认缺失（grep）：MomentCard/AuthorCard/IdentityCard/ImageGrid/Lightbox/FollowButton/UserProfileHeader；原语 Avatar/AvatarGroup/Button/Dialog/Empty/FilePicker/IconButton/Segmented/Select/TextArea/TextField/Toggle 已存在，直接复用",
    "所有新组件 peers-ui 内闭环带测试；app 内禁止建同名临时件（机械检查）"
  ],
  "failureBehavior": [
    "不在 app 内补临时 UI",
    "不带入示例数据"
  ],
  "updatedAt": "2026-11-06T13:30:00.000Z"
}
```

## 完整闭环

组件先行、版本钉死（F-09/F-10 修正），差距清单覆盖 IdentityCard 与七个复合件。
