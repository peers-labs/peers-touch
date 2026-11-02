# 消息生命周期（补齐增量 16）

> **Status**: draft · **Created**: 2026-10-31 · **Owner**: Client Platform · UI System
> **审计来源**：`packages/prototypes/desktop/features/social-chat`（ChatArea.tsx 2755 行 / state.ts）
> 上一轮迁移只抄了「消息解剖」，漏掉了生命周期层，本增量按真身功能面对齐。

## 1. 从真身补齐的功能点

- **投递状态机** `sending → delivered`（本地 700ms 模拟），种子含 `read/delivered/failed` 全态；
  气泡下 meta 行：✓ 已发送 / ✓✓ 已送达 / ✓✓ 已读（紫）/ 转圈发送中 / 红字失败。
- **失败内联重试**：失败消息红字「失败，点击重试」→ sending → 900ms 后已送达；
  种子保留「已保存在本机，等待发送。」服务胶囊（离线队列语义）。
- **编辑**：⋯菜单「编辑」（仅本人、4 分 30 秒内、文字消息）→ composer 进入编辑态
  （编辑横幅、工具钮禁用、发送钮变「保存修改」、内容未改不可发）→ 保存保留原时间戳/顺序，
  气泡下出现「已编辑」。
- **撤回**：窗口内「撤回」→ 消息变斜体占位「你撤回了一条消息/对方撤回了一条消息」，
  反应/附件/链接一并清除，行身份保留。
- **消息置顶**：⋯菜单切换，气泡下出现紫色 Pinned chip。
- **操作条收敛为真身结构**：4 个快捷钮（😀 / ↩ 回复 / ↗ 转发 / ⋯）+ ⋯ 菜单 6 项
  （话题/置顶/复制/编辑/撤回/删除，删除前分隔线）。
- **24 枚反应**（真身同款 6×4 面板），反应以 emoji 为键，可再次点击取消。
- **typing 三点气泡**：在线单聊发送后 1.8s 对端输入态（生产由 SSE 驱动，原型本地模拟）。
- **纯 emoji 消息**：去气泡、34px 大字，meta 行独立显示。

## 2. 相对真身的 UX 改进（经审计后有意为之）

1. **超时编辑/撤回不禁用为「消失」**：真身 `withinWindow` 不满足直接不渲染菜单项；
   原型渲染为**禁用 + title/aria 原因**「仅发送后 4 分 30 秒内可用」，避免用户以为没有该能力。
2. **非本人消息的编辑/撤回**同样禁用并说明「仅可对自己发送的消息操作」，而非隐藏。
3. **无文本消息的复制**禁用并说明，而非点击无效。
4. 菜单触发统一走 peers-ui Menu 的 `onAction`（初版条目同时挂 `onActivate` 导致置顶双触发取消，已修）。

## 3. 探针（能力 85/85 OBSERVED，consumer 18/18，双宽溢出全绿，0 console error）

新增 7 场景：`msg-send-delivered`、`msg-inline-retry`、`msg-edit`（编辑态→保存→已编辑标记→
composer 回 compose）、`msg-recall`（墓碑）、`msg-pin`（chip）、`msg-typing`
（expect 中段断言出现→2.1s 后消失）、`msg-mutation-window`（旧消息菜单编辑/撤回 disabled）；
旧 `msg-react-copy-link`/`msg-delete`/`composer-emoji` 适配新操作条与 emoji-only 渲染。

## 4. UNPROVEN

真实 Station 投递回执与已读传播、离线队列重试策略、编辑/撤回的对端同步与 MLS envelope 语义、
服务端强制窗口、typing 的 SSE 信令。
