# Agent 设计决策

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-02 | **Updated**: 2026-10-03
> **Owner**: Peers-Touch Agent Team

---

## 决策索引

| ID | 决策 | 状态 |
|---|---|---|
| MCA-D14 | Home 工作状态由 Station 投影 | accepted |
| MCA-D15 | 使用统一能力清单与 Agent 绑定 | accepted |
| MCA-D16 | Station 管理能力操作，客户端执行本机 MCP | superseded by MCA-D16A |
| MCA-D16A | MCP 配置归 Station，执行服从显式运行位置 | accepted |
| MCA-D17 | Connector 资源与 Agent 工具清单分离 | accepted |
| MCA-D18 | Evaluation 使用 Station 聚合 | accepted |
| MCA-D20 | 使用发布者签名 catalog 与权威读回 | accepted |
| MCA-D22 | 使用 Station-owned 能力场景控制面 | accepted |
| MCA-D23 | 单一场景控制面覆盖 ToolCall、MCP 与 Connector | accepted |
| PAOS-D01 | 使用一等 Station AgentGoal 聚合 | accepted |
| PAOS-D02 | TaskRun 是唯一可执行工作生命周期 | accepted |
| PAOS-D03 | Goal、Canvas 与 Atelier 共用一个 Coordinator | accepted |
| PAOS-D04 | Runtime Adapter 执行工作但不拥有工作 | accepted |
| PAOS-D05 | Goal 完成必须通过独立证据验收 | accepted |
| PAOS-D06 | 迁移后删除重复任务与完成真源 | accepted |
| PAOS-D07 | durable Agent event 只通过共享 EventBus fan-out | accepted |

## MCA-D14: Home 工作状态由 Station 投影

**Status**: accepted
**Date**: 2026-08-17

### Context

Agent readiness、会话和任务若由页面分别推导会产生互相矛盾的状态。

### Decision

Home 使用 Station-owned work projection，客户端只消费并呈现该投影。

### Rationale

单一业务真源允许多客户端与重启恢复得到一致结果。

### Alternatives Considered

由各页面独立拼装状态；该方案因无法保证 freshness 与一致性而拒绝。

### Consequences

Station 必须提供稳定身份和可重放投影，客户端不得持有替代权威状态。

## MCA-D15: 使用统一能力清单与 Agent 绑定

**Status**: accepted
**Date**: 2026-08-17

### Context

Builtin tool、Skill、MCP、Connector 与本机能力曾使用不同标识和 readiness 路径。

### Decision

所有能力通过版本化 manifest、Agent binding 和 readiness snapshot 接入。

### Rationale

统一合同使能力选择、降级、撤权和审计可以使用同一身份模型。

### Alternatives Considered

保留每类能力的私有绑定模型；该方案会持续制造分叉和重复治理。

### Consequences

能力不可绕过 binding/readiness 直接进入 Turn。

## MCA-D16: Station 管理能力操作，客户端执行本机 MCP

**Status**: superseded by MCA-D16A
**Date**: 2026-08-17

### Context

Desktop 拥有本机 MCP 进程与 secret，但客户端私有状态无法提供权威重放和恢复。

### Decision

Station 创建和推进 ToolCall；Desktop 在能力会话内执行 MCP 并回传 fenced receipt。

### Rationale

该边界同时保留本机资源所有权与 Station 业务权威。

### Alternatives Considered

全部由 Desktop 编排或把本机 secret 移交 Station；两者分别破坏恢复和安全边界。

### Consequences

执行回执必须具备 actor、device、attempt 和 ToolCall lineage。

## MCA-D16A: MCP 配置归 Station，执行服从显式运行位置

**Status**: accepted
**Date**: 2026-10-03

### Context

MCP 是 Agent 能力，不等同于 Desktop 设备能力。现有实现把统一
`mcp.invoke` manifest 固定为客户端执行，导致 Station 上运行的 Agent 调用
Station-local stdio MCP 时必须绕行 Desktop，也无法在 Desktop 离线时继续。

### Decision

Station 持有 actor-scoped MCP Server 配置目录、不可变 revision、tool
manifest、Agent binding、readiness、ToolCall、幂等 mutation command 和
audit 真源。每个 Server 显式声明 `STATION` 或 `CLIENT_CAPABILITY`
execution owner；`stdio`、`http`、`sse` 只描述 transport，不决定 owner。

- `STATION` Server 在 Station 运行时启动本地 stdio 进程或访问 Station
  可达的 HTTP/SSE endpoint，复用 Station ToolCall claim、receipt 和
  continuation。
- `CLIENT_CAPABILITY` Server 在 Desktop Rust 运行时启动本地 stdio
  进程或访问 Desktop 可达的 HTTP/SSE endpoint，复用现有 capability
  session、fencing 和 receipt。
- secret material 和进程状态留在执行位置；Station 配置只持有 secret
  reference 和脱敏投影。
- 每个已发现 MCP tool 发布独立、版本化 manifest，并在 Turn admission
  前固定 execution owner；模型参数和客户端不得改写 owner。

### Rationale

这使 Agent 在 Station 就近执行可共享的 MCP，同时保留 Desktop 设备资源的
本地安全边界，并让两种执行路径共享同一治理、审计和恢复协议。

### Alternatives Considered

- 所有 MCP 固定在 Desktop：拒绝，因为 Station Agent 会产生
  Station → Desktop → Station 的反向依赖，且 Desktop 离线即失效。
- 所有 MCP 固定在 Station：拒绝，因为设备文件、桌面凭证和用户本机进程不应
  搬到远端 Station。
- 根据 transport 或 ToolCall 参数临时选择 owner：拒绝，因为会绕过 manifest
  binding/readiness，并使同一调用的审计身份不稳定。

### Consequences

- Desktop MCP store 不再是目录/config 真源，只保留
  `CLIENT_CAPABILITY` secret material 与运行时进程状态。
- Station 增加 MCP Server 配置、tool discovery 和 Station executor。
- 旧 `local_mcp` 通用 manifest/guidance 必须删除，不能与逐 Server/Tool
  manifest 并存。
- Station-local stdio 的命令与文件路径相对 Station 运行环境解释；Desktop
  路径绝不透传。

## MCA-D17: Connector 资源与 Agent 工具清单分离

**Status**: accepted
**Date**: 2026-08-17

### Context

OAuth 连接、资源发现、工具同步、Agent 绑定与调用是不同生命周期。

### Decision

Connector owner 管理授权资源，Agent 只消费由其同步出的工具 manifest。

### Rationale

分离后可独立撤权、刷新和审计，而无需向 Agent 暴露 OAuth secret。

### Alternatives Considered

把 Connector 配置直接作为 Agent 工具；该方案混淆权限与执行状态。

### Consequences

Connector 失效必须使相关能力 readiness 失效并阻止新调用。

## MCA-D18: Evaluation 使用 Station 聚合

**Status**: accepted
**Date**: 2026-08-17

### Context

客户端直接运行 Evaluation 会绕过权威 Turn、数据集和结果生命周期。

### Decision

Evaluation run/result 由 Station 聚合，并复用 canonical Turn kernel。

### Rationale

统一 Turn 路径可以保留输入、模型、能力和结果的可追踪身份。

### Alternatives Considered

保留 Desktop `quickCompletion` 作为 Evaluation owner；该方案无法提供共享真源。

### Consequences

客户端只负责创建请求、观察进度和展示结果。

## MCA-D20: 使用发布者签名 catalog 与权威读回

**Status**: accepted
**Date**: 2026-09-17

### Context

Agent、Skill 与 MCP 发现需要可信来源，任意 URL JSON 无法证明发布者和安装状态。

### Decision

使用发布者签名的 catalog snapshot，并从目标 authority 读回安装与撤权状态。

### Rationale

签名验证建立来源信任，权威读回证明实际状态而不是页面乐观结果。

### Alternatives Considered

托管商业 Marketplace 或继续接受任意 JSON；均超出当前信任和产品边界。

### Consequences

Catalog transport 不得替代签名信任，安装证明必须来自目标 authority。

## MCA-D22: 使用 Station-owned 能力场景控制面

**Status**: accepted
**Date**: 2026-09-18

### Context

部分能力失败与竞态无法通过公开产品输入确定性触发。

### Decision

建立受限、run-scoped、非生产可用的 Station-owned Acceptance 场景控制面。

### Rationale

单一控制面能在不创建第二业务真源的前提下产生可复验失败证据。

### Alternatives Considered

在客户端加入 mock 分支或依赖随机故障；两者都不能形成可信正式证据。

### Consequences

场景必须绑定 run/actor、显式清理，并在生产配置中 fail closed。

## MCA-D23: 单一场景控制面覆盖 ToolCall、MCP 与 Connector

**Status**: accepted
**Date**: 2026-09-19

### Context

ToolCall、MCP 和 Connector 的错误、取消与竞态需要一致的执行身份和证据语义。

### Decision

扩展 MCA-D22 的同一控制面覆盖这些能力操作，不新增平行场景 authority。

### Rationale

共享 run、barrier、receipt 和 cleanup 合同可避免不同 Gate 形成相互冲突的真源。

### Alternatives Considered

为每类能力建立独立测试控制器；该方案会重复生命周期并削弱证据可比性。

### Consequences

所有场景必须证明零执行或一次执行边界，并保留完整 ToolCall lineage。

## PAOS-D01: 使用一等 Station AgentGoal 聚合

**Status**: accepted
**Date**: 2026-10-03

### Context

当前 Goal 文本主要写入 `CollaborationTask.title/description/meta_json`，
无法独立表达长期目标、非目标、预算、图版本、决策和验收生命周期。

### Decision

新增 Station-owned `AgentGoal` 聚合，作为 Goal 合同、图版本、预算、决策和
终态验收的唯一真源。

### Rationale

Goal 必须跨越多次 TaskRun、重规划、重启和客户端会话。

### Alternatives Considered

继续把 Goal 塞入任务 metadata；拒绝，因为它无法形成稳定合同或独立恢复边界。

### Consequences

需要新增 proto、持久化和迁移；Home、Canvas、Atelier 只能消费 Goal 投影。

## PAOS-D02: TaskRun 是唯一可执行工作生命周期

**Status**: accepted
**Date**: 2026-10-03

### Context

`AgentTask`、`CollaborationTask` 和 `TaskRun` 同时表达任务状态，恢复和完成语义
因此可能分叉。

### Decision

所有真正执行的工作统一落到 `TaskRun + ExecutionStep + TaskRunStatus`。旧两类
任务及其 status contract 只作为迁移输入，在消费者完成切换后删除其
mutation authority。

### Rationale

现有 TaskRun 已覆盖 Chat、DirectRun、checkpoint、lease、artifact 和 gate，
是收敛成本最低的执行真源。

### Alternatives Considered

保留三类实体并增加映射层；拒绝，因为映射不能消除冲突写入和终态歧义。

### Consequences

需要一次有界 schema/data migration 和 consumer hard cut。

## PAOS-D03: Goal、Canvas 与 Atelier 共用一个 Coordinator

**Status**: accepted
**Date**: 2026-10-03

### Context

Agent Canvas 已定义 GoalKeeper 和调度，Atelier 已投影任务工程；两者若各自拥有
状态机会产生重复编排。

### Decision

Station Goal Coordinator 统一拥有 planning、frontier、budget、decision、
replan、resume 和进入 acceptance 的转换。Station `GoalAcceptanceService`
独立拥有 acceptance round 与 terminal verdict。Canvas 只提交组合意图，
Atelier/Home 只提交命令并渲染投影。

### Rationale

一个协调器才能保证跨入口、跨设备和重启后的相同行为。

### Alternatives Considered

为 Atelier 或 Canvas 建独立运行时；拒绝，因为违反 Station 单一真源。

### Consequences

Coordinator 成为关键服务，必须具备 lease、replay、overload 和恢复 Gate。

## PAOS-D04: Runtime Adapter 执行工作但不拥有工作

**Status**: accepted
**Date**: 2026-10-03

### Context

Direct Model 与外部 CLI/ACP runtime 的会话、能力和事件不同，但业务任务语义
不能随 adapter 改变。

### Decision

Adapter 统一声明 descriptor、admission、execute、cancel、resume、usage、
artifact 和 typed failure；只回传执行事实，不能直接推进 Goal 状态。

### Rationale

这保留异构运行时能力，同时隔离上游协议差异。

### Alternatives Considered

按 runtime 建独立任务模型；拒绝，因为会把适配器差异扩散到产品层。

### Consequences

首版只要求 Direct Model 和一个 stateful external runtime 通过正式 Gate。

## PAOS-D05: Goal 完成必须通过独立证据验收

**Status**: accepted
**Date**: 2026-10-03

### Context

当前 GoalKeeper 主要根据节点完成和 final summary 形成 verdict，不能证明用户
验收条件已经满足。

### Decision

Station `GoalAcceptanceService` 读取版本化 criteria、immutable evidence 和
独立 verdict，并且是唯一可提交 Goal terminal transition 的生产 owner。
L0/L1 使用确定性 evaluator；L2 使用独立 reviewer 或 human。Acceptance
Framework 只驱动生产入口、读取权威结果并保存正式证据，不能写 Goal 状态。

### Rationale

Agent 自报完成不能构成接收方证明；测试框架也不能成为生产业务 owner。

### Alternatives Considered

只保留 final summary 或让执行 Agent 自评；拒绝，因为无法防止假完成。

### Consequences

验收可能增加延迟和成本，但失败必须进入 repair、partial 或 failed，而非
success。Station 必须提供可驱动、可读回的验收命令和结果合同。

## PAOS-D06: 迁移后删除重复任务与完成真源

**Status**: accepted
**Date**: 2026-10-03

### Context

兼容读写会长期保留 `AgentTask`、`CollaborationTask`、metadata-derived Goal 和
Applet completion inference。

### Decision

新真源、消费者切换和迁移验证完成后，在同一收口阶段删除旧 mutation 路径、
旧 API 和旧完成推断。回滚只通过版本或部署回滚。

### Rationale

单一真源要求旧路径真正消失，而不是被 UI 隐藏。

### Alternatives Considered

永久双写或兼容 shim；拒绝，因为它们保留不可证明的一致性。

### Consequences

切换前必须有完整消费者清单、迁移幂等证明和零引用扫描。

## PAOS-D07: durable Agent event 只通过共享 EventBus fan-out

**Status**: accepted
**Date**: 2026-10-03

### Context

Station 已有 `apps/station/app/subserver/events.EventBus` 作为全产品统一实时
fan-out 和 `/events/stream` owner；Agent 子服务仍创建私有
`MemoryEventBus`、维护 `EventStreamService` subscriber registry、暴露专属
stream route，并允许多个 service/handler 直接 publish。当前
`TaskEventWriter.Publish` 在部分 durable append 失败后仍继续发布，客户端可能
看到不可重放的事件。

### Decision

Goal、TaskRun、Decision、Artifact、Gate 和 Acceptance mutation 必须在同一
transaction 提交 durable domain record 与 `AgentRealtimeOutbox`。一个有
lease、retry 和 delivery marker 的 relay 将 pending row 转换为 typed
`StreamEvent` 并调用共享 Station `EventBus.Publish`。客户端只消费 canonical
`/events/stream`，使用 cursor、`Resync` 和 snapshot 恢复。publish 后崩溃
允许 at-least-once 重发，投影以 stable domain event identity 幂等收敛。
Relay 按 target actor 和 durable sequence 有序推进，前序 pending 时不越过；
目标 actor/device 只来自已持久化 ownership 与认证 context，不能来自 client
metadata。Outbox backlog 有界，并为 terminal/control event 保留容量；达到
上限时在启动新工作前暂停或拒绝 admission。

Agent 私有 bus、feature-owned fan-out、direct dispatch、专属 SSE、未提交事件
publish 和以 polling 驱动正常进度均禁止。队列和 ready frontier 必须有界；
overflow 必须断开或显式 `Resync`，不能静默丢弃。

### Rationale

一个 fan-out owner 才能统一 ordering、replay、背压、重连和跨功能事件顺序，
durable-before-fan-out 才能保证客户端看到的事实可在重启后读回。

### Alternatives Considered

- 保留 Agent 私有 bus，再桥接到共享 bus：拒绝，因为保留双 subscriber、
  双 replay 和双 backpressure authority。
- 继续由 UI/Applet polling：拒绝，因为轮询无法证明事件顺序且会形成第二恢复
  协议。
- append 失败时 best-effort publish：拒绝，因为制造不可重放的幽灵进度。

### Consequences

必须增加 Agent domain event 到 shared `StreamEvent` 的 typed adapter，迁移
Desktop/Applet 消费者，删除 Agent 私有 bus/SSE，并以
`agent-personal-goal-event-fanout-e2e` 与最终
`agent-personal-goal-architecture-guard` 证明 durable-before-fan-out、唯一
入口、ordered retry、bounded overload、resync、actor isolation 和零旁路。
