# Desktop 容器外壳 — 原型

> **Status**: draft
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-06-22
> **落地目标**: Desktop 容器外壳（`apps/desktop`）；**原型本身只是 React web 展示**，不碰真实 store / kernel / tauri
> **总账状态**: drafting（见 [原型总账](../../prototypes/README.md)）
> **Owner**: Peers-Touch Agent Team
> **Module**: `packages/prototypes/desktop/shell/`

---

## 原型在哪

源码在 `packages/prototypes/desktop/shell/`（统一原型工作区；独立 web 工程）。本目录只放入口说明，不复制源码（架构文档标准 §5.8）。

这个原型展示 **peers-touch desktop 容器外壳长什么样**。容器壳负责全局导航与页面切换；Agent 使用 Peers-owned Shell Agent Surface，Modern Chat 产品评审态来自 `modern-chat-agent`，Atelier 作为原生 Agent 子入口继续收敛。

## 怎么跑

```bash
cd packages/prototypes/desktop
pnpm install        # 首次，monorepo 根装也可
pnpm dev            # Vite，浏览器打开 localhost:3105
```

技术栈：React + Vite + `lucide-react` + 内联样式 DOM，纯前端、mock 驱动，浏览器直接看，不需要任何运行时容器。原型通过 workspace 依赖 `@peers-touch/prototype-desktop-atelier`，把 atelier 原型整体作为一个 applet 嵌入内容区（基础件跨原型复用，不重复造）。

## 形态：容器壳 + applet 内容区（参照真实 apps/desktop）

参照真实桌面工程 `apps/desktop`（`ReadyView` → `GlobalLayout` → `AppSideNav` + `PageRouter`）复刻容器外壳：

- **全局 SideNav（LobeUI `<SideNav>` 形态）**：
  - `avatar`：用户头像（顶部方形头像）。
  - `topActions`：Search / 聊天 / Agent / Notes 等内核页入口 + **applet pins**（Blocks 图标，active 态对应 `page === 'applet:<id>'`）。
  - `bottomActions`：通知 / 命令面板 / 设置。
- **内容区（页面路由）**：按 `page` 切换。Agent Chat、Agent Profile、Orchestration 和 Settings 使用已细化原型；其他未覆盖页面使用轻量占位。
- **命令面板**（`⌘⇧P`）：mock 命令列表，可跳转各页/applet（对齐真实 AppSideNav 的 Command Palette）。

## Agent 模块集成

- Shell 的 `agent-profile` 路由由 `src/AgentChatPage.tsx` 内的 Agent Profile surface 承载。
- Modern Chat 产品原型位于 `packages/prototypes/desktop/features/modern-chat-agent/`，由 Shell Agent 页面挂载；历史 benchmark 原型不参与产品身份。
- Profile 根据 Shell 内容容器宽度响应，而不是根据浏览器 viewport 猜测：
  - 小于 920px：My Agents 收为 48px 图标栏，Builder 默认关闭。
  - 窄容器打开 Builder：作为右侧覆盖层，不压缩主内容。
  - 小于 680px：SOUL / AGENTS 与配置卡片改为单列。
- Agent Chat 使用相同的容器宽度策略：
  - 小于 900px：Agent roster 收为 48px；Topics 改为按需覆盖层。
  - Profile / Orchestration 入口常驻 Chat Header。
  - Welcome、快捷操作和 Composer 使用主区可用宽度，不保留固定 430px/560px 横向约束。
- Orchestration Canvas 小于 1000px 时改为 `56px Agent rail + Canvas`，Engine / Progress / Detail 下移到下一行，由页面纵向滚动承载。

## Atelier 是容器里的一个 applet

- 左栏 Atelier pin（Blocks 图标）→ 进入 `applet:atelier` → 内容区渲染 `@peers-touch/prototype-desktop-atelier` 的 `AtelierPage`。
- atelier 原型壳由 `height: 100vh` 改为 `height: 100%`，以便自适应嵌入容器内容区。
- 默认落在 `applet:atelier`，直观体现「容器 → applet」从属关系。

## 对应设计

- 容器外壳形态参照真实工程 `apps/desktop`：`src/views/ReadyView.tsx`、`src/components/GlobalLayout.tsx`、`src/components/AppSideNav.tsx`、`src/components/PageRouter.tsx`。
- 设计真源：[runtime/desktop-runtime-architecture.md](../../runtime/desktop-runtime-architecture.md)、[applet-runtime](../../applet-runtime/README.md)。
- Atelier applet 设计：[atelier 原型](../../atelier/prototype/README.md)。

## 总账状态

drafting（见 [原型总账](../../prototypes/README.md)）。

## 已知差异 / 待补

- Search、Chat、Notes 等未覆盖页面仍有占位内容；Agent Profile 已接入整合原型。
- SideNav 用纯 DOM 复刻 LobeUI `<SideNav>` 形态（avatar/topActions/bottomActions），未引入 `@lobehub/ui` 与 antd theme token；视觉为近似，不接真实主题系统。
- 二级侧栏（真实工程 agent 页的 `DraggablePanel`）未复刻。
- 命令面板为 mock 跳转，未接真实快捷键全集与命令注册表。
- applet 进入/退出未做 keep-alive / 生命周期（真实 `PageRouter` 对 agent 页 keep-alive）；原型为简单挂载/卸载。
