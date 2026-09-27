# 语音 / 视频通话 — 原型

> **Status**: active
> **Version**: v0.2
> **Created**: 2026-06-22 | **Updated**: 2026-09-22
> **落地目标**: Desktop 好友聊天内的一对一语音 / 视频通话（`apps/desktop`，对应 `CallSurface`）；**原型本身只是 React web 展示**，不碰真实 WebRTC / 信令 / store / tauri
> **总账状态**: confirmed（见 [原型总账](../../prototypes/README.md)）
> **Owner**: Peers-Touch Realtime Team
> **Module**: `packages/prototypes/desktop/features/call/` and Desktop Shell Chat integration

---

## 原型在哪

独立状态模型在 `packages/prototypes/desktop/features/call/src/CallPrototype.tsx`。
Prototype Portal 的正式可见入口收敛到 `packages/prototypes/desktop/shell/`，其中
`packages/prototypes/desktop/features/social-chat/src/components/ChatArea.tsx`
复用同一状态语义并把通话作为 Chat 会话内浮层承载。

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
| ringing_all_devices | 同一 `call_id` 在当前 Desktop 与同 actor Mobile 同时响铃 |
| active | 通话中（视频含远端画面 + 本地 PiP；语音含头像 + 音量动效），含静音 / 摄像头 / 挂断控件 |
| active_here | 当前 endpoint 赢得仲裁并进入唯一媒体会话 |
| reconnecting | 弱网重连状态条，保留画面 |
| ended | 结束提示（含通话计时） |
| handled_elsewhere | sibling endpoint 已处理；当前端停止响铃并释放临时资源 |
| failed | 失败提示（权限被拒 / 未接通 / 网络失败） |

## 对应设计

- 架构设计真源：[../voice-video-calls.md](../voice-video-calls.md)。原型覆盖其 §6 通话生命周期、§10 UI/UX 契约。
- 信令 / 实时通道契约：[../event-stream.md](../event-stream.md)。原型不实现信令，仅展示其驱动的界面状态。
- 多设备仲裁真源：[../../chat-lifecycle/decisions.md](../../chat-lifecycle/decisions.md) `CCU-D06` 与
  [../../chat-lifecycle/product-state-model.md](../../chat-lifecycle/product-state-model.md) §9.1。
- 产品追踪：`CHAT-C10`、`CHAT-C13`、`CHAT-J11`、`CCU-C08`、`CCU-J08`。

## 总账状态

confirmed（见 [原型总账](../../prototypes/README.md)）。原型方向已经 Owner 确认，Phase 1 落地进行中。

2026-09-22 的 CCU 执行确认重新确认了多设备三态。当前 source 的 Desktop Shell
build 通过；已提交证据与待补证据如下：

| Layer | State | Evidence |
|---|---|---|
| L2 | `ringing_all_devices` | `docs/architecture/realtime/prototype/evidence/ccu-20260922/ringing-all-devices.png` |
| L2 narrow Desktop | `ringing_all_devices` | `UNPROVEN` — repeatable checker exists, but no current screenshot is committed |
| L2/L3 | `active_here` after Accept and microphone/camera selection | `docs/architecture/realtime/prototype/evidence/ccu-20260922/active-here.png` |
| L2/L3 | `handled_elsewhere` after sibling acceptance | `docs/architecture/realtime/prototype/evidence/ccu-20260922/handled-elsewhere.png` |

诊断菜单在状态选择后关闭，避免覆盖来电模态或终态提示。截图仅为 prototype
confirmation，不是生产 call-resolution proof。

可重复检查：

```bash
make -w run-prototype
cd apps/desktop
PROTOTYPE_URL=http://localhost:3200 node scripts/ccu-prototype-check.mjs
```

## 已知差异 / 待补

- Chat header `...` 内的 stream call simulator 与 HUD 上的 "Simulate …" 按钮仅为评审模拟，不属于产品 UI。
- 当前英文文案表达已确认的状态语义；落地时所有用户可见文案必须走 i18n
  (`packages/locales/`)，不得硬编码。
- 视觉用原型 token 与 DOM 展示信息层级；生产实现继续使用真实主题与组件系统。
- 麦克风和摄像头选择已可交互；选项为固定 mock。真实硬件枚举、画中画拖拽和最小化
  浮窗仍由生产 runtime 验收，不属于 prototype backend proof。
- 通话状态由本组件局部 state 演示；真实落地由 Desktop runtime 拥有并跨会话存活。
