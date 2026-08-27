# Mobile Prototype Design Handoff — Architecture & Planning Prompt

> **目的**: 本文档是设计阶段到架构规划阶段的移交物料。请基于此完成的原型设计，结合项目现有架构规范，产出 Mobile 端架构设计与实施计划。

---

## 1. 已完成的原型设计概览

### 1.1 原型位置

```
packages/prototypes/mobile/chat/
├── src/
│   ├── MobilePrototype.tsx      # 入口状态机
│   ├── MobileShell.tsx          # Shell + TabBar 导航
│   ├── mobilePrototype.css      # 全量样式（CSS nesting, design tokens）
│   ├── types.ts                 # 所有类型定义
│   ├── data.ts                  # Demo 数据
│   ├── pages/
│   │   ├── LaunchScreen.tsx     # Station 选择 + 新增/删除
│   │   ├── AuthGateScreen.tsx   # 认证网关（OAuth + Email 双 tab）
│   │   ├── ChatPage.tsx         # 会话列表
│   │   ├── ChatThread.tsx       # 聊天详情（最复杂的页面）
│   │   ├── ContactsPage.tsx     # 联系人 + 群组
│   │   ├── MomentsPage.tsx      # 朋友圈/动态
│   │   └── ProfilePage.tsx      # 个人中心/设置
│   └── components/
│       ├── ContactDetailView.tsx # 联系人详情
│       ├── GroupDetailView.tsx   # 群组详情
│       ├── SettingDetailView.tsx # 设置详情
│       ├── ForwardPicker.tsx     # 转发选择器
│       ├── ThreadView.tsx        # Thread 子面板
│       ├── LanguageSwitcher.tsx  # 语言切换
│       └── StationSelector.tsx   # Station 选择组件
```

### 1.2 产品流程状态机

```
station-selection → access-gate-chain → shell
      ↑                                    │
      └────────── Change Station ──────────┘
```

Shell 内 4 个 Tab：**Chats** / **Moments** / **Contacts** / **Me**

### 1.3 核心交互能力（已实现原型）

| 功能模块 | 已设计能力 |
|---------|-----------|
| **Station 选择** | 多 Station 列表、活跃选中、新增、删除、在线状态检测 |
| **认证网关** | OAuth 三方登录（GitHub/Google/WeChat）模拟完整 redirect 流程、Email+Password 登录、Tab 切换无跳变（Grid overlay）、记忆账户 |
| **聊天列表** | 搜索过滤、未读 badge、置顶/免打扰标识、群组标识、在线状态、最新消息预览 |
| **聊天详情** | 发送/接收消息、引用回复、图片消息、文件消息、消息状态(sent/delivered/read)、撤回、编辑、固定、标旗、Thread 回复、转发、Reaction（单条+扩展 emoji grid）、Action Sheet（飞书风格 Reaction 栏 + 四宫格快捷操作 + 列表操作）、Chat/Docs/Pinned 顶部 Tab、已读回执、正在输入指示器、消息搜索、媒体库、联系人详情面板（静音/置顶/举报/拉黑/清空） |
| **联系人** | 分组显示（频繁/所有）、搜索、在线状态、联系人详情、发起聊天、群组列表 |
| **朋友圈** | 动态展示（文字+图片）、点赞/Reaction、评论（含回复）、时间展示 |
| **个人中心** | 头像/昵称/签名展示、设置分组（账户/通知/隐私/存储/关于）、切换 Station、设置详情面板 |

### 1.4 设计 Token 体系

```css
--mp-primary: #6366f1;          /* Indigo 主色 */
--mp-primary-hover: #5558e6;
--mp-primary-light: rgba(99, 102, 241, 0.10);
--mp-bubble-own: #6366f1;       /* 自己消息气泡 */
--mp-bubble-peer: #ffffff;      /* 对方消息气泡 */
--mp-chat-bg: #f0f2f5;          /* 聊天背景 */
--mp-gray-50 ~ --mp-gray-900;  /* 9 级灰阶 */
--mp-success: #22c55e;
--mp-error: #ef4444;
--mp-warning: #f59e0b;
--mp-r-xs/sm/md/lg/xl/pill;    /* 圆角梯度 */
--mp-header-h: 52px;
--mp-tabbar-h: 56px;
--mp-font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
```

### 1.5 关键 UI Pattern

1. **导航模式**: Stack 导航（列表 → 详情），TabBar 在详情页隐藏
2. **设备帧**: 390×844 iPhone 14 模拟（刘海、圆角 44px、状态栏）
3. **布局稳定性**: Tab 切换使用 CSS Grid overlay + visibility 控制，防止容器高度跳变
4. **模态交互**: Action Sheet 底部弹出（半透明遮罩 + slide-up 动画）、OAuth 中间态小卡片 modal
5. **反馈**: Toast 自动消失、按压态(`:active`)、加载状态
6. **手势暗示**: 长按消息触发 Action Sheet、滑动指示器

---

## 2. 你的任务

基于以上已完成的原型设计，请执行以下步骤：

### 2.1 上下文加载

1. 读取 `docs/.agent/mobile.md` — Mobile 端 Agent 规则
2. 读取 `docs/README.md` → 找到移动端架构源文档
3. 读取 `docs/architecture/` 下与 Mobile 相关的架构决策
4. 读取 `apps/mobile/` 当前实际代码结构，了解现状
5. 读取 `AGENTS.md` §4 Thinking Principles 和 §5 Iron Laws

### 2.2 分析要求

请评估：

1. **原型 → 实现的 Gap 分析**：原型中的哪些交互/模块在当前 `apps/mobile/` 中已有对应实现？哪些是全新的？哪些需要重构现有实现？
2. **架构适配**：原型的状态机/导航模型/Shell 结构如何映射到 Tauri v2 Mobile 架构（Web UI + Rust capability kernel）？
3. **Domain Model 映射**：原型 types.ts 中的 Conversation、Message、Contact 等类型如何与 `model/domain/` proto 定义对齐？
4. **跨层协作**：哪些功能需要 Station 后端配合？哪些纯客户端完成？

### 2.3 输出物

请使用 `pt-architecture-design-methodology` skill 产出：

1. **Mobile Shell 架构设计** — 基于原型的状态机 + 导航 + 模块拆分的正式架构文档
2. **实施计划** — 分阶段的 execution plan，使用 `pt-architecture-execution-methodology`（Domain Responsibility → Execution Closure → Dependency Order → Verifiable Delivery）
3. **Proto 需求清单** — 原型中哪些类型需要新 proto 或扩展现有 proto

### 2.4 约束

- 遵循项目 Iron Laws：Proto-First、No Mock、No Debug Statements、i18n、No Hardcoded UI Strings
- Mobile 端使用 Tauri v2 Mobile 架构（非 Flutter、非 RN）
- 所有业务模型从 proto 生成，原型 types.ts 仅作设计参考
- 参照 `docs/client/common/ui-identity/` 的 UI Identity 规范
- 状态管理、运行时投影等参照 Desktop 端已建立的模式（`docs/client/desktop/runtime-projections.md`），Mobile 做适配而非重新发明

---

## 3. Prototype Portal 验证

原型可通过以下方式在本地查看：

```bash
cd packages/prototypes/portal && pnpm dev
# → http://localhost:3200
# 选择 "Mobile Shell" 原型
```

流程路径：Station Selection → Auth Gate（点 GitHub/Google 有 OAuth 模拟流程） → Shell（Chats/Moments/Contacts/Me）→ 点击会话进入 ChatThread

---

## 4. Context Anchor

| Field | Value |
|-------|-------|
| Branch | (当前分支) |
| Stage | DESIGN → 准备进入 PLAN |
| Prototype | `packages/prototypes/mobile/chat/` |
| Target | `apps/mobile/` |
| Related | `model/domain/`, `docs/architecture/`, `docs/client/common/` |
| Status | 原型设计完成，等待架构设计 + 实施计划 |
