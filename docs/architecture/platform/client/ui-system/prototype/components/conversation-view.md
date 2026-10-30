# ConversationView · 对话窗（迁移增量 2）

> **Status**: draft（北极星窗框内，未晋升 peers-ui）
> **Created**: 2026-10-30 · **Owner**: Client Platform / UI System
> **旧来源**：`apps/desktop/src/pages/SocialChatPage.tsx`、`components/chat/ChatMessageArea.tsx`、`ChatComposer.tsx`
> **前置**：[SearchField](./search-field.md)、增量 1 ConversationRail

## 1. 产品边界

- **用于**：人对人 / 普通群的**文本**消息浏览与发送；本人/对方气泡、时间、本地回显。
- **不用于（本轮显式延后）**：语音/视频通话（CallSurface/GroupCallSurface）、附件与附件详情、
  Thread 侧面板、会话详情/权限面板、@提及、表情、消息操作条、撤回/重发、已读回执、AI 消息。
  这些来自旧 `ChatMessageArea` 的能力在后续增量单独训练，不在此预置。
- 数据为本地 fixture，发送只追加本地消息，不写 station/runtime。

## 2. 旧设计审计（新方法论）

- 旧实现用 antd `theme.useToken()`、`@lobehub/ui`、react-layout-kit `Flexbox` 与自绘输入框；
  新实现**全部回归 peers-ui 原语**：`Avatar`（方圆）、`TextArea`（`framing="embedded"`）、
  `IconButton`（iconId `send`，空内容走 `availability` 禁用合同，而非手写 disabled）。
- peers-ui `FieldFrame` 自带 1px 边框与聚焦阴影；嵌入窗框时由 `.sk-composer .pt-field-frame`
  去框，圆角与焦点环归属外层 `.sk-composer` 宿主（遵循「圆角长在绘图层 / 焦点环跟随宿主」）。

## 3. 组合与状态

| 部分 | peers-ui | 关键规则 |
|---|---|---|
| 消息流 | 自绘布局 + `Avatar` | peer 左（`--sk-tile` 泡 + 方圆头像），me 右（`--sk-primary` 近黑胶囊）；尾泡小圆角；时间 10px 三级灰；流独立滚动，新消息滚到底 |
| 输入区 | `TextArea` embedded + `IconButton` | 宿主 `.sk-composer` 圆角 16、材质填充、`:focus-within` 2px 环（焦点通道无 transition，craft C13）；Enter 发送、Shift+Enter 换行（IME 组合期不触发，由 peers-ui onEnter 保证）；空文本发送键禁用 |

状态：空会话（rail 未选，Empty）、有历史、发送中仅本地追加（无网络态，真实发送状态机延后）。

## 4. 门禁

`north-star.suite.json` 场景 `conversation-view-seed`（3 条种子 / peer2 me1 / 头像方圆 /
空内容发送键 aria-disabled）、`conversation-send`（发送后 4 条、末条本人含文本、
`data-composer-value` 清空、发送键回禁用）。textarea 当前值经 `data-composer-value`
反射——textarea 的 `value` 是属性不是特性，`getAttribute('value')` 不随输入变化。

## 5. UNPROVEN

真实消息数据源与发送状态机、附件/通话/Thread、消息操作、@与表情、已读回执、
i18n、长列表虚拟化、读屏/触摸键盘、390px 窄屏对话布局、晋升 peers-ui 的组件 API。
