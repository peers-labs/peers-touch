# Prototype Workspace — 语音 / 视频通话系统原型 v1.0

Desktop 一对一语音 / 视频通话的交互原型。用项目标准原型技术栈（React + Tailwind +
framer-motion + lucide-react）表达通话各状态的 UI / UX，不接真实 WebRTC / 后端。

对应架构设计文档：`docs/architecture/realtime/voice-video-calls.md`。

## Directory structure

### codebase (code directory)

Code files containing the complete implementation of the prototype.

```
├── src/
│   ├── lib/
│   │   └── utils.ts
│   ├── pages/
│   │   └── CallApp.tsx
│   └── App.tsx
├── dependencies.json
├── meta.json
└── prototype-route.json
```

### notebook (generation notes)

Note files documenting the reasoning and decisions during prototype generation.

```
├── memo-user-request.md
├── prd-call-app.md
└── plan-round-1.md
```

## 状态走查

原型用 URL searchParams 驱动状态，便于评审逐态走查。页面顶部内置
"Prototype states" 切换条，可在以下状态间切换：

| 状态 | URL | 说明 |
| --- | --- | --- |
| Idle | `?call=none` | 聊天首屏，Header 显示语音 / 视频入口 |
| Outgoing | `?call=outgoing&media=video` | 呼出振铃浮层，可模拟对端接听 / 未接通 |
| Incoming | `?call=incoming&media=video` | 全局来电模态，接听 / 拒绝 |
| Active | `?call=active&media=video` | 通话中浮层（视频含远端画面 + 本地 PiP；语音含音量动效） |
| Reconnecting | `?call=reconnecting&media=video` | 弱网重连状态条，保留画面 |
| Ended | `?call=ended&reason=hangup` | 通话结束提示（含计时） |
| Failed | `?call=failed&reason=denied` | 失败提示（权限被拒 / 未接通 / 网络失败） |

## 与产品落地的边界

- 原型内的 "Prototype states" 切换条与 "Peer accepts / No answer / Simulate weak
  network" 按钮仅为评审模拟，不属于产品 UI。
- 文案为占位英文；落地时所有用户可见文案必须走 i18n（`packages/locales/`），
  不得硬编码。
- 真实通话状态由 Desktop runtime 拥有并跨会话存活；本原型用 searchParams 仅为演示。
