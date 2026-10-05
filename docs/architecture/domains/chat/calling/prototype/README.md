# 语音 / 视频通话 — 原型

> **Status**: superseded
> **Version**: v0.1
> **Created**: 2026-06-22 | **Updated**: 2026-09-21
> **落地目标**: Desktop 好友聊天内的一对一语音 / 视频通话（`apps/desktop`，对应 `CallSurface`）；**原型本身只是 React web 展示**，不碰真实 WebRTC / 信令 / store / tauri
> **总账状态**: superseded（由 [Social Chat 原型](../../../social/core/prototype/README.md) 接替）
> **Owner**: Peers-Touch Realtime Team
> **Module**: `packages/prototypes/desktop/features/social-chat/`

---

## 原型在哪

源码在 `packages/prototypes/desktop/features/social-chat/src/components/ChatArea.tsx`。可预览入口收敛到 `packages/prototypes/desktop/shell/`：stream call 作为 Social Chat 会话内的语音/视频状态与浮层承载，不再作为 Prototype Portal 顶层独立卡片或 Desktop Shell 独立页面展示。

这个原型展示 **Desktop 一对一语音 / 视频通话长什么样**：在好友聊天界面之上，演示通话从呼出、来电、接通、弱网重连到结束 / 失败的完整生命周期 UI / UX。它不接真实 WebRTC / 信令 / TURN，纯前端 + mock 驱动，只为对齐"终态产品的样子"。

## 落地目标

- Desktop 好友聊天内的通话体验，落地工程为 `apps/desktop`，对应 `src/components/chat/CallSurface.tsx`（ringing modal + in-call HUD）与会话头部的通话入口。
- 真实通话状态由 Desktop runtime 拥有并跨会话存活；落地由桌面工程参照本原型按其运行时（真实 WebRTC + sealed signaling）重新实现，原型本身不要求能直接搬成产物。

## 怎么跑

```bash
make run-prototype desktop
```

进入 `Desktop Shell` 后，从左侧「聊天」入口打开 Social Chat，再在会话头部使用语音 / 视频按钮进入 stream call。

技术栈：React + Vite + `lucide-react` + 内联样式 DOM（近似 LobeUI / antd 桌面壳的视觉），纯前端、mock 驱动，浏览器直接看。

## 怎么看（状态走查）

状态走查入口折叠在 Chat header 的 `...` action menu 内，可在以下状态间逐态走查，并切换语音 / 视频与结束原因：

| 状态 | 说明 |
|------|------|
| idle | 聊天首屏，会话头部显示语音 / 视频入口 |
| outgoing | 呼出振铃浮层，可模拟"对端接听" |
| incoming | 全局来电模态，接听 / 拒绝 |
| active | 通话中（视频含远端画面 + 本地 PiP；语音含头像 + 音量动效），含静音 / 摄像头 / 挂断控件 |
| reconnecting | 弱网重连状态条，保留画面 |
| ended | 结束提示（含通话计时） |
| failed | 失败提示（权限被拒 / 未接通 / 网络失败） |

## 对应设计

- 架构设计真源：[../voice-video-calls.md](../voice-video.md)。原型覆盖其 §6 通话生命周期、§10 UI/UX 契约。
- 信令 / 实时通道契约：[../event-stream.md](../../../../shared/communication/event-stream.md)。原型不实现信令，仅展示其驱动的界面状态。

## 总账状态

superseded（见 [原型总账](../../../../engineering/prototypes/README.md)）。当前 Call UX 的唯一原型真源是 [Social Chat 原型](../../../social/core/prototype/README.md)；本文件仅保留历史上下文，不再作为落地依据。

## 已知差异 / 待补

- Chat header `...` 内的 stream call simulator 与 HUD 上的 "Simulate …" 按钮仅为评审模拟，不属于产品 UI。
- 文案为占位英文；落地时所有用户可见文案必须走 i18n（`packages/locales/`），不得硬编码。
- 视觉用纯 DOM + 内联样式近似桌面壳，未引入 `@lobehub/ui` / antd theme token；落地以真实主题系统为准。
- 设备选择（麦克风 / 摄像头切换列表）、画中画拖拽、最小化为悬浮窗等交互未细化。
- 通话状态由本组件局部 state 演示；真实落地由 Desktop runtime 拥有并跨会话存活。
