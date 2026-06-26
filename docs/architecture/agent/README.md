# Agent 架构

> **Status**: active
> **Version**: v1.2
> **Created**: 2026-04-11 | **Updated**: 2026-06-25
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/station/app/subserver/agent/`, `apps/desktop/src-tauri/src/application/agent_turn/`, `apps/desktop/src-tauri/src/application/mcp/`

---

## 1. Document Scope

本目录是 Peers-Touch Agent 架构层正式入口，定义跨 Desktop Web、Desktop Rust、Station 的 Agent 能力边界、设计目标、执行计划和历史参考。

本目录不定义：

- Desktop 页面具体组件写法，见 `docs/client/desktop/`。
- Station DDD 代码规范，见 `docs/station/` 和 `docs/global/coding-guide/station/`。
- AI Agent 临时工作草稿，草稿可放 `.trae/documents/`，但不能作为唯一 source of truth。

---

## 2. 设计来源

本架构受 `external/hermes-agent` 启发，适配 peers-touch 的 Station + Tauri + Desktop 三层体系。核心理念：Agent 在运行中积累知识资产（Memory + Skill），通过信任评分和行为度量评估知识质量，通过精准归因和自动修正回收有害知识。

2026-06 起，Agent 产品体验重构以 `external/lobehub` 作为 UI / UX / Tool / Skill / MCP 能力蓝本，但实现必须遵守 Peers-Touch 的 Client -> Model -> Station 边界。

---

## 3. 文档

| 文档 | 定位 |
|---|---|
| [agent-canvas-orchestration.md](./agent-canvas-orchestration.md) | **当前 Agent 编排正式设计** — 以 Agent Canvas 为入口、GoalKeeper 为目标锚点、EngineMatcher/RunPlan/AutonomyController 为运行内核的多 Agent 编排架构 |
| [agent-lobehub-blueprint.md](./agent-lobehub-blueprint.md) | **当前 Agent 重构正式设计** — 以 LobeHub 为蓝本的 UI/UX、Tool、MCP、Skill、后端能力映射与目标架构 |
| [agent-self-growth-architecture.md](./agent-self-growth-architecture.md) | **peers-touch 架构设计** — 自成长生命周期、领域对象、服务拓扑、Turn 执行闭环、成长评估机制 |
| [agent-memory-architecture.md](./agent-memory-architecture.md) | **Agent Memory 架构** — Memory 分层、存储、检索、反馈与可视化 |
| [hermes-agent-self-improving-analysis.md](./hermes-agent-self-improving-analysis.md) | **Hermes 参考分析** — hermes-agent 的七层架构、工程实现细节，作为设计参考 |
| [a2a/](./a2a/) | **A2A 协议集成** — Agent-to-Agent 协议、集成、数据模型、执行阶段 |

---

## 4. 执行计划

执行计划独立于架构文档，按依赖顺序排列。状态标记：`done` = 代码已实现并跑通，`code` = 代码已编写但未端到端验证，`pending` = 未开始。

| 优先级 | 状态 | 文档 | 定位 |
|---|---|---|---|
| P0-P4 | active | [agent-lobehub-rebuild](./execution-plans/20260616-agent-lobehub-rebuild.md) | 以 LobeHub 为蓝本的 Agent 产品与能力重构执行计划 |
| P0 | code | [system-prompt-assembly](./execution-plans/20260411-system-prompt-assembly.md) | System Prompt 层级组装 + Context References + Prompt Caching |
| P0 | code | [skill-filesystem-and-routing](./execution-plans/20260411-skill-filesystem-and-routing.md) | Skill 文件系统、渐进式披露、Skills Guard 安全扫描 |
| P0 | code | [memory-bounded-store](./execution-plans/20260411-memory-bounded-store.md) | Memory 有界存储、冻结快照、Knowledge Salvage |
| P0 | code | [error-recovery](./execution-plans/20260411-error-recovery.md) | 错误分类与恢复 — 14 种 FailoverReason、分类管线、重试策略 |
| P0 | code | [context-compression-engineering](./execution-plans/20260411-context-compression-engineering.md) | Context Compression — 结构化摘要、迭代更新、Token Budget 尾部保护 |
| P1 | code | [background-review](./execution-plans/20260411-background-review.md) | Background Review — nudge 触发、错误处理、Credential Pool 继承 |
| P1 | code | [migration-ai-chat-to-agent](./execution-plans/20260411-migration-ai-chat-to-agent.md) | 存量 ai_chat 迁移至 agent subserver |
| P2 | pending | [dogfood-self-verification](./execution-plans/20260412-dogfood-self-verification.md) | Dogfood 自验证 — Scenario/Executor/Judge 框架、Tier 1-4 场景 |

> **状态说明**：P0/P1 计划的代码（约 8,000 行 Go）已编写在 `apps/station/app/subserver/agent/` 下，但所有验收标准均未通过端到端验证。当前首要任务是跑通第一个完整 Turn，而非继续编写新代码。

---

## 5. 核心结论

- Agent 编排 = **Agent Canvas 入口 + GoalKeeper 目标守卫 + EngineMatcher 工作引擎匹配 + RunPlan 可执行计划 + AutonomyController 自治推进 + Scheduler 调度 + Reducer 结果收口**。
- 编排入口必须保留现有 Agent 页能力：用户把已有 Agent 拖入 Canvas，输入协作目标，系统自动匹配工作引擎并运行。
- 编排内核必须避免“每一步都问继续”：阶段通过退出条件后自动推进，只有需求冲突、高风险副作用、缺失关键上下文、预算/重试超限才升级给用户。
- GoalKeeper 是编排内核一等模块：负责 GoalContract、non-goals、acceptance coverage、drift detection 和 final coverage check。
- Agent 自成长 = **知识获取 + 知识存储 + 知识应用 + 知识评估 + 知识修正** 的闭环。
- 成长可度量：Growth Score 基于 turn outcome 的行为度量（成功率、反馈比例、skill 效果、memory 信任健康度），不是 CRUD 计数器。
- 成长可归因：TurnTrace 记录每次 turn 实际使用的 memory snapshot 和 skills，反馈精准归因到具体知识资产。
- Station 承担全部后端能力，Tauri 承担通信桥接，Desktop 承担用户交互和成长可视化。
- Agent LobeHub 重构的正式设计文档必须放在 `docs/architecture/agent/`，`.trae/documents/` 只能作为工作草稿。

---

## 6. 命名约定

- 架构文档放在 `docs/architecture/agent/` 根目录
- 执行计划放在 `docs/architecture/agent/execution-plans/`，按日期命名
- 文件名格式：`日期-英文短名.md`
