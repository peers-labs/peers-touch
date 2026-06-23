# Plan — Round 1

## 目标

按标准原型规范产出语音 / 视频通话原型 codebase，技术栈对齐 chat 原型：
React 18 + react-router-dom + framer-motion + lucide-react + clsx + tailwind-merge + Tailwind。

## 技术决策

- 单页 `CallApp.tsx`，复用聊天骨架（左导航 + 会话列表 + 聊天区）作为通话浮层的背景。
- 通话状态用 URL searchParams 驱动，便于评审逐态走查与原型路由树映射：
  - `call`：`none | outgoing | incoming | active | reconnecting | ended | failed`
  - `media`：`audio | video`
  - `reason`：`canceled | rejected | missed | denied | network`（仅 ended/failed 用）
- mock 数据：当前用户 + 一个好友会话，避免与真实后端耦合。
- 用 `lib/utils.ts` 的 `cn()` 合并类名，与 chat 原型保持一致。

## 组件拆分

- `CallApp`：页面容器，解析 searchParams，渲染骨架 + 当前通话浮层。
- `ChatBackdrop`：静态聊天骨架（导航 / 会话列表 / 消息区 / Header 通话入口）。
- `IncomingCallModal`：全局来电弹窗（接听 / 拒绝）。
- `OutgoingCallCard`：呼出振铃浮层（取消 + 模拟对端响应快捷键）。
- `ActiveCallCard`：通话中浮层（语音 / 视频两种布局 + 控制条 + 计时）。
- `CallStatusBanner`：重连 / 结束 / 失败提示。
- `CallControls`：静音 / 摄像头 / 最小化 / 挂断按钮组。

## 状态走查路由（prototype-route.json）

1. 聊天首屏（无通话）
2. 点击视频 -> 呼出振铃
3. 呼出 -> 通话中（视频）
4. 来电弹窗（视频）
5. 来电 -> 通话中（语音）
6. 通话中 -> 重连
7. 结束态（计时）/ 失败态（未接通、权限被拒）

## 验证

- 不接真实依赖；用独立 tsx，符合原型沙箱。
- 静态检查：无 console / debugger；类名与图标引用正确。
- 文案为占位英文，标注落地需替换 i18n key。

## 风险

- 原型沙箱默认有 Tailwind + 上述依赖；不要引入 antd / lobehub（上一版错误已撤除）。
- 浮层层级（z-index）需高于聊天骨架，但来电模态需最高层。
