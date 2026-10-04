# Agent 数据模型

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-02 | **Updated**: 2026-10-03
> **Owner**: Peers-Touch Agent Team

---

## 1. 权威实体

| 实体 | 权威 owner | 稳定身份 |
|---|---|---|
| Agent | Station Agent subserver | `agent_id` |
| Conversation | Station Agent subserver | `conversation_id` |
| Turn | Station Agent subserver | `turn_id` |
| Message | Station Agent subserver | `message_id` |
| Capability Binding | Station Agent subserver | Agent + capability identity |
| ToolCall | Station Agent subserver | `tool_call_id` + attempt |
| MCP Server | Station Agent subserver | actor + `server_id` + revision |
| MCP Tool Manifest | Station Agent subserver | Server revision + tool schema digest |
| MCP Runtime Secret | Declared execution owner | `secret_ref` |
| MCP Process | Declared execution owner | Server revision + runtime epoch |

完整字段与 proto 定义以 `model/domain/agent/` 为唯一跨层合同真源；本文不复制
字段级 schema。

## 2. Turn 状态

```text
admitted
  -> running
  -> waiting_for_tool
  -> continuing
  -> completed

admitted|running|waiting_for_tool|continuing
  -> cancelled|failed
```

终态不可回退。重试创建受 fencing 约束的新 attempt，但不允许重复提交已认可的
side effect。

## 3. ToolCall 状态

```text
prepared -> dispatched -> succeeded
                     \-> failed
                     \-> cancelled
```

Station 持有 ToolCall 状态与 lineage。`STATION` ToolCall 由 Station executor
在本地记录 effect/receipt 后继续；`CLIENT_CAPABILITY` ToolCall 仅在有效
capability session 内由 Desktop 执行，并返回包含 attempt 与执行结果的
receipt。重复 receipt 必须幂等，过期或错误 fence 必须拒绝。

## 4. MCP Server 与 Tool Manifest

`McpServer` 至少包含 `server_id`、`ptid`、名称、transport、execution owner、
脱敏 transport 配置、secret refs、enabled、revision、runtime status 与
discovered tool snapshots。`stdio`、`http`、`sse` 不隐含执行位置。

每个 discovered tool 发布独立 `CapabilityManifest`：

```text
mcp server revision + tool name + input schema
  -> immutable MCP tool manifest version
  -> AgentCapabilityBinding
  -> CapabilityReadinessSnapshot
  -> ToolCall.execution_owner
```

ToolCall admission 后不得因 Server 更新、设备上线或模型参数改变 owner。Server
更新发布新 manifest version；旧 readiness snapshot 只能完成已提交调用，不能
接收新调用。

## 5. 能力绑定

`AgentCapabilityBinding` 表达 Agent 对版本化能力的选择；
`CapabilityReadinessSnapshot` 表达当前 actor/device/runtime 是否可执行。

Turn admission 同时要求：

- binding 存在且未撤销；
- manifest identity 与版本匹配；
- `CLIENT_CAPABILITY` 需要 actor/device capability session 有效；
- `STATION` 需要 Station MCP runtime readiness 有效；
- readiness 为 ready；
- 所需 executor 与 secret reference 在声明的 owner 边界内可解析。

## 6. 持久化与恢复

Station 持久化 Agent、Conversation、Turn、Message、MCP Server、
Tool Manifest、Binding 和 ToolCall 权威记录。Desktop 可缓存投影，但重启后
必须按稳定 ID 从 Station 重建；Desktop 本地只恢复 secret refs 对应的密文和
`CLIENT_CAPABILITY` runtime state。

最小可用 Journey 的恢复判定要求：

- 同一 Agent ID；
- 同一 Conversation ID；
- 同一最终 Assistant message ID；
- 相同内容 hash；
- 同一 MCP Server/Tool binding 可按 owner 重新建立 readiness；
- Station-local MCP 不依赖 Desktop capability session。

## 7. 类型映射

| 层 | 表示 |
|---|---|
| Model | `model/domain/agent/*.proto` |
| Station | 生成类型 + Agent domain/service/persistence |
| Desktop Rust | Tauri application/gateway DTO |
| Desktop TypeScript | Agent store/runtime projection |
| Acceptance | 只读 receiver 与 Station readback evidence |

任何层都不得以私有同名结构替代共享 proto 或 Station 权威身份。

## 8. Personal Agent OS 权威实体

| 实体 | 稳定身份 | 责任 |
|---|---|---|
| `AgentGoal` | `goal_id` | 目标合同、owner、workspace、budget、graph revision、lifecycle |
| `AgentGoalNode` | `goal_id + node_id` | Goal 图节点、依赖、优先级、关联 TaskRun |
| `AgentGoalDecision` | `goal_id + decision_id` | 人工或策略决策、候选项、evidence、resolution |
| `AgentGoalEvent` | `goal_id + event_seq` | 可重放的 Goal 状态变化 |
| `TaskRun` | `task_id` | 使用 `TaskRunStatus` 的唯一可执行工作生命周期 |
| `ExecutionStep` | `task_id + step_id + attempt` | 一次可调度执行步骤 |
| `TaskArtifact` | `artifact_id` | 不可变执行产物及 digest |
| `TaskGateResult` | `goal/task + gate identity` | 可重放的验收事实 |
| `GoalAcceptanceRound` | `goal_id + acceptance_revision + round` | criteria、evidence refs、独立 reviewer 和 verdict |
| `AgentRealtimeOutbox` | `domain_event_id + target_actor_ptid` | committed Agent event 的有界、可租约重试 fan-out 意图 |

`AgentTask` 与 `CollaborationTask` 不属于目标态权威实体。迁移期间只能作为
旧数据来源，禁止产生 Goal 新写入。

`TaskEvent` / `AgentGoalEvent` 是业务事件真源；`AgentRealtimeOutbox` 只保存
目标 audience、typed envelope reference、delivery state 和 shared EventBus
cursor，不复制或重新解释 lifecycle truth。

Atelier 的 `ProjectState`、Milestone 和 TaskGraph 表继续作为可重建查询投影：
`project_id` 等于 `goal_id`，其状态只从 AgentGoal、TaskRun、Decision、
Artifact 和 Gate 事实物化，不接受独立业务 mutation。

## 9. Goal 状态与版本

```text
draft -> reviewing -> ready -> running
running -> needs_user | replanning | recovering | accepting
accepting -> accepted | partial | failed
ready | running | needs_user | replanning | recovering -> cancelled
```

每个 Goal mutation 同时校验：

- actor ownership；
- `expected_revision`；
- idempotency key；
- 当前 lifecycle 允许的 transition；
- coordinator lease generation；
- 关联 TaskRun、decision 和 evidence identity。

`accepted` 只能由 Station `GoalAcceptanceService` 在已提交
`GoalAcceptanceRound` 后写入。客户端、Runtime Adapter、TaskRun executor、
Acceptance Framework 和 final summary 都不能直接产生 Goal 成功终态。

## 10. Goal 与 TaskRun 关系

```text
AgentGoal 1 --- N AgentGoalNode
AgentGoalNode 0..1 --- 1 TaskRun
TaskRun 1 --- N ExecutionStep
ExecutionStep 0..N --- N TaskArtifact
AgentGoal 1 --- N AgentGoalDecision
AgentGoal 1 --- N AgentGoalEvent
AgentGoal 1 --- N GoalAcceptanceRound
```

Chat 可先创建独立 `TaskRun(surface=CHAT)`；用户提升为 Goal 时新增
`AgentGoal` 并引用已有 TaskRun，不复制 Conversation、Turn 或 Message。
Canvas 创建 Goal graph 后，ready node 才产生 TaskRun。Atelier 只读取这些
权威实体的 projection。

## 11. 事件、恢复与大载荷

- `AgentGoalEvent.event_seq` 在单 Goal 内严格单调。
- Snapshot 带 `goal_revision` 与 `next_event_seq`；发现 gap 时先重载 snapshot。
- Coordinator takeover 先恢复 lease generation，再核对所有非终态 TaskRun。
- 决策、取消和重规划均先持久化 intent，再触发执行器副作用。
- Artifact 内容不进入 Goal event；event 只保存稳定 ID、digest 和有界摘要。
- 删除先进入 cleanup intent，清理 TaskRun、lease、临时 workspace 和未引用
  artifact 后才删除 Goal。
- Goal/Task mutation 在同一 database transaction 写 durable domain metadata
  record 和 `AgentRealtimeOutbox`；外部 Artifact bytes 先按 digest durable，
  commit 成功后 relay 才允许生成 realtime envelope。
- realtime envelope 保留 durable `event_id`、`event_seq`、`goal_id`、
  `task_id` 和 schema version，再进入共享
  `apps/station/app/subserver/events.EventBus.Publish`。
- Outbox relay 以 lease/generation claim pending row；成功后记录共享
  EventBus cursor。publish 后、delivery marker 前崩溃允许 at-least-once 重发，
  consumer 以 stable domain `event_id + event_seq` 幂等去重。
- Relay 按 target actor 与 durable sequence 有序推进；前序 pending 时不得
  发布后序 row。目标 actor/device 来自已持久化 owner 和认证 context，不接受
  client metadata 覆盖。
- `EventBus.Publish` 与 canonical `/events/stream` 是唯一 live fan-out path。
  Agent 私有 bus、subscriber map、直接 dispatch 和专属 SSE 已删除。
- domain/outbox transaction 失败不发布；EventBus 发布失败保持 outbox
  pending/retryable，不能把未投影等同于业务提交失败，也不能丢失已提交事实。
- subscriber queue、replay ring、ready frontier 和单次 replay 都有明确上限。
  overflow 或 cursor gap 产生 `Resync`，客户端随后重读 snapshot。
- Outbox pending 数按 actor/workspace 有界，并为 terminal/control event 保留
  容量；达到阈值后 coordinator 在新 dispatch 前暂停或拒绝 admission。
- Delivered outbox rows 只能在共享 EventBus durable cursor 已记录且保留窗口满足
  后清理；清理不改变 domain event 或 Acceptance evidence。
- 正常 Goal 进度由事件流推进。Polling 只允许作为有界 cold-load/health
  reconciliation，不能成为状态机时钟或 completion 判定来源。
