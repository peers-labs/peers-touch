# Desktop 真身北极星 UI 迁移（peers-ui 自包含重构）

> 状态：accepted（用户 2026-11-06 授权自主执行，无需逐次批准）
> 范围：`apps/desktop` 渲染层。把壳、一级菜单（rail）、chat、moments、settings、notification
> 从 antd / @lobehub/ui / react-layout-kit / 手写原语，迁移到自包含的
> `@peers-touch/ui`（peers-ui）+ 北极星原型（`packages/prototypes/shared/ui-system`）语法。
> 工作树/分支固定：worktree `peers-touch-show`，分支 `proto/unified-confirm-dialog`。

## 1. 不可违背的边界

1. **只换表现层，不换数据/生命周期架构。** 严格遵守
   [`runtime-projections.md`](./runtime-projections.md) 的 Page / Runtime / Boot 合同：
   - 页面是纯渲染器（不在 mount 时 fetch）；长寿命投影归 `RuntimeDescriptor`；
     一次性分区数据用 `kernel/usePrefetch`；启动可观测性归 `kernel/boot.ts`。
   - `store/`、`runtimes/`、`services/`、`kernel/`、Tauri IPC、事件总线、proto 契约
     **一律不改语义**。本次只改组件渲染与样式；hook 选择器、action 调用、`data-*` 验收钩子保持原名原值。
2. **被重构的面只允许出现 peers-ui 组件/元素。** 不新增 antd、@lobehub/ui、react-layout-kit、
   裸 `<button>/<input>`、内联硬编码颜色。缺能力时**先增强 peers-ui**（在 `packages/ui/web`
   或 `packages/ui/assets`），再回真身使用；不足的字形补进 `ui-assets` glyph 注册表。
3. **真身功能优先于原型。** 原型与真身行为冲突时，以真身现有功能/字段/交互为准，
   回过来调整 peers-ui 与原型对齐；不允许为了贴合原型而删功能。
4. **i18n 不变。** 所有可见文案继续走 `react-i18next` 既有 namespace/key，不硬编码字符串。
5. 保留验收钩子：`data-pt-primary-nav`、`data-pt-navigation-badge`、`data-pt-unread-count`、
   `data-rail-target` 等选择器在新 rail 中必须继续存在（acceptance 依赖）。

## 2. 目标架构

```
main.tsx
└─ I18nextProvider
   └─ lobehub ThemeProvider        # 过渡期保留：未迁移面仍用 antd
      └─ UIProvider (theme=light)  # 新增：注入 --pt-* 令牌 + overlay host + feedback
         className="ds-theme"      # 桌面北极星皮肤作用域
         └─ App → ReadyView
            └─ DesktopShell(.ds-shell)          # 新壳（替换 GlobalLayout 的 Flexbox 版）
               ├─ DesktopRail(.ds-rail)         # 一级菜单（peers-ui IconButton/Badge/Tooltip/Popover）
               └─ .ds-stage                     # 内容舞台（现有 PageHost/PageRouter 原样挂载）
```

- peers-ui 的 `UIProvider` 通过 `tokenVariables(mode)` 在 `.pt-ui` 上注入全部 `--pt-*`，
  并提供 portal overlay host、模态 inert 管理、feedback 通道。样式全部作用域在
  `.pt-ui / .pt-*`，**无 `body/:root` 全局重置**，可与 antd 共存，支持逐面灰度迁移。
- 桌面皮肤用一份 `desktop-northstar.css`，在 `.ds-theme` 上覆写 `--pt-*` 为北极星
  「中性纸 + 墨黑动作 + 松绿身份」调色板（对齐原型 glass skin：`--pt-primary`=墨黑动作、
  松绿仅出现在自我身份/当前所在），并定义壳/轨几何（`.ds-shell/.ds-rail/.ds-stage`）。
  令牌是唯一皮肤入口，组件内不写死颜色。
- rail 几何与原型一致：常驻 60px 竖轨（任何宽度不转横），头像 44/圆角12 松绿，
  导航目标 38px 方块、当前面松绿、底部锚定通知+设置。但交互原语使用 peers-ui
  `IconButton`（原型里的裸 `<button>` 是原型债务，真身不继承）。

## 3. 迁移序列（依赖序）

1. **P0 基座**：desktop 依赖 `@peers-touch/ui`（workspace）；`main.tsx` 挂 `UIProvider`；
   新增桌面皮肤/壳 CSS；check+build 必须保持绿（未迁移面零视觉回归）。
2. **P1 壳 + 一级菜单 + 通知**：重建 `GlobalLayout`、`AppSideNav`、`NotificationBell`
   为 peers-ui；头像 popover 触发与 `UserSquareAvatar` 收敛；保留全部 store/nav/快捷键/钩子。
3. **P2 chat**：`SocialChatPage`/`ChatPage` 及 `components/chat`、`MessageBubble/MessageList`、
   `ChatInput/composer` 改 peers-ui；接真实 `socialChat/chat` store 与 runtime，不 mock。
4. **P3 moments**：`pages/moments`、`components/moments` 对齐原型语法，接真实
   `moments/socialProjection` store/runtime。
5. **P4 settings**：`SettingsPage` + `components/settings` 对齐原型 settings 帧。
6. **P5 收尾**：从已迁移面移除 antd/lobe/layout-kit 依赖点；回归与文档更新。

每个 P 结束都过 `apps/desktop` 的 `pnpm run check`，关键节点过 `pnpm run build`；
peers-ui 改动过 `packages/ui/web` 的 tsc；原型回归用
`evaluate-specimens`（north-star/boards）。

## 4. peers-ui / 原型增强回路

迁移中发现原语缺口，在 peers-ui 内补齐并保持自包含（不引第三方 UI 库）：

- 字形：rail/通知/聊天需要但 glyph 注册表缺失的图标，按既有 `GlyphAsset` 结构补入
  `packages/ui/assets/src/glyphs.ts`（沿用 lucide 源与许可声明）。
- 组件能力缺口（若有）：在 `packages/ui/web/src` 对应 barrel 增强，配 `--pt-*` 令牌，
  不写业务样式。

## 5. 验收

- 类型/构建：`cd apps/desktop && pnpm run check` 通过；阶段末 `pnpm run build` 通过。
- 真机：`make desktop` 启动，手测 rail 切换/徽标/通知 popover、chat 收发、moments 流、
  settings 分区；不出现非 peers-ui 控件、无视觉越界。
- 回归：既有 acceptance 钩子仍可命中；store/runtime 零语义改动。
- 未完成面保持可运行（antd 共存），不以半成品破坏整包构建。

## 6. 进度（2026-11-06）

- **P0 基座（完成，check+build 绿）**：`apps/desktop` 新增 workspace 依赖 `@peers-touch/ui`；
  `main.tsx` 在 lobehub ThemeProvider 内挂 peers-ui `UIProvider theme="light" className="ds-theme"`
  （注入 `--pt-*`、overlay host、feedback）；新增 `src/ui/northstar.css`（皮肤令牌 +
  `.ds-shell/.ds-rail/.ds-stage` 几何）。修复 peers-ui `overlays.tsx` 一处未用变量（desktop
  更严的 `noUnusedLocals` 会编译 workspace 源码）。
- **P1 壳/一级菜单/通知（完成，check+build+导航单测绿）**：
  - `GlobalLayout.tsx` 重写为 `.ds-shell` 帧；移除从未挂载的 antd `OnlineIndicator/AuthStatusIndicator` 死代码。
  - `AppSideNav.tsx` 全部改用 peers-ui `IconButton/Badge`（lucide/lobe/antd 已移除），
    保留全部 store/nav/快捷键逻辑与 `data-pt-primary-nav`、`data-pt-navigation-badge`、
    `data-pt-unread-count` 验收钩子；当前面用 `aria-current=page` 走松绿。
  - `NotificationBell.tsx` 重写为 peers-ui `Popover/Tooltip/IconButton/Badge/Empty`；
    轮询、已读/全部已读/删除、评论 @ 跳转 moments 详情等逻辑零改动；导出常量保留。
  - `UserProfilePopover.tsx` 的 antd `Popover/Spin` 与 layout-kit 换为 peers-ui；
    内层 `PublicProfileCard` 属共享身份卡，随身份/chat 波次统一迁移。
  - 新增 i18n：`layout.nav.primary`、`layout.user.viewProfile`（en/zh-CN 对齐）。
- **P2 chat / P3 moments / P4 settings（待办）**：均为数千行、数十个 antd 耦合文件，
  必须逐面“整面迁移 + `make desktop` 真机回归”，不做跨面半成品；按 §3 依赖序推进。
