# 通话面：1:1 HUD 托盘、来电、群通话（迁移增量 14，增量 19 重构）

> **Status**: draft · **Created**: 2026-10-31 · **Updated**: 2026-10-31（增量 19）
> · **Owner**: Client Platform · UI System
> **旧来源**：`CallSurface.tsx`（outgoing/active 状态机、compact tray、设备切换、
> reconnecting、结束原因 toast）、`IncomingCallModal`（居中来电、多设备同响）、
> `GroupCallSurface.tsx`（参与者网格/发言高亮/房间事件）、
> `modules/p2p/callP2p`、`modules/groupCall`

## 1. 产品边界（本地真实状态，不接 P2P）

- **1:1 呼出**：振铃 1.6s → 接通 0.9s → 计时；进入 active 后通话面落**右下 HUD 托盘**，
  不再是覆盖整个会话的全屏 dim——与真身 `CallSurface` compact tray 一致，
  通话中可以继续读消息、输入与发送（探针用 Enter 发消息证明）。
  HUD 层 `.sk-call-hud-layer` 全屏覆盖但 `pointer-events:none`，仅托盘本体吃事件。
- **1:1 来电**：保持**居中模态**（全屏 dim，比托盘更匹配来电的中断语义）。
  头像/名字/「邀请你语音（视频）通话…」、绿色接听 / 红色拒绝（带文字标签）。
  接听 → connecting（0.9s，呼出/呼入共享同一条接通定时器）→ active HUD；
  拒绝 → 结束通知胶囊（原因 `rejected`），自动收场。
- **多设备同响（增量 19 新增）**：详情面板第三个演示钮「多设备同响」。
  来电卡显示「这台 Mac 和你的手机同时收到语音（视频）来电」，操作变为
  拒绝 / **手机已接**（primary 中键）/ 接听；选「手机已接」→ `handled-elsewhere`
  通知胶囊「已在其他设备接听」，1.8s 自动消失。单设备来电不出现中键。
- **弱网重连（增量 19 新增）**：active ↔ reconnecting 双向切换；reconnecting 时
  状态行变琥珀色「正在重连…」+ WifiOff 图标，视频远端降亮模糊，计时暂停语义保留
  （本地面不做真实计时冻结，仅切态）。
- **六种结束原因（增量 19 新增）**：`hangup` 通话已结束、`canceled` 通话已取消、
  `rejected` 对方已拒绝（中性色胶囊）；`missed` 无人接听、`denied` 麦克风/摄像头
  权限被拒绝、`network` 连接失败，请重试（危险色 `#b0413a` 胶囊）。
  结束后面板消失，仅留左下胶囊通知，2.6s 自动收场。
- **设备选择（增量 19 新增）**：active HUD 内麦克风 select（视频时加摄像头 select），
  选项为本地枚举样例；静音/摄像头开关在控制行，pressed 态有独立填充。
- **群通话**：群会话头部入口 → ringing →「正在加入群通话…」→ active；
  参与者网格本地居首，远端按确定性 stagger 陆续加入（5 人 5 格，桌面宽一行）；
  发言者琥珀描边按节拍轮换；格内关麦角标；头部「群通话 · 群名」胶囊；
  状态行 `mm:ss · n 人在通话`；静音联动本地格 `data-mic`。群面保留全屏 dim。
- **原型模拟器**：控制行 🐛 钮打开仅原型可见的状态面板（锚定在控制行上方，
  不遮挡自己的开关），可切 reconnecting 与六种结束原因。真实产品由信令驱动，
  该面板是对「非快乐路径可观测」的显式演示，不是隐藏彩蛋。
- **来电演示入口**：单人会话详情侧拉页「来电演示（本地原型）」段三个明确标注的
  模拟按钮（语音 / 视频 / 多设备同响）。真实来电由信令推送（旧实现是全局 SSE，
  可在浏览别的会话时弹出），原型无信令后端，用显式演示入口而非随机/定时器弹窗。

## 2. 旧设计审计与本增量修正

- 增量 14 曾把 1:1 通话降为窗内全屏 dim；增量 19 审计真身 `CallSurface` 后认定这是
  相对真身的**退化**：通话是伴随态而非独占态，全屏遮罩阻断了「边通话边翻聊天」的
  真实用法。1:1 回退为右下托盘，仅来电与群通话保留居中遮罩（中断/多人聚焦语义）。
- 真身的 reconnecting、结束原因 toast、设备枚举菜单在增量 14 被整体推迟为 UNPROVEN；
  增量 19 将其**状态语义**本地落地（可观察、可探针），真实信令/媒体仍 UNPROVEN。
  连接质量点（excellent/poor 红黄绿）继续省略——本地没有真实网络质量，伪造质量色是假信号。
- 真身多设备同响是系统级推送联动；原型只演示「他端已接听」这一本机收场路径。
- 旧 `GroupCallSurface` 的 compact/fullscreen/chat 三显示模式不迁移：原型窗即产品框，
  桌面壳 global tray 属系统集成层。
- 通话状态继续由 ChatFeature 持有（`call = {conversationId, kind, direction, multi?}`），
  ConversationView 仅在归属当前会话时渲染。

## 3. 组件、探针与工艺

- `CallOverlay.tsx`：Phase 状态机
  `incoming | ringing | connecting | active | reconnecting | handled-elsewhere | ended`；
  `EndReason` 六枚举与 `CALL_END_REASONS`（含 tone）；呼出只走 ringing，
  connecting→active 定时器双向共享；群参与者 stagger/发言轮换逻辑保留。
- `ConversationPanels.tsx`：详情面板来电演示段三按钮。
- `ChatFeature.tsx`：call 状态加 `multi?`。
- `chat.css`：HUD 托盘（音频/视频两种 pane、E2E 徽章、设备行、浅色面控件覆写）、
  来电三操作、结束胶囊（中性/危险两色）、模拟器面板（`bottom:100%+8px`
  锚定控制行上方，避免遮挡自己的开关）；托盘 `overflow:visible`，圆角由视频 pane 自持。
- 群网格 `minmax(92px,1fr)`：508px 桌面内容宽下 5×92+4×10=500 一行 5 格，
  ≤480px 自然两列；群面 craft battery 持续通过。
- 探针（门禁 96/96 OBSERVED，双宽溢出同过，0 console error）：
  `call-audio`（断言迁到 `.sk-call-hud-layer`/`[data-call-hud-status]`）、
  `call-incoming-accept`（含来电中态断言 + 接听落 HUD active）、
  `call-incoming-decline`（先断言拒绝通知，再等自动收场）、
  `call-group-active`（5 格/发言/本地静音联动）、
  `call-hud-nonblocking`（无 scrim、hud-layer `pointer-events:none`
  计算样式、通话中 Enter 发消息成功且通话仍 active）、
  `call-reconnect`（切态文案/可恢复/设备行保留）、
  `call-end-reasons`（6 原因列全、network 危险胶囊、自动消失后可重新发起、
  canceled 中性胶囊）、
  `call-incoming-multi`（multi 标记/同响文案/他端接听入口/handled-elsewhere 收场）。
  consumer 18/18，tsc 干净，Playwright Journey 双宽截图人审。

## 4. UNPROVEN

真实 WebRTC 信令/SDP/ICE、麦克风/摄像头真实采集与权限裁决（`denied` 目前是模拟原因）、
真实设备枚举与切换生效、网络质量探测与自动重连触发（当前手动模拟）、
来电系统推送与跨会话弹出、多设备同响的真联动（手机接听由系统信令驱动）、
远端视频画面、群通话房间事件（他人主动加入/离开的真实时序）、
compact/全屏显示模式与桌面壳 global tray。
