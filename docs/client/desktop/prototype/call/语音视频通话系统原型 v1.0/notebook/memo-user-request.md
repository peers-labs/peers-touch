# Memo — 用户需求与约束

## 来源

- 任务：为 Peers-Touch Desktop 设计一对一语音 / 视频通话功能。
- 上游架构文档：`docs/architecture/realtime/voice-video-calls.md`。
- 用户明确要求：
  1. 不要过度造轮子，P2P 语音视频用业界成熟方案（WebRTC + ICE + TURN）。
  2. 方案要看全局，保证整体架构一致性，复用已有 relay / TURN / 信令基建。
  3. 先出设计文档，再出原型；原型必须用项目真实前端库实现，而不是 Markdown 草图。
  4. 原型必须遵循项目标准原型规范（notebook 推理 + codebase 代码）。

## 关键约束（来自架构文档与代码基线）

- 信令复用唯一实时通道：`POST /realtime/signal` + `/events/stream` SSE，禁止新增专用通道或恢复旧 ICE 轮询。
- WebRTC 仅承载媒体面；文本永远走 SSE，不进 DataChannel。
- 来电是全局事件，不依赖当前停留的会话。
- 通话状态由 Runtime 拥有，必须跨会话切换存活；页面是纯渲染层。
- 任何 UI 不得暴露原始 SDP / ICE candidate / TURN 凭证 / deviceId。
- 所有用户可见文案最终需走 i18n（原型用占位文案，落地时替换为 locale key）。

## 本原型的目标

- 用真实可运行的 React 代码表达通话各状态的 UI / UX。
- 覆盖：聊天入口、呼出振铃、来电、语音通话中、视频通话中、弱网重连、结束、失败、权限被拒。
- 通过 URL searchParams 驱动状态切换，便于评审逐态走查。
- 不接任何真实后端 / WebRTC，纯前端 mock，符合原型定位。
