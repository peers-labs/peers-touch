# 通话面：来电与群通话（迁移增量 14）

> **Status**: draft · **Created**: 2026-10-31 · **Owner**: Client Platform · UI System
> **旧来源**：`CallSurface.tsx`（incoming/outgoing/active 状态机、compact tray、设备切换、
> 显示模式）、`GroupCallSurface.tsx`（参与者网格/发言高亮/连接质量/房间事件）、
> `modules/p2p/callP2p`、`modules/groupCall`

## 1. 产品边界（本地真实状态，不接 P2P）

- **1:1 呼出**（增量 11 保留）：振铃 1.6s → 接通 0.9s → 计时；静音/摄像头开关、取消/挂断。
- **1:1 来电（新）**：`incoming` 面——头像/名字/「邀请你语音（视频）通话…」、
  绿色接听 / 红色拒绝（带文字标签，全屏 dim 而不是旧版右下角 tray，与原型窗内应用边界一致）。
  接听 → connecting → active；拒绝 → 「已拒绝」收尾后消失。
- **群通话（新）**：群会话头部入口 → ringing → 「正在加入群通话…」→ active；
  参与者网格本地居首，远端按确定性 stagger 陆续加入（5 人 5 格）；
  发言者琥珀描边按节拍轮换；格内关麦/关摄像头角标；头部「群通话 · 群名」胶囊；
  状态行 `mm:ss · n 人在通话`；静音联动本地格 `data-mic`；视频群通话带摄像头开关。
- **来电演示入口**：单人会话详情侧拉页「来电演示（本地原型）」段，两个明确标注的模拟按钮
  （语音/视频）。真实来电由信令推送（旧实现是全局 SSE，可在浏览别的会话时弹出），
  原型无信令后端，用显式演示入口而非随机/定时器弹窗。

## 2. 旧设计审计

- 旧 `CallSurface`/`GroupCallSurface` 是 page 级 portal tray（compact/chat/fullscreen 三显示模式、
  设备枚举菜单、remote stream 绑定、reconnecting、通话结束原因 toast）。
  原型只保留**状态语义与信息层级**：tray 降为窗内全屏 dim 面；设备切换/reconnect/结束原因
  （rejected/no-answer/busy/network-failed）随真实 P2P 接线，列为 UNPROVEN。
- 群网格保留旧版关键信号：参与者到齐、本地格、关麦/关摄像头角标、发言描边、人数计数；
  连接质量点（excellent/poor 的红黄绿）省略——本地模拟没有真实网络质量，伪造质量色是假信号。
- 通话状态从 ConversationView 上提到 ChatFeature（`call = {conversationId, kind, direction}`），
  与旧实现「peer-aware 全局、不属于单个会话」的归属一致；ConversationView 仅在归属当前会话时渲染。
- 1:1 网格不渲染（旧版也只有音视频面）；群视频的远端画面用头像位，真实视频流 UNPROVEN。

## 3. 组件与探针

- `CallOverlay.tsx` 重写：direction/incoming、Participant 模型、stagger 加入、发言轮换；
  `ConversationPanels.tsx` DetailSheet 增来电演示段；`ChatFeature.tsx` 持有 call；
  `chat.css` 增 accept/decline、网格、格角标样式。
- 新增 3 场景并修正 1 场景，能力 **78/78 OBSERVED**（双宽溢出门同过，0 console error）：
  `call-audio`（改为真正的 1:1 会话，断言 scope=one）、`call-incoming-accept`
  （direction=in → 接听 active）、`call-incoming-decline`（拒接消失）、
  `call-group-active`（5 格到齐/发言高亮 gte1/本地静音联动 data-mic=off）。
  consumer 18/18，tsc 干净。Playwright Journey 截图核验来电面与群网格。

## 4. UNPROVEN

真实 WebRTC 信令/SDP/ICE、来电系统推送与跨会话弹出、通话结束原因区分、麦克风/摄像头设备枚举切换、
网络重连、连接质量点、远端视频画面、群通话房间事件（他人主动加入/离开的真实时序）、
compact/全屏显示模式与桌面壳 global tray。
