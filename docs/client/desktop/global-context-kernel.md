# Desktop GlobalContext Kernel 架构设计（Rust + TS）

## 1. 文档目标

### 1.1 目标
- 在 `apps/desktop` 建立框架级全局上下文内核，统一管理跨页面、跨模块、跨进程的状态与事件。
- 为 Chat / Friend Chat / Group Chat / File Transfer / Timeline / Skills / Cron / Channels 等能力提供一致的生命周期编排能力。
- 明确 Rust 与 TS 的职责边界，形成可扩展的全局组件集，而不是在业务模块中重复实现“半套全局状态机”。

### 1.2 非目标
- 不在本阶段重写全部业务模块。
- 不在本阶段替换现有所有 store；允许渐进接入。
- 不修改 Station 业务语义，只定义 Desktop 内核与 Station 交互契约。

---

## 2. 背景问题

当前 Desktop 已具备大量能力与命令契约，但缺少统一 GlobalContext 内核，导致：
- 会话、网络、账号、能力开关、任务状态分散在页面/store/命令层。
- 生命周期逻辑（启动、切换用户、登出、网络抖动恢复）重复且不一致。
- 事件传播依赖局部调用链，缺少统一事件总线与标准元数据。
- 跨能力联动（如账号切换后消息同步、任务取消、缓存清理）缺少框架级编排点。

现有关键入口（作为接入基线）：
- Rust 命令注册入口：`apps/desktop/src-tauri/src/main.rs`
- Rust 契约定义：`apps/desktop/src-tauri/src/interface/contracts/mod.rs`
- TS 服务网关：`apps/desktop/src/services/desktop_api.ts`

---

## 3. 设计原则

### 3.1 单一事实源（Per Domain）
- 每个全局域只能有一个“权威写入源”。
- TS 可有本地镜像，但必须通过内核统一更新，不允许业务模块绕写。

### 3.2 事件优先（Event-First）
- 跨模块联动通过事件驱动，不允许模块间直接相互依赖内部状态。
- 所有全局事件必须可追踪、可重放、可过滤。

### 3.3 生命周期可编排
- 启动、登录、登出、切换工作区、网络恢复、能力启停都由统一 Orchestrator 执行。
- 编排步骤必须幂等、可中断、可重试。

### 3.4 渐进替换
- 允许业务模块逐步接入 GlobalContext Kernel。
- 提供兼容层，降低迁移成本。

---

## 4. 内核总体架构

```text
┌───────────────────────────────────────────────────────┐
│                 Desktop GlobalContext Kernel          │
├───────────────────────────────────────────────────────┤
│ 1) GlobalStateHub   2) EventBus   3) Lifecycle Orchestrator │
│ 4) Capability Registry 5) Policy Engine 6) Snapshot Store   │
└───────────────────────────────────────────────────────┘
             ▲                             ▲
             │                             │
     Rust Command Bridge             TS App Runtime
 (contracts + tauri_commands)     (stores/pages/services)
             │                             │
             └──────────── Station APIs ───┘
```

---

## 5. 核心组件定义

## 5.1 GlobalStateHub（全局状态中心）

职责：
- 维护全局状态切片（state slices）。
- 提供只读快照与增量订阅。
- 管控写入路径与冲突策略。

建议切片：
- `identity`: 当前 actor/account、租户、权限摘要
- `session`: 登录态、JWT token、session_id、expires_at、登录方式（password/oauth2）、token 生命周期
- `network`: relay/p2p 状态、延迟、连接质量
- `workspace`: 当前工作区、环境、上下文选择
- `capability`: chat/group/file/timeline/tools 等可用性矩阵
- `runtime`: 应用生命周期状态（booting/ready/degraded/shutdown）
- `task`: 全局任务编排状态（同步、上传、恢复、迁移）
- `notification`: 系统通知与业务通知归一视图

## 5.2 EventBus（全局事件总线）

职责：
- 统一发布/订阅全局事件。
- 保障事件元数据规范与顺序策略。
- 提供调试与审计能力。

事件包结构（建议）：
- `event_id`: 全局唯一
- `event_type`: 事件类型（枚举）
- `domain`: auth/chat/group/file/system/network/...
- `source`: rust|ts|station|user_action
- `trace_id`: 跨层追踪标识
- `timestamp_ms`: 事件时间
- `payload`: 业务载荷
- `version`: 事件 schema 版本

## 5.3 Lifecycle Orchestrator（生命周期编排器）

职责：
- 执行标准生命周期流程，并将结果输出为标准事件。

内置流程（第一批）：
- `app_bootstrap`
- `identity_switch`
- `session_login`（含密码登录和 OAuth2 登录两种入口，统一产出 JWT，见 `station-desktop-scope-boundary.md` §10）
- `session_logout`
- `session_restore`（应用启动时自动恢复持久化 session，验证 JWT 有效性）
- `session_refresh`（JWT 临近过期时自动续签）
- `network_degraded_recovery`
- `capability_refresh`
- `graceful_shutdown`

每个流程统一支持：
- pre-check
- step pipeline
- rollback
- retry policy
- finalization event

## 5.4 Capability Registry（能力注册中心）

职责：
- 注册能力单元及依赖约束。
- 提供“能力可用性判定”作为页面与任务调度依据。

能力模型（建议）：
- `capability_id`
- `version`
- `depends_on`（如 network/session）
- `health`
- `degraded_reason`
- `exposed_actions`

## 5.5 Policy Engine（策略引擎）

职责：
- 全局策略判定：优先级、重试、限流、降级规则。
- 统一决定“走 p2p / relay / fallback”。

策略输入：
- 网络状态
- 账号策略
- 运行模式（开发/生产）
- 能力健康状态

## 5.6 Snapshot Store（快照仓）

职责：
- 管理全局快照持久化与恢复。
- 区分持久态与易失态，避免错误恢复脏状态。

---

## 6. Rust / TS 分层职责

## 6.1 Rust 层（Kernel Core）

建议承担：
- 事件总线核心（事件类型、校验、序列化、过滤）
- 生命周期编排核心与步骤执行器
- 全局状态权威写入接口
- 关键策略决策（尤其网络与安全相关）

输出给 TS：
- `context_snapshot_get`
- `context_events_subscribe`
- `context_action_dispatch`
- `context_capability_list`

## 6.2 TS 层（Kernel Runtime Adapter）

建议承担：
- UI 消费层与状态镜像层
- 页面级组合器（selectors）
- 业务动作封装（command dispatch）
- 本地展示态优化（不改变真源）

## 6.3 写入治理（Write Governance）

为避免“多点写入”导致状态漂移，定义三类写入权限：
- `rust_authoritative`：仅 Rust Kernel 可写，TS 只读镜像
- `orchestrator_owned`：仅 Orchestrator 流程可写，业务模块不可直接写
- `ts_ephemeral`：TS 可写易失态，仅用于展示增强，重启可丢失

建议初始映射：
- `identity/session/network/runtime/capability` -> `rust_authoritative`
- `task` -> `orchestrator_owned`
- `notification` -> `orchestrator_owned + ts_ephemeral(仅UI折叠态/已读位置等展示字段)`
- `workspace` -> `rust_authoritative`（如含跨流程依赖）；纯 UI 视图偏好可落本地 `ts_ephemeral`

---

## 7. 全局事件分层

### 7.0 事件中心化约束（禁止硬编码）
- 禁止在业务模块直接写事件字符串，例如 `window.dispatchEvent(new CustomEvent('xxx'))`。
- 所有事件名必须在“单一事件目录”集中定义，并由常量导出。
- 页面、store、service 只能通过常量绑定（import）发布/订阅事件。
- CI 规则应拦截非白名单文件中的裸字符串事件名。

建议目录：
- `apps/desktop/src/kernel/events/catalog.ts`：事件名常量（唯一真源）
- `apps/desktop/src/kernel/events/types.ts`：事件 payload 类型
- `apps/desktop/src/kernel/events/bus.ts`：publish/subscribe 统一入口
- `apps/desktop/src/kernel/events/index.ts`：统一导出

常量示例：

```ts
export const EVENT = {
  AUTH_IDENTITY_CHANGED: 'auth.identity_changed',
  NAVIGATION_REQUESTED: 'navigation.requested',
  NETWORK_STATE_CHANGED: 'network.state_changed',
  ORCHESTRATOR_PIPELINE_FINISHED: 'orchestrator.pipeline_finished',
} as const;
```

业务层使用示例：

```ts
import { EVENT, eventBus } from '@/kernel/events';

eventBus.publish(EVENT.NAVIGATION_REQUESTED, { to: '/settings/account' });
const off = eventBus.subscribe(EVENT.AUTH_IDENTITY_CHANGED, () => {
  useChatStore.getState().refreshSessions();
});
```

### 7.1 领域事件（Domain Events）
- `auth.logged_in`
- `auth.logged_out`
- `chat.message_sent`
- `chat.message_failed`
- `group.member_changed`
- `file.transfer_progress`
- `file.transfer_completed`

### 7.2 系统事件（System Events）
- `runtime.bootstrapped`
- `runtime.degraded`
- `network.p2p_connected`
- `network.relay_fallback`
- `capability.updated`

### 7.3 控制事件（Control Events）
- `orchestrator.pipeline_started`
- `orchestrator.step_failed`
- `orchestrator.rollback_done`
- `orchestrator.pipeline_finished`

### 7.4 事件版本与兼容策略（Schema Evolution）
- 事件 schema 采用 `major.minor` 版本。
- `minor` 仅允许向后兼容变更（新增可选字段、新增事件类型）。
- `major` 用于不兼容变更，必须提供兼容窗口与迁移公告。
- 任一事件在删除前必须经历：`active -> deprecated -> removed` 三阶段。
- Kernel 必须支持“双版本解码”至少一个发布周期，保证 Rust/TS 灰度期间可互通。

兼容窗口建议：
- `deprecated` 最短保留 2 个 desktop 发布周期。
- 发布说明必须列出：受影响事件、替代字段、迁移截止版本。

---

## 8. 关键流程示例（不仅限登录）

## 8.0 统一登录（Session Login）

密码登录与 OAuth2 登录共用同一编排管线，区别仅在于入口步骤。

### 密码登录
1. 前端调 `api.authLogin({ account, password })`
2. BFF 调 Station `POST /login`（email + password + device_type）
3. Station 返回 `{ tokens: { access_token(JWT), ... }, session_id, actor }`
4. BFF 写入 `AppState.session`（actor_id + jwt + session_id + expires_at）
5. BFF 持久化 session 到安全存储（macOS Keychain）
6. 前端 `set({ authenticated: true })` + 发布 `auth.logged_in`

### OAuth2 登录
1. 前端调 `startAuth("github")` → Loopback → 外部授权 → 回调获取身份信息
2. 前端调 `api.authLoginOAuth2({ provider, provider_user_id, email, username, avatar_url })`
3. BFF 调 Station `POST /auth/oauth2/login`（身份信息）
4. Station 执行 Identity Resolve（查 binding → 未绑定则自动注册 Actor → 建立绑定）
5. Station 复用 `LoginWithSession` 签发 JWT，返回格式与密码登录完全相同
6. 后续步骤 4-6 与密码登录完全一致

### Session 恢复（App Bootstrap）
1. 应用启动时调 `api.authRestoreSession()`
2. BFF 从安全存储读取持久化 session
3. BFF 调 Station 验证 JWT 有效性（或本地校验 JWT exp 字段）
4. 有效 → 写入 `AppState.session` → 前端 `set({ authenticated: true })`
5. 无效 → 清除持久化 → 前端保持未登录态，引导用户重新登录

### 401 自动处理
1. 任何 API 调用返回 401
2. BFF 或前端拦截器清除 `AppState.session` + 持久化
3. 发布 `auth.logged_out` 事件
4. 前端响应事件，跳转到登录页

详细架构设计见 `station-desktop-scope-boundary.md` §10。

## 8.1 身份切换（Identity Switch）
1. 发起 `context_action_dispatch(identity.switch)`
2. Orchestrator 锁定写入窗口
3. 清理旧身份相关易失态（task/notification/network sessions）
4. 拉取新身份能力矩阵并刷新 capability
5. 发布 `auth.identity_switched` 与 `capability.updated`

## 8.2 网络降级恢复（P2P -> Relay -> P2P）
1. `network.p2p_unstable` 触发策略引擎
2. 切换数据通道到 relay
3. 标记相关 capability 为 degraded
4. 后台探测恢复条件
5. 条件满足后切回 p2p 并发布恢复事件

## 8.3 文件传输全局编排
1. 任务注册到 `task` slice
2. 根据策略选择传输路径（p2p/relay/oss fallback）
3. 统一上报进度事件到 EventBus
4. 成功后写入 `notification` 与 `timeline` 关联事件

---

## 9. API 草案（Desktop 内核）

Rust Command（建议新增）：
- `context_snapshot_get(input) -> AppResult<StubPayload>`
- `context_subscribe(input) -> AppResult<StubPayload>`
- `context_dispatch(input) -> AppResult<StubPayload>`
- `context_capabilities(input) -> AppResult<StubPayload>`
- `context_health(input) -> AppResult<StubPayload>`

TS 侧统一入口（建议）：
- `globalContext.getSnapshot()`
- `globalContext.subscribe(...)`
- `globalContext.dispatch(action)`
- `globalContext.select(selector)`

## 9.1 EventBus API 约束（TS）

建议签名：
- `publish<TType extends EventType>(type: TType, payload: EventPayload[TType], meta?)`
- `subscribe<TType extends EventType>(type: TType, handler: (event: TypedEvent<TType>) => void)`
- `subscribeMany(types: EventType[], handler)`
- `once(type, handler)`

约束：
- `type` 必须来自 `EVENT` 常量，不允许任意字符串。
- `payload` 必须与 `type` 对应的类型映射一致。
- 对外只暴露 `eventBus`，不直接暴露底层 `window` 事件 API。

---

## 10. 迁移计划（分阶段）

### Phase 0：骨架落地
- 建立事件模型、状态切片定义、最小 dispatch 通道。

### Phase 1：三域先行
- 接入 `session`、`network`、`runtime` 三个全局域。
- 接入登录、登出、网络降级恢复编排。

### Phase 2：能力并轨
- chat/group/file/timeline/tools 能力接入 Capability Registry。
- 页面改为依赖 capability 判定，不直接硬编码能力可用性。

### Phase 3：任务与通知收敛
- 统一任务编排与通知中心，去除重复本地状态机。

### Phase 4：治理与观测
- 提供全局事件追踪面板与诊断导出能力。

## 10.1 阶段门禁（Phase Gates）

每阶段必须满足门禁再进入下一阶段：
- Gate A（Phase 0 -> 1）：事件总线与 snapshot 最小链路可用，且不影响既有业务路径。
- Gate B（Phase 1 -> 2）：`session/network/runtime` 三域已由 Kernel 托管，页面侧禁止绕写。
- Gate C（Phase 2 -> 3）：能力可用性判定已统一走 Capability Registry，旧硬编码判断完成下线清单。
- Gate D（Phase 3 -> 4）：任务与通知编排统一后，关键流程失败率达到目标阈值。

## 10.1.1 事件常量化迁移清单（第一批）

- 将 `App.tsx` 内全局监听事件迁移到 `EVENT.*` 常量。
- 将 `UserProfilePopover.tsx` 中账号/OAuth 监听迁移到 `EVENT.AUTH_IDENTITY_CHANGED`。
- 将 `MessageBubble.tsx`、`GlobalLayout.tsx`、`ChannelsPage.tsx` 的导航事件迁移到 `EVENT.NAVIGATION_REQUESTED`。
- 为 `oauth2.ts` 与 `accountIdentity.ts` 增加统一发布入口，禁止重复派发同语义事件。
- 保留兼容桥一个发布周期：旧事件名 -> 新常量事件名转发，再删除旧事件名。

## 10.2 业务层影响矩阵（落地后会改什么）

### A. 全局壳层与导航层
- 影响模块：`src/App.tsx`、`src/components/GlobalLayout.tsx`、`src/utils/deeplink.ts`
- 影响内容：
  - 现有 `window.dispatchEvent`/`addEventListener` 改为 `globalContext.publish/subscribe`
  - `agentbox:navigate`、`navigate-settings-tab` 统一为 `navigation.requested`
- 业务收益：路由跳转与全局动作可审计、可回放，不再靠字符串事件散落

### B. 账号与 OAuth 域
- 影响模块：`src/store/accountIdentity.ts`、`src/store/oauth2.ts`、`src/components/UserProfilePopover.tsx`
- 影响内容：
  - `account-identity-changed` 与 `oauth2-connections-changed` 合并为 `auth.identity_changed`
  - 轮询刷新改为 Orchestrator 的 `session_login/session_logout/identity_switch` 流程触发
- 业务收益：账号状态变更链路从“多点触发”变成“单入口编排”

### C. 聊天域（AI Chat / Friend / Group）
- 影响模块：`src/store/chat.ts`、`src/services/desktop_api.ts`（chat/friend/group API）
- 影响内容：
  - 发送成功/失败、已读、同步等统一发布 `chat.*` / `group.*` 域事件
  - UI 不再直接跨 store 调用“刷新某模块”，而是订阅域事件
- 业务收益：跨会话、跨页面联动变成标准机制，减少隐式耦合

### D. 文件传输与任务域
- 影响模块：上传/传输相关页面与 store（含 Channels/Memory 里的上传路径）
- 影响内容：
  - 进度、失败重试、完成通知接入 `task` + `notification` 切片
  - 统一事件：`file.transfer_progress`、`file.transfer_completed`
- 业务收益：任务状态可观测，错误可定位，跨页面进度显示一致

### E. 能力开关与可用性判定
- 影响模块：Settings、Channels、Skills、Tools 等依赖“能力可用性”的页面
- 影响内容：
  - 页面不再硬编码判断“某能力是否可用”，统一查询 `Capability Registry`
  - 网络降级时自动进入 degraded UI 分支
- 业务收益：降级策略一致，避免每页各写一套可用性判断

### F. 时间线与通知域
- 影响模块：Timeline、Notification 相关页面/组件
- 影响内容：
  - 业务通知与系统通知统一入总线，再映射到 `notification` 切片
  - 时间线增量更新从“局部拉取”升级为“事件驱动 + 必要回补”
- 业务收益：通知语义统一，减少重复刷新与漏更新

## 10.3 业务层使用形态（目标代码风格）

页面侧（只订阅，不做跨域写入）：

```ts
const unsub = globalContext.subscribe('auth.identity_changed', async () => {
  await useChatStore.getState().refreshSessions();
});
```

业务动作侧（只发动作，不直接串调用链）：

```ts
await globalContext.dispatch({
  type: 'identity.switch',
  payload: { actorId: nextActorId }
});
```

编排结果侧（统一事件）：

```ts
globalContext.subscribe('orchestrator.pipeline_finished', (event) => {
  if (event.payload.pipeline === 'identity_switch') {
    message.success('身份切换完成');
  }
});
```

## 10.4 对业务团队的直接影响

- 代码习惯变化：从“模块直接调用模块”转为“动作 -> 编排 -> 事件 -> store”
- 改造成本分布：
  - 低成本：导航、账号通知、设置页跳转
  - 中成本：chat/group/file 的状态同步链路
  - 高成本：历史轮询链路与跨 store 隐式依赖清理
- 协作变化：新功能评审必须提交三项信息
  - 产生哪些 domain event
  - 写入哪个 state slice
  - 由哪个 orchestrator pipeline 托管

---

## 11. 验收标准

- 任一跨模块流程必须通过 Orchestrator 触发，禁止页面链式硬调用。
- 任一全局状态写入必须可追踪到事件与 trace_id。
- 任一能力可用性由 Capability Registry 给出，不再分散判断。
- 登录、登出、身份切换、网络降级恢复四类流程全部可重放与幂等。
- Rust 与 TS 对同一事件 schema 的版本一致且可兼容演进。

## 11.1 平台级指标（SLO/KPI）

建议把“验收”从功能成功升级为平台指标达标：
- 事件投递成功率：`>= 99.9%`
- 事件重复率：`<= 0.1%`
- 事件端到端延迟（P95）：`<= 300ms`（Desktop 内）
- `identity_switch` 流程成功率：`>= 99.5%`
- `network_degraded_recovery` 平均恢复时延：按网络级别分档并持续下降
- Orchestrator 回滚成功率：`>= 99%`

指标用途：
- 作为 Gate 的硬准入条件之一
- 作为回归检测与版本发布阻断条件

---

## 12. 风险与缓解

- 风险：一次性替换过大导致业务抖动  
  缓解：按域迁移、双写观察、灰度切换。

- 风险：事件风暴导致性能问题  
  缓解：事件分级、节流、批量提交、订阅过滤。

---

## 13. 当前实现进度（2026-03）

### 13.1 已实现
- 事件中心化（`EVENT` 常量 + `eventBus`）与业务层硬编码事件拦截规则已落地。
- GlobalContext `snapshot + pipeline` 第一版已落地，包含 `identity/session/oauth/runtime/network/capability/workspace/task/notification/meta`。
- Rust 权威链路已接通：`context_snapshot_get`、`context_action_dispatch`。
- Rust 查询接口已补齐：`context_capabilities`、`context_health`。
- Rust Snapshot Store 已支持持久化恢复（`global_context.json`）。
- `registerTime` 字段链路已接通：`AccountIdentity.created_at -> GlobalContext.identity.registerTime`。

### 13.2 待实现
- Rust 侧 `context_events_subscribe`（实时订阅通道）尚未落地，当前以 snapshot + dispatch 为主。
- `task/notification` 仍以框架通用能力为主，尚未完整接入 friend/group/file 业务编排。
- 指标门禁（事件投递率、pipeline 成功率）尚未形成 CI 阻断规则。

### 13.3 registerTime 契约约束
- 真源：Station 用户域（首次建号时间）。
- 推荐字段：统一使用 `created_at`（RFC3339）。
- 兼容输入：`created_at` / `createdAt` / `register_time`（仅过渡期允许）。
- Desktop 口径：`globalContext.identity.registerTime = created_at`，禁止客户端本地推断覆盖。

- 风险：状态切片边界定义不清  
  缓解：先固定核心 8 个切片，新增切片必须通过架构评审。

- 风险：Kernel 变成“第二业务层”  
  缓解：Kernel 仅承载横切治理能力，不承载具体业务规则，业务规则仍在领域模块或 Station。

- 风险：过早全量接入导致迁移阻塞  
  缓解：严格执行三域先行（`session/network/runtime`），其余域按 Gate 推进。

---

## 13. 与现有文档关系

- 本文是 Desktop 全局上下文内核设计，补齐 `docs/architecture` 下对“框架级状态与事件组件”的空白。
- 与 `station-desktop-scope-boundary.md` 协同：职责边界不变，本文聚焦 Desktop 内部框架治理。
