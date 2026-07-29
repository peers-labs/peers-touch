# Mobile Shell Prototype

> **Status**: drafting
> **Module**: `packages/prototypes/mobile/chat/`
> **Updated**: 2026-07-08

## 原型在哪

`packages/prototypes/mobile/chat/`

## 落地目标

该原型不是新的 Mobile 产品设计，也不是脱离实现的 mock。它是当前 `apps/mobile` 代码结构的 source-backed 静态投影，用于在 Prototype Portal 的 `mobile` 站点里看见并评审现有 Mobile Shell 体验边界。

## 对应实际代码

| 原型区域 | 实际代码来源 |
|---|---|
| Station selection / Access gate / Shell launch state | `apps/mobile/src/App.tsx` |
| Mobile 四个主 tab、badge、thread 时隐藏 tabbar | `apps/mobile/src/components/MobileShell.tsx` |
| Chat conversation list、Friend/Group thread、bottom action sheet、composer | `apps/mobile/src/pages/ChatPage.tsx` |
| Contacts search、create group、find people、profile modal | `apps/mobile/src/pages/ContactsPage.tsx` |
| Moments composer、image upload states | `apps/mobile/src/pages/MomentsPage.tsx` |
| Settings profile、station、blocked users、logout | `apps/mobile/src/pages/SettingsPage.tsx` |
| Mobile visual class 语义 | `apps/mobile/src/styles.css` |

## 交互覆盖

- Launch：Station add / select / probe / remove / continue、station error。
- Access Gate：login / invite-code / blocked / preparing 四态、remembered account chip、表单 disabled / loading / error、change station、grant to shell。
- Mobile Shell：四主 tab 切换、Chat thread 隐藏 tabbar。
- Chat list：conversation 搜索面、好友/群列表项、online dot、tags、unread badge、空态。
- Chat thread：Back、More action sheet、message edit / recall / delete、composer emoji / more / attachment draft panel、blocked readonly composer。
- Chat action sheet：search、mute、sticky、alert、background、clear / restore history、friend block / unblock、group members。
- Group management：profile save、group/my settings switch、member promote/demote/mute/remove、invite friend、dissolve group。
- Contacts：search、friend request accept/reject、friends/groups/sent requests、empty/search empty、find people、create group、profile、block/unblock。
- Moments：textarea/count、add image、uploading/done/error tile、retry/remove、publish disabled/loading/success/error notice。
- Settings：logged-in/logged-out profile、station verified toggle、change station、blocked users modal、unblock、logout。

## 证据

### L1 Static

- `packages/prototypes/mobile/chat/src/MobilePrototype.tsx`：声明 `LaunchState`、`TabId`、`ChatMode`、`ContactModal`、`ComposerPanel`、`ChatBackground`，并在 `sourceMap` 绑定 `apps/mobile` 实际源码入口。
- `packages/prototypes/mobile/chat/src/mobilePrototype.css`：所有样式 scoped 到 `.mobile-prototype-root`，避免污染 Prototype Portal。
- `packages/prototypes/mobile/chat/prototype.manifest.ts`：登记为 `mobile / mobile-chat / shell / drafting`。

### L2 Visual

截图来自同一份 mobile prototype 源码的真实渲染。`standalone-*` 文件来自 `pnpm --filter @peers-touch/prototype-mobile-chat run dev --port 3210 --host 127.0.0.1`，用于避免 Portal iframe/布局层干扰；`07-09` 来自 Prototype Portal `http://localhost:3203/` 的 `Current Worktree / merge-desktop-prototype`。

| Evidence | 覆盖状态 | 判定 |
|---|---|---|
| `tmp/evidence/mobile-prototype/standalone-01-mobile-chat-list.png` | Chat list：搜索、好友/群列表、unread、tags、tabbar | PASS |
| `tmp/evidence/mobile-prototype/standalone-02-mobile-chat-action-sheet.png` | Chat action sheet：search、mute、sticky、alert、background、group members、clear history | PASS |
| `tmp/evidence/mobile-prototype/standalone-03-mobile-group-management.png` | Group management：profile、settings switches、member action entry | PARTIAL：截图只覆盖弹窗上半部；完整 action refs 见 L3 |
| `tmp/evidence/mobile-prototype/standalone-04-mobile-contacts-list.png` | Contacts：requests、friends、groups、sent requests、toolbar | PASS |
| `tmp/evidence/mobile-prototype/05-mobile-create-group.png` | Create group：group fields、initial members、selection、submit | PASS |
| `tmp/evidence/mobile-prototype/06-mobile-moments-composer.png` | Moments：textarea/count、uploading/done/error image tiles、add/publish | PASS |
| `tmp/evidence/mobile-prototype/07-mobile-settings-blocked-users.png` | Settings blocked users：modal、unblock rows | PASS |
| `tmp/evidence/mobile-prototype/08-mobile-station-selection.png` | Station selection：add/select/probe/remove/continue | PASS |
| `tmp/evidence/mobile-prototype/09-mobile-auth-gate.png` | Access Gate：login/invite/blocked/preparing、remembered accounts、change station/login | PASS |

### L3 Dynamic

- Portal smoke：`http://localhost:3203/`，Worktree combobox 显示 `Current Worktree / merge-desktop-prototype`。
- DOM refs confirmed in browser snapshot:
  - Chat list/thread：conversation buttons、`Back`、`More chat actions`、message `Edit / Recall / Delete`、composer `Emoji / More / Send`。
  - Action sheet：`Search in chat / Mute / Sticky / Alert / default / paper / aurora / Group members / Clear history`。
  - Group management：`Save`、settings switches、`Promote / Demote / Mute / Unmute / Remove / Invite / Dissolve group`。
  - Contacts：`Create group / Find people / Show empty/search state / Accept / Reject / Dismiss / profile row / group row`。
  - Moments：`Retry image / Mark image ready / Remove image / Add image / Publish`。
  - Settings：`verified / Change Station / Blocked users / Logout / Unblock`。
  - Launch/Auth：`Add / Select / Probe / Remove / Continue with selected Station` and `login / invite / blocked / preparing / remembered account / Change Station / Login`。
- Portal embedded hit-testing fix verified：`More chat actions` -> `Group members` and `station-selection` -> `Continue with selected Station` both clicked successfully in `http://localhost:3203/` after the Portal local preview stopped adding an outer scroll container and the mobile source controls stayed visible in compact viewport.
- Artifact hygiene：`standalone-05-*` / `standalone-06-*` / `standalone-07-*` / `standalone-08-*` captures were excluded from the evidence table after screenshot contamination was observed; use the listed files only.

## 怎么跑

```bash
make run-prototype
```

并行预览：

```bash
make -w run-prototype
```

打开 Prototype Portal 后切换到 `mobile`，选择 `Mobile Shell`。

## 已知差异 / 待补

- 该原型使用静态 fixture 数据，不连接 Station，也不调用 mobile store/API。
- 原型 CSS 为 scoped projection，复用实际 mobile class 语义，避免直接 import `apps/mobile/src/styles.css` 污染 Portal 全局。
- 按钮会驱动原型本地状态变化，但不会触发真实 `useSocialStore` / `useGroupStore` / Station API。
- 当前状态仍为 `drafting`；L2/L3 证据已补齐到可评审水平，但进入 `pending-review` 前仍需要 Owner 复核，尤其是 Group management 的长弹窗下半部视觉。
