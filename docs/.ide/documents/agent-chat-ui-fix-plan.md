# Agent Chat UI 可用性修复计划

## Context

Desktop Agent Chat 模块当前 UI 不可用：消息发不出去（依赖 Station 后端但无 mock 模式）、发送失败无反馈、停止生成后无法继续、连接状态不可见。需要做一组外科手术式 UI 修复，让 Agent 聊天流程跑通。

## 修复清单（按实施顺序）

### Fix 1: 全局错误 Toast（最小改动，立刻见效）

**文件**: `apps/desktop/src/store/chat.ts`

**改动**: 在 `sendMessage`、`regenerateMessage`、`retryMessage` 的 `onError` 回调中，除了设置消息 error 字段外，增加一行 `toast.error(...)` 全局提示。

复用: `@lobehub/ui` 的 `toast` 已在项目中使用。

---

### Fix 2: Send 按钮禁用原因 Tooltip

**文件**: `apps/desktop/src/components/ChatInput.tsx`

**改动**:
- 计算 `disabledReason`（streaming / uploading / empty）
- Send 按钮外包 antd `Tooltip`，disabled 时显示原因

---

### Fix 3: 连接状态指示器

**文件**: `apps/desktop/src/pages/ChatPage.tsx`（AgentChatHeader 内）

**改动**:
- 读取 `useGlobalContextStore` 的 `network.online` 状态
- Header 标签行加小圆点：online 绿 / degraded 黄 / offline 红 + Tooltip 说明
- Offline 时 ChatInput 显示 "Station offline" 提示

---

### Fix 4: Mock 模式（允许无 Station 开发测试）

**文件**:
- `apps/desktop/src/services/agent-service.ts` — 新增 `mockStreamTurn()` 
- `apps/desktop/src/store/chat.ts` — 新增 `mockMode` state + `setMockMode` action

**改动**:
- URL 参数 `?mock=1` 或 localStorage `pt:agent-mock-mode` 启用
- Mock 实现：setTimeout 序列发射 thinking → text chunks → done 事件，每 chunk 30-60ms
- 仅 `import.meta.env.DEV` 下可用，生产 build 自动 strip
- AbortController 支持中止 mock stream

---

### Fix 5: 停止后"继续生成"按钮

**文件**:
- `apps/desktop/src/store/chat.ts` — `stopStreaming` 标记 `stoppedByUser: true`
- `apps/desktop/src/pages/ChatPage.tsx` — 消息列表末尾条件渲染 Continue 按钮

**改动**:
- ChatMessage 新增 `stoppedByUser?: boolean`
- stopStreaming 时给当前 assistant 消息打标记
- UI：最后一条消息是 stoppedByUser 时显示 "Continue generation" 按钮
- 点击发送 "Please continue from where you left off." 作为新消息

---

## 关键文件

| 文件 | 改动范围 |
|------|---------|
| `apps/desktop/src/store/chat.ts` | Fix 1, 4, 5 |
| `apps/desktop/src/services/agent-service.ts` | Fix 4 |
| `apps/desktop/src/components/ChatInput.tsx` | Fix 2 |
| `apps/desktop/src/pages/ChatPage.tsx` | Fix 3, 5 |

## 验证方式

1. `pnpm --dir apps/desktop run check` 通过
2. `make desktop-web` 启动浏览器模式，加 `?mock=1` 参数
3. 验证 mock 模式下完整聊天流程：发送 → streaming 动画 → 完成
4. 验证 stop → Continue 按钮出现 → 点击继续
5. 验证无 Station 时发送显示 toast 错误 + header offline 指示
6. 验证 send 按钮 disabled 时 hover 显示原因

## 不做的

- 不做 Store 架构重构（slice 拆分）
- 不做 Lexical 编辑器替换
- 不改 Station/Rust 后端
- 不改消息持久化逻辑
