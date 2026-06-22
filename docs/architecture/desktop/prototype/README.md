# Desktop 容器外壳 — 原型

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-06-22
> **落地目标**: Desktop 容器外壳（`apps/desktop`）；**原型本身只是 React web 展示**，不碰真实 store / kernel / tauri
> **总账状态**: drafting（见 [原型总账](../../prototypes/README.md)）
> **Owner**: Peers-Touch Agent Team
> **Module**: `packages/prototypes/desktop/`

---

## 原型在哪

源码在 `packages/prototypes/desktop/`（统一原型工作区；独立 web 工程）。本目录只放入口说明，不复制源码（架构文档标准 §5.8）。

这个原型展示 **peers-touch desktop 容器外壳长什么样**，并演示 **Atelier 本质是跑在容器里的一个 applet**——不是独立全屏 app。容器壳负责全局导航与页面/applet 切换，Atelier 作为左栏 pin 的 applet 进入内容区。

## 怎么跑

```bash
cd packages/prototypes/desktop
pnpm install        # 首次，monorepo 根装也可
pnpm dev            # Vite，浏览器打开 localhost:3105
```

技术栈：React + Vite + `lucide-react` + 内联样式 DOM，纯前端、mock 驱动，浏览器直接看，不需要任何运行时容器。原型通过 workspace 依赖 `@peers-touch/prototype-atelier`，把 atelier 原型整体作为一个 applet 嵌入内容区（基础件跨原型复用，不重复造）。

## 形态：容器壳 + applet 内容区（参照真实 apps/desktop）

参照真实桌面工程 `apps/desktop`（`ReadyView` → `GlobalLayout` → `AppSideNav` + `PageRouter`）复刻容器外壳：

- **全局 SideNav（LobeUI `<SideNav>` 形态）**：
  - `avatar`：用户头像（顶部方形头像）。
  - `topActions`：Search / 聊天 / Agent / Notes 等内核页入口 + **applet pins**（Blocks 图标，active 态对应 `page === 'applet:<id>'`）。
  - `bottomActions`：通知 / 命令面板 / 设置。
- **内容区（页面路由）**：按 `page` 切换。内核页（search/chat/agent/notes/settings）在原型里是**轻量占位页**（不细化）；`applet:<id>` 渲染对应 applet 的真实界面。
- **命令面板**（`⌘⇧P`）：mock 命令列表，可跳转各页/applet（对齐真实 AppSideNav 的 Command Palette）。

## Atelier 是容器里的一个 applet

- 左栏 Atelier pin（Blocks 图标）→ 进入 `applet:atelier` → 内容区渲染 `@peers-touch/prototype-atelier` 的 `AtelierPage`。
- atelier 原型壳由 `height: 100vh` 改为 `height: 100%`，以便自适应嵌入容器内容区。
- 默认落在 `applet:atelier`，直观体现「容器 → applet」从属关系。

## 对应设计

- 容器外壳形态参照真实工程 `apps/desktop`：`src/views/ReadyView.tsx`、`src/components/GlobalLayout.tsx`、`src/components/AppSideNav.tsx`、`src/components/PageRouter.tsx`。
- 设计真源：[runtime/desktop-runtime-architecture.md](../../runtime/desktop-runtime-architecture.md)、[applet-runtime](../../applet-runtime/README.md)。
- Atelier applet 设计：[atelier 原型](../../atelier/prototype/README.md)。

## 总账状态

drafting（见 [原型总账](../../prototypes/README.md)）。

## 已知差异 / 待补

- 内核页（search/chat/agent/notes/settings）为**占位页**，未细化；本原型聚焦容器外壳 + Atelier applet 的从属关系。
- SideNav 用纯 DOM 复刻 LobeUI `<SideNav>` 形态（avatar/topActions/bottomActions），未引入 `@lobehub/ui` 与 antd theme token；视觉为近似，不接真实主题系统。
- 二级侧栏（真实工程 agent 页的 `DraggablePanel`）未复刻。
- 命令面板为 mock 跳转，未接真实快捷键全集与命令注册表。
- applet 进入/退出未做 keep-alive / 生命周期（真实 `PageRouter` 对 agent 页 keep-alive）；原型为简单挂载/卸载。
