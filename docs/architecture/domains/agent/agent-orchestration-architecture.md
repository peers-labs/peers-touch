# Agent Orchestration Architecture

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-26 | **Updated**: 2026-06-26
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/station/app/subserver/orchestration/`, `apps/station/app/subserver/memory/`, `apps/desktop/src/`, `model/domain/orchestration/`

---

## 1. Document Scope

本文档定义 Peers-Touch Agent 及编排能力的完整架构，包含：

- Agent Core：Turn 执行闭环、Memory 注入/提取、Skill 路由
- Orchestration Engine：多 Agent 协作、任务分解、共识收敛、验收判定
- Workspace：Agent 工作空间隔离、资源管理、生命周期
- Growth System：知识评估、反馈闭环、自成长度量

本文档不定义：

- Desktop 页面具体组件写法，见 `docs/client/desktop/`
- Station DDD 代码规范，见 `docs/station/`
- AI Agent 临时工作草稿，草稿可放 `.trae/documents/`

---

## 2. 核心原则

1. **Station 为唯一真源** — Memory、Skill、TurnTrace、CollaborationTask 持久化于 Station，端侧仅缓存摘要
2. **决策与执行分离** — Agent 只产出判断与提案，状态变更由 Orchestration Engine 事务执行
3. **完成必须可被状态谓词判定** — 任何"完成/通过/验收"都必须翻译成可查询的布尔表达式
4. **每个判断必须带证据引用** — 同意/反对/验收/风险标记都必须指向具体 Artifact 或 Trace
5. **预算与权限是全局闸** — 任何 Run 与协作轮次都从全局 Budget 扣费、过 Policy 校验
6. **一切可追踪、可重放、可恢复** — 每个动作进 Trace；每个 Run 幂等可重放；项目可从最近 accepted 锚点 resume

---

## 3. 系统架构

### 3.1 分层架构

```
┌──────────────────────────────────────────────────────────────────┐
│ Desktop Web: Agent Workbench                                     │
│   Pages: Chat, AgentProfile, Memory, Activity, Orchestration     │
│   Runtimes: agentRuntime, chatRuntime, memoryRuntime, toolRuntime│
└───────────────────────────────▲──────────────────────────────────┘
                                │ Tauri commands + typed events
┌───────────────────────────────┴──────────────────────────────────┐
│ Desktop Rust: Local Agent Runtime                                │
│   - MCP stdio/http/sse server management                         │
│   - Local builtin tools (file/clipboard/shell-safe)              │
│   - Workspace isolation & path guard                             │
│   - Stream forwarding & cancellation                             │
└───────────────────────────────▲──────────────────────────────────┘
                                │ HTTP/SSE + protobuf/domain DTOs
┌───────────────────────────────┴──────────────────────────────────┐
│ Station: Agent Intelligence & Orchestration                      │
│   ├── Agent Subserver: TurnService, SkillService                 │
│   ├── Memory Subserver: Retrieval, Extraction, Persona          │
│   └── Orchestration Subserver: Collaboration, Consensus, Budget │
└───────────────────────────────▲──────────────────────────────────┘
                                │ PostgreSQL + Vector Store
┌───────────────────────────────┴──────────────────────────────────┐
│ Model + Storage Layer                                            │
│   Proto contracts, PostgreSQL, pgvector, Provider credentials    │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 领域边界

| 领域 | 职责 | 不负责 |
|------|------|--------|
| **Turn Orchestration** | Turn 执行闭环、prompt 组装、provider 调用、tool loop | 主观判断、决策 |
| **Memory** | 记忆检索、提取、注入、生命周期、Persona | 文档 RAG（那是 Knowledge Base） |
| **Skill** | Skill CRUD、import、trust scan、versioning | 插件运行时（那是 Plugin） |
| **Orchestration** | 多 Agent 协作、任务分解、共识、验收 | 事务性状态落地（那是 Core） |
| **Workspace** | 工作空间隔离、路径管理、资源清理 | OS 级 sandbox |
| **Growth** | 知识评估、反馈收集、成长度量 | 主观评价 |

---

## 4. 核心领域模型

### 4.1 Turn Orchestration

```
Turn {
  turn_id, conversation_id, agent_id, user_input, final_response
  status: running|completed|failed|interrupted
  started_at, ended_at, tool_iterations
}

TurnTrace {
  trace_id, turn_id, system_prompt_hash, memory_snapshot_hash, skill_index_hash
  skills_loaded[], tool_calls[], provider_calls[], errors_classified[], delegation_results[]
}

ToolCallRecord {
  tool_name, arguments, result, duration_ms, approval_required, approval_decision
}
```

### 4.2 Memory

```
Memory {
  id, user_id, agent_id, session_id, layer: identity|preference|context|experience|activity
  source: extraction|agent_tool|user_input|system
  content, summary, tags, relevance, access_count, expires_at
}

Persona {
  user_id, tagline, narrative, traits[], generated_at, updated_at
}

MemoryRetrievalRequest {
  user_id, agent_id, session_id, query, effort: low|medium|high
}

MemoryRetrievalResponse {
  memories[], persona, formatted_context
}
```

### 4.3 Orchestration

```
CollaborationTask {
  task_id, project_id, engine: expert_hierarchy|roundtable|debate|swarm
  contract: { goals[], non_goals[], acceptance_predicates[], level: L0|L1|L2 }
  status: pending|active|reached|escalated|cancelled
  rounds_completed, max_rounds, budget_remaining
}

Decision {
  decision_id, task_id, role: goal_owner|architect|planner|verifier|executor
  type: approve|reject|abstain, evidence_ref, rationale
}

Artifact {
  id, run_id, type, uri, checksum, produced_at, refs[]
}

Budget {
  project_id, token_cap, money_cap, wall_clock_cap
  max_fix_loops, max_collab_rounds, max_parallel_runs
  spent_tokens, spent_money, elapsed_ms
}
```

### 4.4 Workspace

```
Workspace {
  workspace_id, agent_id, root_path, isolation_mode: shared|independent
  isolation_retention_days, allowed_roots[], created_at, updated_at
}

TaskWorkspace {
  task_workspace_id, workspace_id, conversation_id, path
  created_at, completed_at, retention_days
}
```

---

## 5. Turn 执行闭环

### 5.1 标准时序

```
User action
  │
  ▼
1. Context Assembly
   ├── Memory Retrieval (向量+关键词+时间衰减)
   ├── Skill Loading (按 trust level 路由)
   ├── System Prompt Assembly (SOUL.md + AGENTS.md)
   └── Knowledge Injection
  │
  ▼
2. Turn Execution
   ├── Provider Call (streaming)
   ├── Tool Call → Approval → Execution → Result
   ├── Error Classification → Recovery/Fallback
   └── Context Compression
  │
  ▼
3. Trace & Review
   ├── TurnTrace 持久化
   ├── Memory Extraction (异步)
   ├── Review Trigger
   └── Feedback Collection
  │
  ▼
4. Growth
   ├── Growth Score 计算
   ├── Knowledge Quality Assessment
   ├── Memory/Skill Trust Update
   └── Knowledge Correction
```

### 5.2 Tool Loop

```
Provider returns tool_call
  │
  ▼
ToolRegistry resolves tool
  │
  ├─ local tool → Desktop Rust bridge
  │     ├── Approval required? → await user decision
  │     ├── Execute tool
  │     └── Return result to Station
  │
  └─ remote/MCP tool → Direct execution
        ├── Policy check
        ├── Execute tool
        └── Return result to Station
  │
  ▼
Station continues model loop
```

---

## 6. 协作引擎与权力结构

### 6.1 引擎选择矩阵

| 引擎 | 适用问题 | 收敛方式 | 默认场景 |
|------|---------|---------|---------|
| **Roundtable** | 方案发散、头脑风暴 | 主持人收敛 | 早期目标探索 |
| **Expert Mesh** | 能力互补、并行专精 | 聚合器合并 | 多子系统并行设计 |
| **Debate Judge** | 多方案冲突 | Judge 裁决 | 架构选型有争议 |
| **Swarm** | 海量同构并行子任务 | 结果归约 + 多数 | 批量改造/扫描 |
| **Hierarchy** | 长流程、强秩序 | 上级签字 | 项目主推进 |
| **Expert Hierarchy** | 长流程 + 能力互补 | 终裁者签字 + 无未决反对 | **默认** |

### 6.2 Expert Hierarchy 权力结构

```
Goal Owner（终裁者，唯一 final signoff 权）
   │  否决任何偏离 contract.goals 的决定
┌──┴──┐
Architect     Planner     Risk & Policy（对危险动作有硬否决 + 强制升级权）
(架构否决权)   (拆解权)
└──┬──┘
Supervisor（推进与收敛控制，无内容否决权，有强制收敛/升级权）
   │
┌──┴──┐
Executor（执行，无判断权）   Verifier（验收否决权，判断必带 evidence）
```

### 6.3 共识收敛机制

```
进入 reached 的充要条件：
  authority_signoff == true
  AND open_objections.filter(unresolved && has_evidence).count == 0

反附和规则：
  - 赞成票必须附 evidence_ref，否则不计入"无未决反对"判定
  - 反对票无 evidence 则降级为"疑虑"，记录但不阻断
  - Verifier 与 Executor 不得由同一模型实例承担

收敛失败处理：
  rounds 达 max_rounds 仍未 reached → state=escalated，
  带"分歧快照 + 各方 evidence"升级用户裁决
```

---

## 7. 验收可判定性分级

```
L0 二值可判定：test/build/lint/编译/schema 校验
   Verifier = 确定性脚本；自动验收；human-in-loop ≈ 0

L1 规则可判定：数值阈值、投资约束、数据质量规则、来源白名单
   Verifier = 规则引擎；自动验收；异常才升级

L2 主观需人判：研究结论质量、内容质量、策略合理性、不可逆动作
   Verifier = LLM 仅产出"建议 + 证据"，强制 awaiting_human
```

---

## 8. 预算熔断

```
Budget {
  token_cap, money_cap, wall_clock_cap
  max_fix_loops, max_collab_rounds, max_parallel_runs
}

每个 Run/Round 执行前预扣、执行后结算
任一维度触顶 → 该层熔断 → 升级用户（附：已花成本、当前进度、最近 accepted 锚点）
Swarm/Mesh 并行度受 max_parallel_runs 硬限
```

---

## 9. Growth 度量体系

### 9.1 Growth Score

```
GrowthScore = 
  0.25 × (TurnSuccessRate - ErrorRate) +
  0.25 × (PositiveFeedbackRatio - NegativeFeedbackRatio) +
  0.25 × (SkillEffectiveness × SkillUsageRate) +
  0.25 × (MemoryTrustScore × MemoryUsageRate)
```

### 9.2 评价层级

| 层级 | 指标 | 反指标 | 治理动作 |
|------|------|--------|---------|
| **资产层** | Memory count, Skill count, Trust score | 重复记忆率, 恶意 skill 数 | 去重, 清理 |
| **行为层** | Turn success rate, Feedback ratio, Tool usage rate | Error rate, Retry rate | Error recovery |
| **对照层** | Growth score 趋势, Knowledge quality | 知识退化, 有害知识 | Knowledge correction |
| **长期层** | 用户留存, 任务完成率 | 任务丢弃率, 成本飙升 | Budget control |

---

## 10. 交付物清单

### 10.1 Proto 定义

| 文件 | 内容 |
|------|------|
| `model/domain/memory/memory.proto` | Memory 实体、层级、评分 |
| `model/domain/memory/persona.proto` | 用户画像模型 |
| `model/domain/memory/memory_api.proto` | Memory API 请求/响应 |
| `model/domain/orchestration/orchestration.proto` | CollaborationTask、Decision、Artifact、Budget |

### 10.2 Station Subserver

| Subserver | 目录 | 服务 |
|-----------|------|------|
| Memory | `apps/station/app/subserver/memory/` | RetrievalService、ExtractionService、PersonaService、LifecycleService |
| Orchestration | `apps/station/app/subserver/orchestration/` | CollaborationService、ConsensusService、BudgetService、VerificationService |

### 10.3 Desktop Web

| Runtime | 职责 |
|---------|------|
| `agentRuntime` | Agent 列表、Profile、选择、绑定 |
| `chatRuntime` | 对话、消息、流事件、搜索 |
| `memoryRuntime` | Memory 检索、Persona、可视化 |
| `toolRuntime` | 工具、MCP、approval、审计 |
| `orchestrationRuntime` | 协作任务、决策、验收状态 |

### 10.4 测试与验证

| 测试类型 | 覆盖范围 |
|----------|---------|
| Unit | Station services、Desktop Rust commands |
| Integration | Turn 执行闭环、Memory 注入/提取、Tool loop |
| End-to-end | 完整协作流程、Budget 熔断、Resume |

---

## 11. 关联文档

- [Agent LobeHub Blueprint](./agent-lobehub-blueprint.md)
- [Agent Self-Growth Architecture](./agent-self-growth-architecture.md)
- [Agent Memory Architecture](./agent-memory-architecture.md)
- [Atelier Design](../applets/atelier/design.md)
- [Station/Desktop Scope Boundary](../../platform/station-desktop-boundary.md)