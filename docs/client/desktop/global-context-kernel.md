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
- 不定义页面挂载与启动管线。"页面如何挂载、运行时如何拥有投影、Boot 阶段怎么排"是一组独立契约，单点真源在 [`runtime-projections.md`](./runtime-projections.md)。

### 1.3 与 Page/Runtime/Boot 契约的边界

`apps/desktop/src/kernel/` 下存在两组同名空间但语义独立的内核子系统，**不要混用**：

| 子系统 | 文件入口 | 职责 | 真源文档 |
|---|---|---|---|
| GlobalContext Kernel | `kernel/global-context/` | 全局快照、Pipeline 编排、跨域 facade | 本文 |
| Page / Runtime / Boot Kernel | `kernel/runtime.ts` / `page.ts` / `boot.ts` / `PageHost.tsx` / `usePrefetch.ts` | 单页面渲染契约、长生命周期投影 Owner、启动阶段编排 | [`runtime-projections.md`](./runtime-projections.md) |
| Event Bus | `kernel/events/` | 类型安全事件总线 | `global/coding-guide/desktop/kernel-events.md` |

GlobalContext 关心“**跨域汇聚**”；Page/Runtime/Boot 关心“**单域投影 Owner 与挂载时机**”；EventBus 是它们共同使用的传输层。本文不重复定义后两者。

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
- `session_login`（含密码登录和 OAuth2 登录两种入口，统一产出 JWT，见 `../../architecture/boundaries/station-desktop-scope-boundary.md` §10）
- `session_logout`
- `session_restore`（应用启动时自动恢复持久化 session，先恢复本地持久化，再校验 Station session 是否仍有效）
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
2. BFF 从安全存储读取持久化 session，并恢复本地 `AppState.session`
3. 恢复阶段至少校验 JWT 基本有效性；一旦发生真实 Station 交互，再以 Station 的 `session_id` 校验结果作为最终真源
4. Station 若返回 `401 {"code":"session_revoked","reason":"expired|kicked|not_found"}`，BFF 必须将其提升为结构化 `Unauthorized + details`
5. 前端只消费结构化错误，发布 `AUTH_SESSION_REVOKED(reason)`，由 Lifecycle Orchestrator 执行 `session_logout`
6. `session_logout` 负责清理持久化、清理全局态、退回 onboarding/login；页面层不得自行拼接“被踢下线/过期”逻辑

### Session Revoked 自动处理
1. 任何 Station API 调用返回 `401 + code=session_revoked`
2. Rust `station_client` 将其映射为结构化错误：
   - `code = UNAUTHORIZED`
   - `details.code = session_revoked`
   - `details.reason = expired | kicked | not_found | unknown`
3. TS `invokeRustCommand` 检测上述结构化错误并发布 `AUTH_SESSION_REVOKED`
4. Lifecycle Orchestrator 统一执行 `session_logout`
5. 页面只订阅全局状态变化，不允许通过字符串前缀、toast 文案或页面局部 reload 兜底

### 认证错误边界约束
- `session_revoked` 是全局认证状态机事件，不是普通业务错误。
- Desktop Web 不得解析 `SESSION_REVOKED:...` 一类字符串协议；只允许消费 `RustCommandError.code/details`。
- Desktop Rust 不得把 `session_revoked` 再包装回 `String` 供上层猜测。
- 任何需要退出登录的路径都必须收敛到 `AUTH_SESSION_REVOKED -> session_logout` 这一条链路。

详细架构设计见 `../../architecture/boundaries/station-desktop-scope-boundary.md` §10。

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

## 10. 执行计划入口

本文只定义 GlobalContext Kernel 的架构目标、组件职责、事件模型、API 约束与验收标准。

如需查看迁移阶段、门禁、影响矩阵、代码迁移风格与当前落地状态，请看：

- `execution-plans/global-context-kernel-migration.md`

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

- 风险：状态切片边界定义不清  
  缓解：先固定核心 8 个切片，新增切片必须通过架构评审。

- 风险：Kernel 变成“第二业务层”  
  缓解：Kernel 仅承载横切治理能力，不承载具体业务规则，业务规则仍在领域模块或 Station。

---

## 13. 与现有文档关系

- 本文是 Desktop 全局上下文内核设计，补齐 `docs/architecture` 下对“框架级状态与事件组件”的空白。
- 与 `../../architecture/boundaries/station-desktop-scope-boundary.md` 协同：职责边界不变，本文聚焦 Desktop 内部框架治理。
