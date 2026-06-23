# PRD — 语音 / 视频通话原型

## 1. 概述

Peers-Touch Desktop 一对一语音 / 视频通话的 UI / UX 原型。基于聊天界面，在好友会话内发起与接听通话。原型表达交互与视觉，不接真实 WebRTC / 后端。

对应架构文档：`docs/architecture/realtime/voice-video-calls.md`。

## 2. 角色与场景

- 主叫（Caller）：在好友会话点击语音 / 视频按钮发起通话。
- 被叫（Callee）：收到全局来电弹窗，可接听或拒绝。
- 通话双方：在通话中可静音、开关摄像头、最小化、挂断。

## 3. 布局结构

复用聊天主界面骨架（左侧导航 + 会话列表 + 聊天区），在其上叠加通话浮层：

- **聊天 Header**：右上角语音、视频入口按钮；不满足条件时置灰并提示。
- **来电弹窗（Incoming）**：全局居中模态，独立于当前会话，显示头像、昵称、通话类型、接听 / 拒绝。
- **呼出浮层（Outgoing）**：右下角浮动卡片，显示对端头像、昵称、`Calling...`、取消。
- **语音通话中（Active Voice）**：右下角浮动卡片，头像、计时、音量动效、控制条。
- **视频通话中（Active Video）**：较大浮层，远端画面 + 本地 PiP，悬浮控制条。
- **弱网重连（Reconnecting）**：浮层顶部状态条 `Reconnecting...`，保留画面。
- **结束 / 失败（Ended / Failed）**：浮层短暂提示通话结果（已结束计时、已取消、对方拒绝、未接通、权限被拒、网络失败）。

## 4. 状态机（与架构文档一致）

```
idle
 ├─ 发起 -> permission_checking -> ringing_out -> connecting -> active -> ended
 └─ 收到来电 -> ringing_in
        ├─ 拒绝 -> ended
        └─ 接听 -> permission_checking -> connecting -> active
任意非终态：hangup -> ended；权限拒绝 -> failed；超时 -> missed；ICE 失败 -> failed
active -> reconnecting -> active | failed
```

## 5. 关键交互

- 点击 Header 语音 / 视频按钮 -> 呼出浮层（ringing_out）。
- 模拟对端响应：呼出态可一键切换到 connecting / active / 对方拒绝 / 未接通。
- 来电态：接听 -> 进入通话；拒绝 -> 结束。
- 通话中：静音切换、摄像头切换、最小化 / 展开、挂断。
- 失败 / 结束态：自动回到 idle 或显示结果提示后关闭。
- 通话期间聊天区仍可见、可滚动（体现“通话不阻断消息”）。

## 6. 视觉规范

- 与 chat 原型一致：Tailwind 工具类、slate 中性色、圆角卡片、轻阴影。
- 通话主色用于接听 / 进行态（绿色系），危险操作用红色（挂断 / 拒绝）。
- framer-motion 处理浮层进出场与振铃脉冲动画。
- 图标统一用 lucide-react（Phone / Video / Mic / MicOff / VideoOff / PhoneOff 等）。

## 7. 非目标

- 不实现真实 WebRTC、getUserMedia、信令、TURN。
- 不实现群通话、屏幕共享、录制、字幕。
- 不接真实 i18n（占位英文文案，落地替换 locale key）。
