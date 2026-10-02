# Agent 架构

> **Status**: active
> **Version**: v1.4
> **Created**: 2026-04-11 | **Updated**: 2026-10-02
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
| [design.md](./design.md) | Agent 根模块的当前所有权、运行时拓扑与能力边界 |
| [decisions.md](./decisions.md) | 当前 Agent 根模块采用的已接受决策索引 |
| [data-model.md](./data-model.md) | Agent、Conversation、Turn、Capability Binding 与 ToolCall 的权威模型 |
| [module-layout.md](./module-layout.md) | Model、Station、Desktop 与 Acceptance 的模块职责 |
| [integration.md](./integration.md) | 跨运行时集成、证据和迁移边界 |
| [modern-chat-agent/](./modern-chat-agent/) | **Modern Chat Agent accepted product + architecture** — LobeHub/AgentBox benchmark disposition、产品旅程/状态/验收，以及 Station 单一真源下跨 Desktop/未来 Mobile 的单 Agent 内核；当前最小交付由 Minimum Usable Agent Chat Plan 管理 |
| [agent-canvas-orchestration.md](./agent-canvas-orchestration.md) | **当前 Agent 编排正式设计** — 以 Agent Canvas 为入口、GoalKeeper 为目标锚点、EngineMatcher/RunPlan/AutonomyController 为运行内核的多 Agent 编排架构 |
| [provider-station-ownership/](./provider-station-ownership/) | **Provider Station Ownership** — Station 是所有 AI Provider 的唯一执行者和配置所有者；Desktop/Mobile 是编辑入口 + SSE 消费端；per-actor 凭证隔离；版本号防脑裂 |
| [agent-lobehub-blueprint.md](./agent-lobehub-blueprint.md) | **当前 Agent 重构正式设计** — 以 LobeHub 为蓝本的 UI/UX、Tool、MCP、Skill、后端能力映射与目标架构 |
| [lobehub-parity/](./lobehub-parity/) | **Agent LobeHub 全栈能力对标账本** — 以 BOM/Spec/Plan/Gate/Evidence/Traceability 追踪 LobeHub 源码级对标、原型确认门与迁移设计 |
| [modern-chat-agent/prototype/](./modern-chat-agent/prototype/) | **Modern Chat Agent 产品原型** — Peers-owned 产品状态、交互、MCA traceability 与 Owner confirmation gate |
| [prototype/](./prototype/) | **历史 LobeHub benchmark 原型审查包** — 保留来源对标、Owner checklist 和历史迁移门证据，不再作为当前产品身份 |
| [agent-self-growth-architecture.md](./agent-self-growth-architecture.md) | **peers-touch 架构设计** — 自成长生命周期、领域对象、服务拓扑、Turn 执行闭环、成长评估机制 |
| [agent-memory-architecture.md](./agent-memory-architecture.md) | **Agent Memory 架构** — Memory 分层、存储、检索、反馈与可视化 |
| [hermes-agent-self-improving-analysis.md](./hermes-agent-self-improving-analysis.md) | **Hermes 参考分析** — hermes-agent 的七层架构、工程实现细节，作为设计参考 |
| [a2a/](./a2a/) | **A2A 协议集成** — Agent-to-Agent 协议、集成、数据模型、执行阶段 |
| [orchestration-kernel/](./orchestration-kernel/) | **多 Agent 编排内核** — Policy 驱动的协作内核、Decision/Evidence/Participant/Reduction/Convergence、Workflow/Provider/Policy/Federation 边界 |

---

## 4. 执行计划

执行计划独立于架构文档，按依赖顺序排列。状态标记：`done` = 代码已实现并跑通，`code` = 代码已编写但未端到端验证，`pending` = 未开始。

| 优先级 | 状态 | 文档 | 定位 |
|---|---|---|---|
| Current | prepared / minimum usable release | [Minimum Usable Agent Chat](./execution-plans/20261001-minimum-usable-agent-chat/plan.md) | **当前唯一执行入口** — 只关闭 Direct Model Agent Chat、Skill/MCP 注入、最终回复与重启恢复 |
| Historical | completed / remaining scope descoped | [Modern Chat Agent V2 Alignment Plan Package](./execution-plans/20260917-modern-chat-agent-v2-alignment/plan.md) | 2026-10-01 由 Product Owner 强制停止；未完成的外部 runtime、419-cell remediation 和 aggregate proof 全部退出首版路径 |
| Historical | superseded | [Modern Chat Agent V2 overview](./execution-plans/20260817-modern-chat-agent-v2.md) · [Legacy formal execution DAG](./execution-plans/20260817-modern-chat-agent-v2-execution.md) | 保留产品、架构、历史依赖和证据输入；不再承担 current Task 或 active execution 状态 |
| Amendment | owner approved | [Agent Delivery Recovery](./execution-plans/20260908-agent-delivery-recovery.md) | 2026-09-16 已批准 Home-first sequencing 与 C11 atomic activation；完整 G-F 不再阻塞 W2，未完成 `BASE-*` 作为 parked lane 保留 |
| V1 | accepted baseline | [First Useful Answer](./execution-plans/20260815-v1-first-useful-answer.md) | 已提供 Direct Model → Agent Profile → New Topic → 真实流式回复 → Desktop 重启读回基线；当前不再替代 V2 Home 产品推进 |
| P0-P2 | draft / design-blocked | [modern-chat-agent](./execution-plans/20260730-modern-chat-agent.md) | Station 单一真源下的现代 Agent Chat 集成、所有权切换与端到端验收计划 |
| P0-P4 | capability inventory | [agent-lobehub-rebuild](./execution-plans/20260616-agent-lobehub-rebuild.md) | LobeHub Agent 广度能力库存；不得再以模块/文件存在替代产品旅程完成，V1 完成前不启动新的横向能力批次 |
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
