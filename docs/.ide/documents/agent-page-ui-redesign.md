# Agent 页面 UI 重做 — 对齐原型

## Context

当前 Agent 聊天页面与原型（`packages/prototypes/desktop/features/agent/`）在布局架构、Composer 形态、Header 尺寸、面板结构上存在显著差异。用户要求整页对齐原型。

目标：将 `AgentChatPage` 从当前三栏布局（Roster 230px + Sidebar 260px + Chat flex:1）重构为原型的 Atelier Surface 布局（LeftRail 230px + Center flex:1 + RightPanel 230px），同时完全重写 Composer 和 Header。

---

## 布局变更

### 当前结构
```
[App Sidebar 48px] | [Agent Roster 230/48px] | [AgentSidebar 260px] | [ChatPage flex:1 + DraggablePanel]
```

### 目标结构
```
[App Sidebar 48px] | [LeftRail 230/48px] | [Center flex:1] | [RightPanel 230/48px]
```

App Sidebar 已由外层 Shell 提供，等价于原型的 GlobalNav，无需新增。

---

## 执行步骤

### Step 1: 重构 AgentChatPage.tsx 主布局

将 `AgentChatPage` 的三栏改为：LeftRail + Center + RightPanel。

- **LeftRail（230px 可折叠至 48px）**：合并当前 Agent Roster（Agent 列表/搜索/创建）与 AgentSidebar（Topic 列表）为一个面板。顶部保留 Agent 选择器，下方为 Topic 列表。
- **Center（flex:1）**：包含 44px Header + Stream Area + ComposerBar。
- **RightPanel（230px 可折叠至 48px）**：占位面板，展示 Todo 空状态 + Context 进度条（可后续接入真实数据）。

面板折叠逻辑：绝对定位 28x28 toggle 按钮（原型 `PanelToggleDock` 模式），icon 来自 lucide `PanelLeftOpen/Close`, `PanelRightOpen/Close`。

### Step 2: 重写 Header

从 78px 浮动卡片式 → 44px 固定简洁条：
- height: 44px, minHeight: 44px
- borderBottom: 1px solid #f0f0f0
- padding: 0 16px
- 左侧：Agent 标题（fontSize 14, fontWeight 600）+ Model Tag（fontSize 11）+ 运行状态点（6x6, green）
- 右侧：设置按钮

删除 boxShadow、borderRadius 18、margin 16px 18px 等卡片样式。

### Step 3: 重写 ChatInput → ComposerBar 形态

彻底重写 `ChatInput.tsx` 的视觉样式：

| 属性 | 当前 | 目标 |
|------|------|------|
| 外层 | borderRadius:24, shadow, padding:12px 14px 10px | 无独立容器；wrapper padding:12px 20px 16px + borderTop:hairline |
| 输入行 | textarea, maxHeight:200, fontSize:15 | 单行 input, fontSize:13, borderRadius:16, border:hairline, bg:#fafafa, padding:10px 12px |
| 按钮 | 34px 圆形 | 32x32, borderRadius:8（方角）|
| 发送 | 34px 圆形 | 32x32 圆形, bg:#e8e8e8 → #6b5bd6 |
| 工具栏 | Slash + Image + (flex center Model) + Send | Paperclip + Image + (flex:1 input) + Model + Mic + AudioLines + Send |
| 宽度约束 | min(1068px, calc(100%-160px)) 居中 | 无约束，100% 宽度 |
| 底部间距 | padding-bottom: 48px | padding-bottom: 16px（wrapper 自带）|
| Model Selector | 居中 pill 34px | 右侧紧凑按钮 fontSize:12, padding:4px 8px, borderRadius:6 |

保留多行 textarea 作为功能（用户可 Shift+Enter 换行），但视觉上默认单行高度（minHeight:28 降至一行高度~20px，初始无滚动条）。

### Step 4: RightPanel 占位实现

新建 `apps/desktop/src/components/agent/RightPanel.tsx`：
- 230px 宽，左边框 hairline
- padding: 14px 16px
- 两个 Section：Todo（空状态 "No items yet"）+ Context（0% 进度条 + 空文件列表）
- 顶部 PanelToggle 按钮

### Step 5: 消息区调整

- 移除 max-width 约束
- 用户气泡: maxWidth 75%, bg #6b5bd6, text white, borderRadius 12
- Agent 气泡: maxWidth 80%, bg #f5f5f5, text #262626, borderRadius 12

### Step 6: 删除冗余

- 移除 ChatPage.tsx 中的 DraggablePanel (Artifact 面板暂移除或置于 RightPanel 内)
- 移除 AgentChatHeader 的浮动卡片代码
- 移除 Composer 的 boxShadow 和 borderRadius:24 居中容器

---

## 关键文件

| 文件 | 操作 |
|------|------|
| `apps/desktop/src/pages/AgentChatPage.tsx` | 重写主布局：LeftRail + Center + RightPanel |
| `apps/desktop/src/pages/ChatPage.tsx` | 简化 Header 为 44px bar；移除 DraggablePanel |
| `apps/desktop/src/components/ChatInput.tsx` | 完全重写视觉为 ComposerBar 形态 |
| `apps/desktop/src/components/AgentSidebar.tsx` | 功能合并入 LeftRail，文件可能删除或重命名 |
| `apps/desktop/src/components/agent/RightPanel.tsx` | 新建占位面板 |

---

## 验证

1. `pnpm run check` — 类型检查通过（已有的预存错误可忽略）
2. `make desktop` 或 `make desktop-web` 启动 → 浏览器 `localhost:3310/#/agent`
3. 对比原型截图验证：
   - LeftRail 230px 含 Agent 列表 + Topics
   - Header 44px 简洁条
   - Composer 单行输入条形态、32px 方角按钮
   - RightPanel 230px 可见
   - 两侧面板可折叠
4. 发送消息验证功能不回归

---

## 不做的事

- 不实现 Pill Tabs (Work/Code/Design) — 当前无对应功能数据
- 不实现任务列表/项目分组 — LeftRail 暂用真实 Topic 列表
- 不实现 RightPanel 的真实 Todo/Context 数据 — 占位即可
- 不改动 store 层逻辑
- 不改动 Agent Roster 的功能逻辑（搜索、创建、选择）
