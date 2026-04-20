# A2A 协议集成 — 设计决策

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 决策索引

| ID | 决策 | 状态 |
|----|------|------|
| D-01 | Agent 作为框架级一等公民 | accepted |
| D-02 | 内部通信走 HTTP，保留 inproc transport | accepted |
| D-03 | 每个 Agent 独立 Card 与独立端点 | accepted |
| D-04 | Agent SubServer 为持久化 canonical source | accepted |
| D-05 | 跨边界上下文传播方案 | accepted |
| D-06 | 取消语义与级联策略 | accepted |
| D-07 | 鉴权方案 | accepted |

---

## D-01: Agent 作为框架级一等公民

**Status**: accepted
**Date**: 2026-04-18

### Context

Agent 仅作为 SubServer 存在于 `app/` 业务层。SubServer 只面向前端 HTTP 调用，其他组件（Social、Scheduler、Event System）无法在代码层面直接依赖 SubServer 的能力。

### Decision

在 `frame/core/` 新增 `agent/` 组件，与 Registry、Logger 并级。遵循现有组件模式（接口定义 + Plugin 注册 + Native 实现）。Agent SubServer 继续存在，作为业务层（DDD）的承载者。

### Rationale

- Agent 协作能力（发现、调用、流式通信）是基础设施级需求，不应局限在单个业务模块中。
- 遵循现有组件模式，零学习成本。
- 使得任何组件都能直接 `agent.Send()` 触发 Agent 执行。

### Alternatives Considered

- **仅在 SubServer 内集成 A2A**：改动最小，但其他组件无法直接使用 Agent 能力，且违反层级边界。
- **A2A 作为独立 SubServer**：两个 SubServer 之间的依赖不符合 DDD 边界原则。

### Consequences

- 正面：任意组件可对等依赖 Agent；与现有 frame 模式一致。
- 负面：新增框架级组件的维护成本；需修改初始化链。
- 边界条件（来自 R-17）：Native Agent 应能在无 Agent SubServer 的部署形态下独立工作。最小可用形态 = Client + Registry，Server 与本地 Agent 均为可选。

---

## D-02: 内部通信走 HTTP，保留 inproc transport

**Status**: accepted
**Date**: 2026-04-18

### Context

内部 Agent 间调用可以选择 inproc（进程内直调）或 HTTP（loopback）。需要确定默认路径和长期策略。

### Decision

终态下内部 Agent 间调用统一 HTTP JSON-RPC 2.0；同时 inproc 作为**永久** transport 选项保留（非仅迁移期开关）。

### Rationale

- 统一一条代码路径，降低维护成本。
- localhost loopback 延迟约 0.1ms，相比 LLM 调用秒级延迟可忽略（对请求-响应路径）。
- 所有交互可被标准 HTTP 工具观测，调试友好。

### Alternatives Considered

- **仅 HTTP**：Streaming Reasoning 事件（一秒数十帧）全走 HTTP+SSE 有内存与 GC 压力。
- **仅 inproc**：无法与外部 Agent 通信，违背 A2A 目标。

### Consequences

- 正面：统一观测、任意 Agent 可独立部署。
- 负面：需维护双 transport。
- 策略（来自 R-18）：跨进程或外部调用必须 HTTP；同进程默认 inproc，可被 Card 中显式 URL 强制 HTTP。inproc 也走 A2A 类型（相同消息转换层 + 状态机），仅替换 transport，保证语义一致。

---

## D-03: 每个 Agent 独立 Card 与独立端点

**Status**: accepted
**Date**: 2026-04-18

### Context

可以选择"Station 一张总 Card"或"每个 Agent 独立 Card"。

### Decision

每个 Agent 都有自己的 Card 和端点，不做 Station 总 Card。

### Rationale

- A2A 规范约定"一个 Agent 一个 Card"。
- 路由语义清晰：`/a2a/default` 就是默认 Agent。
- 外部调用方按 Agent 粒度声明依赖更精细。

### Alternatives Considered

- **Station 总 Card + skill 路由**：单端点承载所有 Agent，内部按 skill 分发。违反 A2A 规范的 Agent 粒度原则。

### Consequences

- 正面：语义清晰、符合规范。
- 待补充（来自 R-19）：需增加 Skill/Intent 维度的发现能力（`ResolveBySkill`、`ResolveByIntent`），避免退化为定向 RPC。Phase 4 落地。

---

## D-04: Agent SubServer 为持久化 canonical source

**Status**: accepted
**Date**: 2026-04-18

### Context

A2A 层需要持久化 Task 状态，同时 Agent SubServer 已有 Turn/Conversation/AgentMessage 持久化。

### Decision

不引入平行的"A2A 消息表"。Agent SubServer 的 Turn/Conversation/AgentMessage 是事实来源，`a2a:*` 只存协议状态。

### Rationale

- 双写最难维护，且没有性能收益。
- `Task.history` 由 Conversation 投影即可。
- 流式中间消息不需要持久化。

### Alternatives Considered

- **A2A 独立持久化**：完全独立的 A2A 消息存储，与 SubServer 解耦。维护成本高，数据一致性难保证。

### Consequences

- 正面：单一数据来源，维护简单。
- 张力（来自 R-20）：与 D-01 的"Agent 可独立部署"存在张力。解法：在 SubServer 不存在时，Native Agent 用最小存储 schema（`a2a:task:* + a2a:message:*`）兜底。提供 `MessageStore` 抽象接口，SubServer 实现完整版，Native 实现最小版。

---

## D-05: 跨边界上下文传播方案

**Status**: accepted
**Date**: 2026-04-18

### Context

Agent 间调用需要传播版本、调用深度、用户身份、Trace 等上下文信息。

### Decision

通过 HTTP header 传播：`A2A-Version`、`X-PeersTouch-Depth`、`X-PeersTouch-User`、W3C `traceparent` + `X-PeersTouch-LogID`。父 Task 引用通过 `Message.referenceTaskIds` 和 `Task.metadata` 传递。

### Rationale

- HTTP header 是跨进程传播的标准方式。
- W3C TraceContext 已是行业标准。
- 调用深度限制防止无限递归。

### Consequences

- 待增强（来自 R-21）：Phase 2 按 OTel GenAI Semantic Conventions 打 span，与主流 LLM observability 平台对齐。`Message.messageId` 同时作为幂等键被透传。

---

## D-06: 取消语义与级联策略

**Status**: accepted
**Date**: 2026-04-18

### Context

`CancelTask` 必须能真正中断正在执行的 Turn，且需要处理级联取消。

### Decision

- Native Agent Server 维护 `taskCancelers map[taskId]context.CancelFunc`。
- 收到 `CancelTask`：调用 cancel → grace 窗口（2s）→ 强制 `TASK_STATE_CANCELED` → SSE 推送 → 响应。
- 跨进程取消通过 A2A Client 透传。
- 已终态 Task 返回 `ErrTaskNotCancelable`。

### Rationale

- context.CancelFunc 是 Go 标准取消机制。
- grace 窗口允许清理资源。

### Consequences

- 待增强（来自 R-22）：取消必须级联到 child Task。基于 `rootTaskId` 维护 child task tracker，父 Task canceled/failed 时主动取消全部活跃 child。grace 窗口可按 Skill 配置。取消失败向上汇报。已消耗 token/成本无论终态都汇总。Phase 3 delegation 改造时一并落地。

---

## D-07: 鉴权方案

**Status**: accepted
**Date**: 2026-04-18

### Context

本地 Agent、远程 Agent、外部调用方的鉴权策略各不相同。

### Decision

- 本地 Agent：inproc 时无鉴权（同进程信任）；http loopback 时 HMAC 签名。
- 远程 Agent：Agent Card `securitySchemes` 声明方案。
- 远程调用方：默认 Bearer token，与 Station 用户体系绑定。
- 拒绝路径：返回 `TASK_STATE_AUTH_REQUIRED` 或 `TASK_STATE_REJECTED`。

### Rationale

- 分场景鉴权，避免过度设计。
- 利用 A2A 规范的 securitySchemes 机制。

### Consequences

- 待增强（来自 R-23）：鉴权只解决"你是谁"。外部 Agent 的 Message 是 untrusted input，需要 Policy 层拦截（prompt injection、confused deputy、资源耗尽、数据外泄）。建议 `OnInbound`/`OnOutbound`/`OnArtifact` Policy 接口。HMAC for loopback 可能 over-engineering，考虑 Unix socket 或 SPIFFE mTLS。

---

## 评审记录

以下为设计评审中提出的 25 条意见及其结论。详细上下文见各文件的对应章节。

### 评审索引

| ID | 主题 | 结论 | 落地阶段 |
|----|------|------|---------|
| R-01 | MCP ↔ A2A 双向桥 | 部分采纳 | Phase 4 |
| R-02 | Agent Card 缓存与签名 | 部分采纳 | Phase 1 (ETag/Cache) + Phase 4+ (签名) |
| R-03 | Part `kind` discriminator | 全采纳 | Phase 1 |
| R-04 | 协议版本协商 | 部分采纳 | Phase 1 (header) + Phase 4 (协商) |
| R-05 | SSE 事件序号与续传 | 全采纳 | Phase 2 |
| R-06 | Agent 接口 SRP 拆分 | 部分采纳 | Phase 1 |
| R-07 | AgentExecutor 反向依赖接口 | 全采纳 | Phase 2 |
| R-08 | 健康检查与多租户路由 | 部分采纳 (健康检查 Phase 4；多租户不做) | — |
| R-09 | 数据结构与 SecurityScheme 问题 | 部分采纳 | Phase 1 |
| R-10 | Part Kind 二次确认 | 全采纳（同 R-03） | Phase 1 |
| R-11 | 流式事件 Sequence 字段 | 全采纳 | Phase 2 |
| R-12 | 错误模型扩展 | 部分采纳 | Phase 2 (HTTP层) + Phase 4 (私有码) |
| R-13 | 幂等键与成本计量 | 全采纳 | Phase 2 (幂等) + Phase 4 (成本) |
| R-14 | 标识表补充 tenant/principal | 部分采纳 (去除 Tenant，保留 principal) | Phase 2 |
| R-15 | Orchestration 编排原语 | 延后 | Phase 5+ |
| R-16 | 私有 DataPart 在 Card extensions 声明 | 全采纳 | Phase 2 |
| R-17 | Native Agent 不强制依赖 SubServer | 全采纳 | Phase 1 |
| R-18 | inproc 作为永久 transport | 全采纳 | Phase 1 |
| R-19 | Skill/Intent 维度发现 | 部分采纳 | Phase 4 |
| R-20 | canonical source 与独立部署的张力 | 全采纳 | Phase 2 |
| R-21 | OTel GenAI Semantic Conventions | 全采纳 | Phase 2 |
| R-22 | 取消级联到 child Task | 全采纳 | Phase 3 |
| R-23 | Policy 安全层 | 部分采纳 | Phase 4 |
| R-24 | 实施计划 P0 项落点 | 部分采纳 | 已融入各 Phase |
| R-25 | 互通验证矩阵与决策索引 | 延后 (矩阵放 CI；索引即本文) | — |

### R-01: MCP ↔ A2A 双向桥

**意见**：当前只说"互补"，但生产中真正有价值的是双向桥：A2A Skill → MCP Tool（使 LLM 能调用 Peers-Touch Agent）、MCP Tool → A2A Skill（外部 A2A Client 看到完整能力）、Streaming 复用。

**结论**: 部分采纳 · Phase 4。方向正确，但 A2A 本身尚未落地时先做桥 = 同时维护两套不稳定协议。Phase 4 落地"A2A Skill → MCP Tool"单向桥，反向桥视 MCP 生态发展再定。`frame/core/agent/bridge/` 子模块延后到 Phase 4 立项。

### R-02: Agent Card 缓存与签名

**意见**：Card 何时变更？缓存多久？Client 怎么失效？Card 是否签名防劫持？

**结论**: 部分采纳。Phase 1 落地 `ETag` + `Cache-Control: max-age=N`，Client 用 `If-None-Match`。Card `version` 遵循 SemVer。签名（JWS + libp2p Identity Key）延后到 Phase 4+ 联邦发现阶段。

### R-03: Part `kind` discriminator

**意见**：A2A 1.0 的 Part 是带 `kind` 字段的 tagged union，当前设计使用全 optional 平铺，与规范不互通。

**结论**: 全采纳 · Phase 1。数据结构 Phase 1 定型时必须落地 `Kind PartKind` 字段（取值 `text|file|data`），`FilePart` 抽出独立结构体。

### R-04: 协议版本协商

**意见**：硬编码 `A2A-Version: "1.0"` 无法演进，缺降级路径。

**结论**: 部分采纳。Phase 1 在 Card 中预留 `supportedProtocolVersions` 字段；完整协商逻辑 Phase 4 实现。

### R-05: SSE 事件序号与 Last-Event-ID 续传

**意见**：事件没有序号，Server 没承诺缓冲，无法实现 idempotent 续订。

**结论**: 全采纳 · Phase 2。每个 stream event 增加 `sequence`（per task），SSE 输出 `id:` 行，Server 维护 ring buffer，`SubscribeToTask` 支持 `Last-Event-ID` 续传。

### R-06: Agent 接口 SRP 拆分

**意见**：Agent 接口同时承担生命周期、Registry、Client、Server 四种职责，违反 SRP。

**结论**: 部分采纳 · Phase 1。拆为 `AgentRegistry`、`AgentClient`、`AgentServer` 三个纯接口 + `Agent` facade。消费方只声明对需要的子接口的依赖。

### R-07: AgentExecutor 反向依赖接口

**意见**：Native Agent 收到外部请求后回调到 SubServer 的 Turn Loop 缺乏显式接口。

**结论**: 全采纳 · Phase 2。定义 `AgentExecutor` 接口（`Execute` + `Cancel`），SubServer 实现并通过 `AgentServer.RegisterExecutor(name, executor)` 注册。infra 与业务彻底解耦。

### R-08: 健康检查与多租户路由

**意见**：Card 200 ≠ 健康；缺多租户路由；`/api/a2a/tasks` 缺过滤。

**结论**: 部分采纳。健康检查 Phase 4 补充。**多租户不做**（Peers-Touch 面向个人用户，无多租户场景）。`AgentInterface.Tenant` 字段将被清理。Tasks 过滤 Phase 4 补充。

### R-09: 数据结构与 SecurityScheme 问题

**意见**：SecurityRequirement 类型注释不够清晰；SecurityScheme 多 optional 指针与规范 tagged union 不一致；远程 Agent 注册靠手喂 URL 与 P2P 定位不符。

**结论**: 部分采纳 · Phase 1。SecurityRequirement 补注释；SecurityScheme 改为带 `Type` 字段的 sum type 或自定义 Marshal/Unmarshal。libp2p 联邦发现延后到 Phase 4+。

### R-10: Part Kind 二次确认

**意见**：§4.2 的 Part 类型与 §2.3 同源问题。

**结论**: 全采纳（同 R-03），Phase 1 统一落地。

### R-11: 流式事件 Sequence 字段

**意见**：UpdateEvent 必须有 `Sequence` + `Timestamp` 字段，承载 R-05 的续传能力。StreamResponse 的 OneOf 也用 `kind` discriminator。

**结论**: 全采纳 · Phase 2。

### R-12: 错误模型扩展

**意见**：只覆盖 JSON-RPC 层，缺 HTTP 层错误语义、可恢复性分类、标准 data 载荷、私有错误码。

**结论**: 部分采纳。Phase 2 补充 HTTP 层语义（401/403/429/503）和 retryable/transient 分类。私有错误码命名空间（`-33000` 起）Phase 4。

### R-13: 幂等键与成本计量

**意见**：`SendMessage` 重试会重复触发 LLM 调用；TaskRecord 缺 token/成本字段；7 天 TTL 不应硬编码。

**结论**: 全采纳。Phase 2 用 `messageId` 做幂等键。Phase 4 补充 token/成本字段（对齐 OTel GenAI）。TTL 按 Skill 配置化。

### R-14: 标识表补充 tenant/principal

**意见**：缺 tenant、caller_principal、delegated_actor、root_task_id。

**结论**: 部分采纳。去除 Tenant（R-08 已决策不做多租户）。保留 `caller_principal`（Bearer sub）、`root_task_id`（跨级联追溯）Phase 2 落地。`delegated_actor` 延后。

### R-15: Orchestration 编排原语

**意见**：A2A 只解决"两个 Agent 怎么说话"，不解决"多个 Agent 怎么协作"。需要 Sequence/Parallel/Conditional/Loop 原语。

**结论**: 延后 · Phase 5+。方向正确，但在 A2A 基础落地前引入编排层过早。先用改造后的 delegation_service 验证多 Agent 场景，积累需求后再抽象。

### R-16: 私有 DataPart 在 Card extensions 声明

**意见**：自定义 DataPart 命名空间未在 Card 中宣告，外部 Client 无法感知。

**结论**: 全采纳 · Phase 2。在 Card `capabilities.extensions` 中显式列出所有 `peers-touch.*` 扩展 URI，发布对应 schema 文档。

### R-17: Native Agent 不强制依赖 SubServer

**意见**：Native Agent 应能在无 SubServer 的部署形态下独立工作。

**结论**: 全采纳 · Phase 1 设计时确保。最小可用形态 = Client + Registry，Server 与本地 Agent 均为可选。Card 列表可为空，初始化不报错。

### R-18: inproc 作为永久 transport

**意见**：Reasoning 流式事件数百帧全走 HTTP+SSE 有内存和 GC 压力。inproc 应作为永久选项。

**结论**: 全采纳 · Phase 1。inproc 作为永久 transport 保留。inproc 也走 A2A 类型（相同消息转换层 + 状态机），仅替换 transport。关键路径加 benchmark。

### R-19: Skill/Intent 维度发现

**意见**：按 Agent 名 Resolve 在内部足够，但缺能力发现。

**结论**: 部分采纳 · Phase 4。先实现 tag-based `ResolveBySkill`，embedding-based `ResolveByIntent` 视需求后续迭代。

### R-20: canonical source 与独立部署的张力

**意见**：如果必须依赖 SubServer 做持久化，轻量 A2A 网关形态不成立。

**结论**: 全采纳 · Phase 2。提供 `MessageStore` 抽象接口：SubServer 存在时按 Conversation 投影，不存在时按最小 schema 投影。接口语义不变，实现可替换。

### R-21: OTel GenAI Semantic Conventions

**意见**：直接按 OTel GenAI 打 span，与主流 LLM observability 平台对齐。

**结论**: 全采纳 · Phase 2。按 OTel GenAI Semantic Conventions 打 `agent.invoke` / `chat` / `tool.call` span。

### R-22: 取消级联到 child Task

**意见**：父 canceled、子还在烧 token 的僵尸态问题。

**结论**: 全采纳 · Phase 3。基于 `rootTaskId` 维护 child task tracker，父 canceled/failed 时主动取消全部活跃 child。grace 窗口可配置。取消失败向上汇报。token 无论终态都汇总。

### R-23: Policy 安全层

**意见**：外部 Agent 是不可信输入源，需要 Policy 拦截。

**结论**: 部分采纳 · Phase 4。定义 `Policy` 接口（`OnInbound`/`OnOutbound`/`OnArtifact`），内置 max parts/bytes、prompt-injection scanner、PII redaction、per-caller quota。

### R-24: 实施计划 P0 项落点

**意见**：Phase 1 只到 Card，但部分 P0 项不能放到 Phase 4 后。

**结论**: 部分采纳。已将 P0 项融入各 Phase：
- Phase 1：R-03/R-10 Part discriminator、R-06 接口拆分、R-09 SecurityScheme
- Phase 2：R-05/R-11 SSE 续传、R-13 幂等性、R-07 AgentExecutor
- Phase 3：R-22 取消级联

### R-25: 互通验证矩阵与决策索引

**意见**：附录补互通矩阵和决策索引。

**结论**: 延后。互通验证矩阵放测试文档/CI 报告（放设计文档会快速过期）。决策索引即本文。
