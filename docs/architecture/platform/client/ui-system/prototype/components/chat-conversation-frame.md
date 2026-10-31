# 对话框架与通话入口（迁移增量 11，增量 19/20 修订）

> **Status**: draft · **Created**: 2026-10-31 · **Updated**: 2026-10-31（增量 20）
> · **Owner**: Client Platform · UI System
> **旧来源**：`ChatMessageArea`（头部操作、消息行布局）、`ChatDetailPanel`、
> `SearchMessagesModal`、`ChatThreadPanel`、
> `CallSurface`/`GroupCallSurface`（入站在增量 14 补全，HUD 形态见 chat-calls.md）

## 1. 产品边界（全部 peers-ui，本地真实状态）

- **对话头部**：群聊重叠头像组 + 成员数，单人头像 + 在线/免打扰；
  4 个入口：语音通话、视频通话、搜索聊天记录、会话详情。
- **1:1 通话浮层 `CallOverlay`**：ringing（1.6s）→ connecting（0.9s）→ active（计时），
  静音/摄像头开关（视频通话）、红色挂断；视频通话有本地预览位；取消呼叫/挂断后浮层消失。
- **会话详情侧拉页**：群成员列表（单人显示身份卡）、消息免打扰/置顶两个 Switch（与轨行标记双向联动）、
  共享媒体九宫缩略。
- **消息搜索 Dialog**：关键词过滤本会话非服务消息，空查询给最近 5 条；结果行（发送者/摘要/时间）可点。
- **话题侧拉页**：种子消息 + 3 条种子回复 + 回复输入框；发送后回复 +1、入口计数联动、输入清空。
- 服务消息（入群/建群）以居中胶囊渲染。
- **消息行对齐（增量 20 回归 desktop ChatArea）**：`.sk-msg` 为 flex 行，
  `align-items: flex-start`——对方头像与气泡顶平齐；群聊时头像与发送者名顶平齐；
  纯 emoji 大行例外，底对齐（desktop parity）。头像统一 32px（含撤回墓碑、typing）。
  时间戳在气泡**外**的 meta 行（气泡下方，与已编辑/投递状态/反应同列），
  不再画进气泡内部。

## 2. 旧设计审计

- 桌面端详情/Thread 是独立大面板；原型统一为 `.sk-side-sheet` 同位侧拉页（绝对定位、
  不挤占对话列），关闭控件与分隔节奏一致。
- 通话状态机保留 desktop 的阶段语义（振铃/接通/通话中），用确定性定时器模拟，
  不做假的立即接通；浮层用深色玻璃材质覆盖对话列而非整窗，符合窗框内应用边界。
- 网格布局显式列位（增量 20 起：rail 在左 300px 列、main 在右 1fr 列，
  对齐 desktop SocialChatPage 的左轨右话序），修复了子元素自动放置
  把中栏压进 300px 轨道的缺陷；me 气泡列右对齐补全。

## 3. 门禁

新增 5 场景（能力 67/67）：头部 4 入口、语音通话状态机（finalizer 挂断）、
详情面板联动免打扰、消息搜索、话题回复计数。consumer 18/18，tsc 干净，0 console error。

## 4. UNPROVEN

来电接听、群通话多人网格、真实 WebRTC 音视频、消息搜索结果定位高亮、
Thread 与消息流的已读同步。
