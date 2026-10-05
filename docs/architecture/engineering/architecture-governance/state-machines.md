# 状态机目录（State Machine Catalog）

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-21 | **Updated**: 2026-06-21
> **Owner**: Architecture Team

---

## 1. Document Scope

本文档定义：

- 全系统**真·有限状态机（FSM）**的统一索引：前端（Desktop embedded WebView / Mobile）、桌面端 Rust（src-tauri）、后端 Station（Go）。
- 每个状态机的：状态集、触发/转换、Owner 代码模块、是否已有独立设计文档。
- 对**已有设计文档**的状态机：索引过去。
- 对**没有独立设计文档**的状态机：在本目录内给出**精简设计**（状态 / 触发 / 转换 / 不变量），并标注 Owner 模块，作为当前真源；待其复杂度增长时再拆分到对应业务模块的文档集。

本文档不定义：

- 完整架构设计（见各模块 `architecture/<taxonomy>/<module>/`）。
- 仅作展示/分类用途的 proto 枚举、错误码、一次性请求态等**非正式状态标志**（不收录，见 §6 说明）。

## 2. 什么算"状态机"（收录口径）

收录标准（必须同时满足）：

1. 有**明确的离散状态集合**；
2. 有**定义良好的转换规则 / 触发事件**；
3. 状态被**实际驱动流转**（而非纯展示枚举或一次性请求结果）。

按本口径，未发现使用 XState 等第三方 FSM 库——全部为手写（reducer / 联合类型 + store / enum + match / 计算式 lease）。

## 3. 总览

当前共 **23** 个真·FSM：前端 11、桌面端 Rust 4、Station 后端 8。

| 层 | 真·FSM 数 | 已有独立设计 | 本目录内嵌精简设计 |
|----|-----------|--------------|--------------------|
| 前端（TS/React/Lynx）| 11 | 1 | 10 |
| 桌面端（Rust/Tauri）| 4 | 2 | 2 |
| Station（Go）| 8 | 1 | 7 |

设计最严谨的三个标杆 FSM：**Identity Lifecycle**（前端，纯 reducer + 显式事件）、**Presence Supervisor**（Rust，state/trigger/transition 三分离）、**Access Gate**（Station，proto/服务/持久化三层一致）。

---

## 4. 前端状态机（Desktop embedded WebView / Mobile）

### 4.1 Identity Lifecycle（身份/登录生命周期内核）✅ 已有设计

- **状态**：`booting` · `checkingLaunchContext` · `resolvingSession` · `accountGate` · `pinGate` · `authenticatedPendingCompletion` · `authenticated` · `revoked`（`authenticated` 内含子状态机：profile `unknown→syncing→ready/stale/failed`、accountCache `unknown→refreshing→ready/failed`、avatar `unknown→remoteKnown`）
- **触发**：`BOOT_STARTED` / `SESSION_RESTORED` / `SESSION_RESTORE_FAILED` / `PIN_REQUIRED` / `LOGIN_SUCCEEDED` / `SESSION_REVOKED` / `LOGOUT_REQUESTED` 等（`IdentityEvent`）
- **Owner**：[identityLifecycle.ts](../../../../apps/desktop/src/kernel/identityLifecycle.ts) · [identityRuntime.ts](../../../../apps/desktop/src/kernel/identityRuntime.ts)
- **设计文档** → [client/desktop/identity-lifecycle.md](../../../client/desktop/identity-lifecycle.md)
- **闭环 invariant** → [desktop-identity-lifecycle-closure.md](../../../knowledge/invariants/desktop-identity-lifecycle-closure.md)
- 派生投影：`AppState`（`onboarding`/`resuming`/`ready`，由 phase 派生于 [identityRuntime.ts](../../../../apps/desktop/src/kernel/identityRuntime.ts#L149)）不单列。

### 4.2 WebRTC Friend Chat P2P Connection ⚠️ 内嵌精简设计

- **状态**：`idle` → `connecting` → `connected` → `failed` / `closed`（附属维度 `FriendChatP2pTransport`：`direct` / `relay` / `null`，由 ICE 统计选择）
- **触发**：发起信令会话→`connecting`；WebRTC 连接成功→`connected`；连接失败 / datachannel error→`failed`；主动关闭→`closed`
- **不变量**：每对端一条连接；`failed`/`closed` 后需重新 `startConnection`；transport 与 presence 正交（online 既可能 direct 也可能 relay）。
- **Owner**：[callP2p.ts](../../../../apps/desktop/src/modules/p2p/callP2p.ts#L66)（`conn.status`，转换见 :355/:455/:460/:464/:494/:531）
- **关联架构** → [realtime/event-stream.md](../../shared/communication/event-stream.md)（信令面）

### 4.3 WebRTC Call Lifecycle（音视频呼叫）⚠️ 内嵌精简设计

- **状态**：`idle` · `outgoing`（已发 CALL_REQUEST 等待应答）· `incoming`（收到 CALL_REQUEST 等待应答）· `active`（媒体流动）· `ended`（终态）（媒体维度 `CallMediaKind`：`audio` / `video`）
- **触发**：`startCall`→`outgoing`；收到 CALL_REQUEST→`incoming`；接受 / 媒体就绪→`active`；CALL_END / 挂断→`ended`
- **不变量**：呼叫由 `callId` 标识，防陈旧信令；`ended` 为本轮终态，下次 `startCall` 重新开始；呼叫 FSM 复用 §4.2 的 P2P 连接通道。
- **Owner**：[callP2p.ts](../../../../apps/desktop/src/modules/p2p/callP2p.ts#L187)（转换见 :712/:725/:785/:830/:901）

### 4.4 Chat Outbox（发件箱重试队列，跨端共享）⚠️ 内嵌精简设计

- **状态**：`queued` → `sending` → `failed`（含 `attempts` / `nextAttemptAt` / `error` 退避元数据）
- **维度**：`ChatOutboxOperation`（`send-message` / `edit-message` / `recall-message` / `delete-message` / `ack-read`）× `ChatOutboxScope`（`friend` / `group`）
- **触发**：入队→`queued`；开始发送→`sending`；失败→`failed`（`attempts++`，按退避算 `nextAttemptAt`）；发送成功→出队
- **不变量**：纯可排空队列（pure drainable queue，见 [chatComposerInput.test.ts](../../../../apps/desktop/src/components/chat/chatComposerInput.test.ts#L469)）；离线安全；desktop 与 mobile 共享同一实现。
- **Owner**：[client-chat-core/src/index.ts](../../../../packages/client-chat-core/src/index.ts#L329)（`ChatOutboxStatus` / `ChatOutboxItem`）
- **关联契约** → [client/chat/chat-ux-contract.md](../../../client/chat/chat-ux-contract.md)

### 4.5 Chat E2EE Projection（端到端加密会话态，跨端共享）⚠️ 内嵌精简设计

- **状态**：`unknown` → `preparing` → `ready` / `blocked` / `error`（每会话一份投影，含 `updatedAt` / `error`）
- **触发**：开始建立会话密钥→`preparing`；X3DH / 密钥就绪→`ready`；被阻断（如指纹变更）→`blocked`；异常→`error`
- **不变量**：与 §4.7 Peer Trust 联动——指纹变更（`changed`）应使 E2EE 转 `blocked`；状态为投影，密钥真源在持久化账本。
- **Owner**：[client-chat-core/src/index.ts](../../../../packages/client-chat-core/src/index.ts#L317)（`ChatE2eeStatus`）

### 4.6 Chat Media Transfer / Draft（附件上传）⚠️ 内嵌精简设计

- **状态**：`queued` → `uploading` → `ready` / `failed`（草稿态 `ChatDraftStatus` 去掉 `queued`）
- **触发**：创建草稿→`uploading`；Messaging Engine source staging（Social IM）或 `uploadAgentAttachmentFile`（Agent）成功→`ready`；失败→`failed`
- **Owner**：类型 [client-chat-core/src/index.ts](../../../../packages/client-chat-core/src/index.ts#L33)（`ChatMediaTransferStatus`）；草稿 [useChatAttachmentDrafts.ts](../../../../apps/desktop/src/components/chat/composer/useChatAttachmentDrafts.ts#L11)

### 4.7 Peer Trust（TOFU 对端信任）⚠️ 内嵌精简设计

- **状态**：`unverified`（无记录）· `verified`（指纹匹配）· `changed`（指纹变更，TOFU 破坏）
- **触发**：`markVerified` 写入指纹；`evaluateTrust` 比对当前指纹与已存指纹（导出态）；`clearTrust` 重置
- **不变量**：基于持久化指纹账本计算，是导出函数而非可任意跳转的可变态；`changed` 应触发 §4.5 E2EE `blocked`。
- **Owner**：[peerTrust.ts](../../../../apps/desktop/src/modules/identity/peerTrust.ts#L23)
- **关联 UI 模式** → [ui-identity/patterns/trust-state.md](../../../client/common/ui-identity/patterns/trust-state.md)

### 4.8 Global Context Kernel（全局上下文内核：复合状态容器）⚠️ 内嵌精简设计

- **子状态机**：
  - `RuntimeAppState`：`booting` · `ready` · `degraded` · `shutdown`
  - Session `loginStatus`：`unknown` · `authenticated` · `unauthenticated`（派生）
  - Task item：`idle` · `running` · `failed` · `completed`
  - Network slice：`online` / `offline`（+ `degraded`）
  - Pipeline 编排：`bootstrap` / `session_login` / `session_logout` / `identity_switch` / `network_recovery` / `capability_refresh`（每条管道按 running→completed/failed 推进 task 并 publish 事件）
- **Owner**：类型 [global-context/types.ts](../../../../apps/desktop/src/kernel/global-context/types.ts)；实现 [global-context/store.ts](../../../../apps/desktop/src/kernel/global-context/store.ts#L409)（`runPipeline`）
- **设计文档** → [client/desktop/global-context-kernel.md](../../../client/desktop/global-context-kernel.md)（容器架构）/ [client/common/globalcontext.md](../../../client/common/globalcontext.md)；本目录仅登记其内嵌状态机清单。

### 4.10 Login Panel + Auth Attempt（登录页双 FSM）⚠️ 内嵌精简设计

- **Login Panel** (`LoginState`)：`logged_out` · `welcome_back` · `account_picker` · `pin_entry` · `relink_pin` · `set_pin`（初始态由 restoredUser / 多账号决定，用户在面板间导航）
- **Auth Attempt** (`AuthState`)：`idle` → `waiting` → `success` / `error`
- **不变量**：Login Panel 是 §4.1 Identity FSM 在登录页的 UI 投影，认证结果最终回流 Identity FSM。
- **Owner**：[LoginPage.tsx](../../../../apps/desktop/src/pages/LoginPage.tsx#L29)
- 同形请求态 FSM（`idle/waiting/success/error`）另见 [OAuth2ConnectModal.tsx](../../../../apps/desktop/src/components/settings/OAuth2ConnectModal.tsx#L14)。

### 4.11 Lark QR Login（扫码登录轮询）⚠️ 内嵌精简设计

- **状态**：`loading` → `pending` → `success` / `expired` / `error`
- **触发**：打开→`loading`；拿到二维码→`pending`；轮询 `oauthSimulateLarkPoll` 返回→对应终态
- **Owner**：[LarkSimulateLoginModal.tsx](../../../../apps/desktop/src/components/settings/LarkSimulateLoginModal.tsx#L13)
- 后端契约对应见 §5.3 OAuth2 Loopback。

### 4.12 Avatar Asset Runtime（移动端头像缓存）⚠️ 内嵌精简设计

- **状态**：`empty` · `cached` · `loading` · `ready` · `failed`（附属布尔 `stale`）
- **触发**：无源→`empty`；命中缓存→`cached`/`ready`；发起下载→`loading`；成功→`ready`；失败回退→`cached`(stale) 或 `failed`
- **Owner**：[avatarAssetRuntime.ts](../../../../apps/mobile/src/runtimes/avatarAssetRuntime.ts#L10)

> 另有 Mobile Launch（`station-selection`→`access-gate-chain`→`shell`，[App.tsx](../../../../apps/mobile/src/App.tsx#L34)）、Onboarding Splash Phase（`splash`/`transition`/`login`，[OnboardingView.tsx](../../../../apps/desktop/src/views/OnboardingView.tsx#L11)）、Station Health（`unknown`/`checking`/`online`/`offline`，[StationPicker.tsx](../../../../apps/desktop/src/components/common/StationPicker.tsx#L11)）三个轻量启动/探测相位机，转换逻辑散落在组件 effect 中，归为前端 FSM 但不单列精简设计。

---

## 5. 桌面端 Rust 状态机（src-tauri）

### 5.1 Presence Supervisor（在线状态机，per-actor）✅ 已有设计

- **状态**：`Offline` · `Online`（`Reconciling` 故意不作为第三状态，而是 supervisor 内部 `in_flight` 瞬时标志）
- **触发**（`PresenceTrigger`）：`AppLaunch` / `AppForeground` / `AppBackground` / `AppShutdown` / `IdentityRestored` / `IdentitySwitched` / `IdentityLoggedOut` / `NetworkOnline` / `NetworkOffline` / `Heartbeat` / `Manual`
- **Owner**：[domain/presence/mod.rs](../../../../apps/desktop/src-tauri/src/domain/presence/mod.rs) · [application/presence/mod.rs](../../../../apps/desktop/src-tauri/src/application/presence/mod.rs)
- **设计文档** → [architecture/domains/identity/presence-supervisor.md](../../domains/identity/presence-supervisor.md)
- **不变量** → [actor-presence-ownership.md](../../../knowledge/invariants/actor-presence-ownership.md)
- 与 Station 侧 §5（Presence Lease / Actor Status）通过 HTTP 协同。

### 5.2 Event-Stream 连接 Supervisor（SSE 实时连接）✅ 已有设计

- **状态**：`connecting` → `connected` → `disconnected`（重连）→ `cancelled`（用字符串/布尔 + `backoff_ms` 指数退避 500ms→30s 表达）
- **触发**：`start()`（登录/切换）/ `stop()`（登出/切换/退出，幂等）/ 连接失败 / `station closed stream` / SSE `Resync` / `Last-Event-ID` 续传 / 401 session revoked
- **Owner**：[infrastructure/event_stream/mod.rs](../../../../apps/desktop/src-tauri/src/infrastructure/event_stream/mod.rs)
- **设计文档** → [architecture/shared/communication/event-stream.md](../../shared/communication/event-stream.md)

### 5.3 OAuth2 Loopback 登录会话 ⚠️ 内嵌精简设计

- **状态**：`pending` → `completed` / `failed` / `expired`（终态写入 `completed_at`）
- **触发**：`next_loopback_session_id()` 创建→`pending`；OAuth 回调 `save_oauth_callback` / `update_loopback_session()` 推进终态
- **不变量**：终态后不再转换；前端（§4.11、`oauth2PollLoopback`）按此状态轮询。
- **Owner**：[application/oauth2/mod.rs](../../../../apps/desktop/src-tauri/src/application/oauth2/mod.rs#L60)（`LoopbackSessionState.status`）

### 5.4 PIN 锁定（Lockout）⚠️ 内嵌精简设计

- **状态**：`Unlocked`（`failed_attempts < 5`）↔ `LockedOut`（连续 5 次失败，进入 300s 冷却）；错误类型 `PinVerifyError`：`WrongPin{attempts_remaining}` / `LockedOut{remaining_secs}` / `Internal`
- **触发**：`verify_pin()` 失败→`failed_attempts++` 并记 `last_failed_at`；成功→清零；冷却到期→自动回 `Unlocked`
- **不变量**：锁定态由计数器 + 时间窗隐式表达；5 次阈值 / 300s 冷却为安全常量。
- **Owner**：[domain/pin_lock/mod.rs](../../../../apps/desktop/src-tauri/src/domain/pin_lock/mod.rs#L84)

> 应用层另有 Applet Task 字符串状态机（`queued`/`running`/`progress`/`completed`/`failed`/`cancelled`，[application/applets/mod.rs](../../../../apps/desktop/src-tauri/src/application/applets/mod.rs#L2108)）；密码学侧有 Double Ratchet 棘轮（[domain/crypto/double_ratchet.rs](../../../../apps/desktop/src-tauri/src/domain/crypto/double_ratchet.rs)），属协议状态推进而非业务离散 FSM，登记于此不单列精简设计。

---

## 6. Station 后端状态机（Go）

### 6.1 Access Gate（准入网关：Gate / Decision / Attempt 三联）✅ 已有设计

- **AccessGateState**（单关）：`UNSPECIFIED` · `PENDING` · `ACTION_REQUIRED` · `PASSED` · `BLOCKED` · `FAILED` · `SKIPPED`
- **AccessDecisionState**（整链聚合）：`UNSPECIFIED` · `PENDING` · `ACTION_REQUIRED` · `GRANTED` · `BLOCKED` · `FAILED`
- **AccessAttempt**（DB 行级生命周期）：`pending` → `action_required` → `granted` / `blocked` / `failed`；`cancelled` / `expired` 为终态
- **触发**：每 Gatekeeper `Evaluate()` 解析本关→`decisionStateForGate()` 折叠链态；`StartAttempt` / `CompleteLogin` / `CompleteInviteCode` / `CancelAttempt` 驱动持久化态
- **Owner**：[accessgate/](../../../../apps/station/frame/touch/accessgate) · [model/db/access_gate.go](../../../../apps/station/frame/touch/model/db/access_gate.go)
- **设计文档** → [architecture/platform/station/access/station-access-gate-architecture.md](../../platform/station/access/station-access-gate-architecture.md)
- **wire 契约 / playbook** → [access-gate-wire-contract.md](../../../knowledge/invariants/access-gate-wire-contract.md) · [adding-an-access-gate.md](../../../knowledge/playbooks/adding-an-access-gate.md)

### 6.2 Presence Lease（计算式在线状态机）⚠️ 内嵌精简设计

- **状态**：`StateOnline` / `StateOffline`（不直接存状态字段，由 `OfflineAt == nil && LeaseExpiresAt.After(now)` 推导）
- **触发**：`Heartbeat()` 续租→推导 offline→online 并返回 `wentOnline`；`Offline()` 主动下线；`Expire()` 后台扫描 lease 过期→offline
- **不变量**：状态是 lease 的纯函数；跃迁返回值用于广播 presence 事件；与桌面端 §5.1 Presence Supervisor 经 HTTP 协同。
- **Owner**：[presence/domain/types.go](../../../../apps/station/app/subserver/presence/domain/types.go#L5) · [presence/infrastructure/repo.go](../../../../apps/station/app/subserver/presence/infrastructure/repo.go#L42)

### 6.3 Actor Status 心跳状态机（看门狗驱动）⚠️ 内嵌精简设计

- **状态**：`ActorStatusOffline=0` / `ActorStatusOnline=1` / `ActorStatusAway=2`（`Away` 已定义、暂无写入路径）
- **触发**：`KeepAlive` / `UpdateActorStatus`→Online；看门狗 `ScanTimeouts`（1min tick）将超过 5min 阈值的非 offline 行批量置 Offline；登录置 Online、登出置 Offline
- **不变量**：超时驱动；与 §6.2 Presence Lease 是两套并存的在线模型（lease 为新、actor_status 为旧仍在用）。
- **Owner**：[actor/status_manager.go](../../../../apps/station/frame/touch/actor/status_manager.go) · [model/db/actor_status.go](../../../../apps/station/frame/touch/model/db/actor_status.go#L7)

### 6.4 Agent Turn（单轮对话执行）⚠️ 内嵌精简设计

- **状态**：`running` → `completed` / `failed` / `interrupted`（`interrupted` 已定义、暂无写入路径）
- **触发**：`createTurnRecord`→`running`；`completeTurn`→`completed`；`failTurn`→`failed`（11 步 turn loop 编排见 `ExecuteTurn`）
- **不变量**：DB 持久化；失败分类由 `FailoverReason` 驱动重试/压缩/凭据轮换/模型回退。
- **Owner**：[agent/domain/turn.go](../../../../apps/station/app/subserver/agent/domain/turn.go#L5) · [agent/service/turn_service.go](../../../../apps/station/app/subserver/agent/service/turn_service.go)

### 6.5 Agent Conversation（会话生命周期）⚠️ 内嵌精简设计

- **状态**：`active` → `compressed` → `archived`（`archived` 暂无写入路径）
- **触发**：上下文压缩时 `splitSession` 把旧会话置 `compressed` 并新建 `active` 子会话（parent 链接）
- **Owner**：[agent/domain/conversation.go](../../../../apps/station/app/subserver/agent/domain/conversation.go#L8) · [turn_service.go](../../../../apps/station/app/subserver/agent/service/turn_service.go#L507)

### 6.6 Subserver Lifecycle（框架层运行生命周期）⚠️ 内嵌精简设计

- **状态**：`stopped` → `starting` → `running` → `stopping` → `error`（`IsRunning()` 谓词；多数 subserver 实际仅在 stopped↔running 间切换）
- **触发**：各 subserver `Init`→`starting`；`Start`→`running`；`Stop`→`stopped`
- **不变量**：统一枚举，OSS / Relay / Relay-client / Bootstrap / TURN / Debug 一致实现。
- **Owner**：[frame/core/server/subserver.go](../../../../apps/station/frame/core/server/subserver.go#L59)
- **关联规范** → [station/subserver-standard.md](../../../station/subserver-standard.md)

### 6.7 Federation Key Rotation（签名密钥双签窗口）⚠️ 内嵌精简设计

- **状态**：`Slot` 闭合枚举 `current` / `prev`
- **触发**：`Rotate()`（事务内 current 降级为 prev、写入新 current）；`ClearPrev()`（双签宽限期默认 24h 结束后删除 prev）；后台 finalizer `RunOnce` 检查 `prev.GeneratedAt + Grace` 后清理
- **不变量**：双签宽限期内同时接受 current/prev 签名，避免轮换瞬断；转换有时间窗守卫。
- **Owner**：[federation/keystore.go](../../../../apps/station/frame/core/auth/federation/keystore.go#L18) · [oss/worker/key_rotation_final.go](../../../../apps/station/app/subserver/oss/worker/key_rotation_final.go#L88)
- **关联架构** → [architecture/shared/federation/README.md](../../shared/federation/README.md)

### 6.8 FriendMessage 投递（单调前向状态机）⚠️ 内嵌精简设计

- **状态**：`SENDING(1)` → `SENT(2)` → `DELIVERED(3)` → `READ(4)`（异常 `FAILED(5)`）
- **触发**：ack 流程对状态做**严格前向单调**更新（`status < ?` 守卫，防乱序 ack 回退）；`READ` 时重置未读计数
- **不变量**：单调不可回退；映射到 realtime receipt（`receiptKindFromFriendStatus`）。前端镜像见 `socialChat.ts` 的 `FriendMessageStatus`。
- **Owner**：[Conversation federation receiver](../../../../apps/station/app/subserver/conversation/infrastructure/federation/receiver.go#L1048) · [Conversation production federation](../../../../apps/station/app/subserver/conversation/production_federation.go#L757) · [FriendMessageStatus proto](../../../../model/domain/chat/friend_chat.proto)
- **关联架构** → [architecture/shared/communication/event-stream.md](../../shared/communication/event-stream.md)

> Station 另有 proto 枚举状态（OfflineMessage `pending/delivered/expired`、Notification `unread/read/archived`、GroupInvitation、Media、Delegation 等），多为服务端权威状态的 proto 定义、Go 侧转换较轻或仅作分类，按 §2 口径暂不收录为独立 FSM。

---

## 7. 跨端协同关系

部分状态机分布在不同层、需协同理解：

- **在线/Presence**：桌面端 §5.1 Presence Supervisor（FSM 解释器）↔ Station §6.2 Presence Lease（lease 真源）+ §6.3 Actor Status（旧模型）；前端仅消费 `presence.transition` 事件。
- **实时连接**：桌面端 §5.2 Event-Stream Supervisor ↔ Station §6.6 Relay/连接生命周期；二者经 SSE / relay 协同。
- **消息投递**：前端 §4.4 Chat Outbox（客户端重试）→ Station §6.8 FriendMessage 投递（服务端单调回执）。
- **E2EE**：前端 §4.5 Chat E2EE × §4.7 Peer Trust × §4.8 SKDM Ledger（群组）共同构成端到端加密态。
- **登录/准入**：前端 §4.1 Identity Lifecycle / §4.10 Login Panel → Station §6.1 Access Gate（准入链）→ §5.3 OAuth Loopback（OAuth 回调）。

---

## 8. 维护规则

- 新增/删除真·FSM 时，**同步更新本目录**（§3 计数 + 对应层小节）。
- 内嵌精简设计的 FSM，复杂度增长后应拆分到对应业务模块文档集（按 [architecture-document-standard.md](../../../global/architecture-document-standard.md)），并把本目录条目改为索引。
- 已有独立设计的 FSM，**以其设计文档为真源**，本目录只做索引，不平行定义。
