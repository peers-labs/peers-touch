# Agent Orchestration Rebuild — Execution Plan

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-26 | **Updated**: 2026-06-26
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/station/app/subserver/memory/`, `apps/station/app/subserver/orchestration/`, `apps/desktop/src/`, `model/domain/`

---

## 1. Purpose

本执行计划将 [Agent Orchestration Architecture](../agent-orchestration-architecture.md) 转化为有序的实施阶段。

计划遵循：
1. Domain Responsibility
2. Execution Closure
3. Dependency Order
4. Verifiable Delivery

---

## 2. Worktree

```
<workspace-root>/peers-ai-agent
```

---

## 3. 真实升级目标

### 3.1 背景

当前 Agent 能力已完成 P0-P2 阶段（streaming、MCP 执行、tool approval、skill persistence、agent persistence），但存在以下问题：

1. **编排能力缺失**：Atelier 设计文档已完成，但未落地——多 Agent 协作引擎、任务分解、共识机制、验收判定等核心能力仍为设计状态
2. **Memory 系统未实现**：Station Memory 子服务架构已设计，但代码未落地，端侧仍为 stub
3. **P3-P5 能力缺口**：Agent Profile 完善、Knowledge、Artifacts、Voice、Connectors 等尚未实现
4. **历史包袱**：部分代码仍使用 `ai_chat` 遗留路径，存在冗余和不一致

### 3.2 目标定义

将 Agent 及编排能力重构为完整的产品化系统，包含：

| 能力域 | 目标 |
|--------|------|
| **Agent Core** | 完整的 Turn 执行闭环、Memory 注入/提取、Skill 路由 |
| **Orchestration Engine** | 多 Agent 协作、任务分解、共识收敛、验收判定 |
| **Workspace** | Agent 工作空间隔离、资源管理、生命周期 |
| **Growth System** | 知识评估、反馈闭环、自成长度量 |

### 3.3 非目标

- Agent Marketplace（P4 范畴）
- Voice TTS/STT（P5 范畴）
- OAuth Connector（P5 范畴）
- 三方 Connector Framework（P5 范畴）

---

## 4. 领域责任拆分

| 领域 | 职责边界 | 主链路执行者 | 长期资产产出 | 判定者 |
|------|---------|------------|-------------|--------|
| **Turn Orchestration** | Turn 执行闭环、prompt 组装、provider 调用、tool loop、error recovery | TurnService | TurnTrace、messages | TurnService |
| **Memory** | 记忆检索、提取、注入、生命周期管理、Persona 生成 | MemoryService | Memory records、Persona | MemoryService |
| **Skill** | Skill CRUD、import、trust scan、versioning、per-agent binding | SkillService | Skill packages、trust metadata | SkillService |
| **Orchestration** | 多 Agent 协作、任务分解、共识收敛、验收判定、budget 熔断 | OrchestrationService | CollaborationTask、Decision、Artifact | OrchestrationService |
| **Workspace** | Agent 工作空间、路径隔离、资源管理、清理策略 | WorkspaceService | Workspace state | WorkspaceService |
| **Growth** | 知识评估、反馈收集、成长度量、知识修正 | GrowthService | GrowthSnapshot、Feedback | GrowthService |
| **UI Projection** | Agent Profile、Chat、Activity、Memory 可视化 | Desktop runtimes | Runtime projections | Desktop runtimes |

---

## 5. Turn 生命周期校验

完整执行生命周期验证领域拆分：

```
1. Context Assembly
   ├── Memory Retrieval → MemoryService
   ├── Skill Loading → SkillService
   ├── System Prompt Assembly → TurnService
   └── Knowledge Injection → TurnService
  │
  ▼
2. Turn Execution → TurnService
   ├── Provider Call
   ├── Tool Call → ToolRegistry → Desktop Rust bridge
   ├── Error Classification → TurnService
   └── Context Compression → TurnService
  │
  ▼
3. Trace & Review
   ├── TurnTrace 持久化 → TurnService
   ├── Memory Extraction → MemoryService
   ├── Review Trigger → TurnService
   └── Feedback Collection → GrowthService
  │
  ▼
4. Growth → GrowthService
   ├── Growth Score 计算
   ├── Knowledge Quality Assessment
   ├── Memory/Skill Trust Update → MemoryService/SkillService
   └── Knowledge Correction
```

所有领域均在闭环中找到位置，拆分成立。

---

## 6. Phase 总览

| Phase | Goal | 依赖 | 主要交付物 |
|-------|------|------|-----------|
| **Phase 1** | 底座上下文 — Proto + Station Memory/Orchestration | 无 | Proto 定义、Memory Subserver、Orchestration Subserver |
| **Phase 2** | 主执行链 — Turn 闭环 + Memory 注入/提取 + Skill 路由 | Phase 1 | Turn 端到端闭环、Memory pipeline、Skill 安全扫描 |
| **Phase 3** | 编排与验收 — 协作引擎 + 共识 + 预算熔断 | Phase 2 | Collaboration Engine、Consensus、Budget、Verification |
| **Phase 4** | Workspace & Growth — 工作空间 + 成长度量 | Phase 3 | Workspace 隔离、Growth Score、Knowledge Correction |
| **Phase 5** | UI Projection — Agent Profile + Memory 可视化 | Phase 2-4 | 完善 Profile、Memory 页面、Activity 事件流 |

---

## 7. Phase 1 — 底座上下文

### 7.1 Proto 定义

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P1-1 | Memory proto 定义（memory.proto） | `model/domain/memory/memory.proto` | 无 | `./model/build.sh` 通过 |
| P1-2 | Persona proto 定义（persona.proto） | `model/domain/memory/persona.proto` | P1-1 | `./model/build.sh` 通过 |
| P1-3 | Memory API proto 定义（memory_api.proto） | `model/domain/memory/memory_api.proto` | P1-1, P1-2 | `./model/build.sh` 通过 |
| P1-4 | Orchestration proto 定义 | `model/domain/orchestration/orchestration.proto` | 无 | `./model/build.sh` 通过 |
| P1-5 | 生成 Go/TS 代码 | `./model/build.sh` | P1-1~P1-4 | 生成无报错 |

### 7.2 Station Memory Subserver

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P1-6 | Memory Subserver 目录结构与注册 | `apps/station/app/subserver/memory/` | P1-5 | 编译通过 |
| P1-7 | Memory 持久化模型（GORM） | `apps/station/app/subserver/memory/db/model/` | P1-6 | `go test ./memory/db/...` |
| P1-8 | Embedding 引擎封装 | `apps/station/app/subserver/memory/embedding/` | P1-6 | 编译通过 |
| P1-9 | RetrievalService（向量+关键词混合检索） | `apps/station/app/subserver/memory/service/` | P1-7, P1-8 | `go test ./memory/service/...` |
| P1-10 | ExtractionService（异步提取） | `apps/station/app/subserver/memory/service/` | P1-7, P1-8 | `go test ./memory/service/...` |
| P1-11 | PersonaService（用户画像生成） | `apps/station/app/subserver/memory/service/` | P1-7 | `go test ./memory/service/...` |
| P1-12 | LifecycleService（衰减/合并/归档） | `apps/station/app/subserver/memory/service/` | P1-7 | `go test ./memory/service/...` |
| P1-13 | Handler 层（HTTP API） | `apps/station/app/subserver/memory/handler/` | P1-9~P1-12 | `go test ./memory/handler/...` |

### 7.3 Station Orchestration Subserver

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P1-14 | Orchestration Subserver 目录结构与注册 | `apps/station/app/subserver/orchestration/` | P1-5 | 编译通过 |
| P1-15 | 持久化模型（CollaborationTask/Decision/Artifact/Budget） | `apps/station/app/subserver/orchestration/db/model/` | P1-14 | `go test ./orchestration/db/...` |
| P1-16 | CollaborationService（协作任务管理） | `apps/station/app/subserver/orchestration/service/` | P1-15 | `go test ./orchestration/service/...` |
| P1-17 | ConsensusService（共识收敛） | `apps/station/app/subserver/orchestration/service/` | P1-15 | `go test ./orchestration/service/...` |
| P1-18 | BudgetService（预算管理） | `apps/station/app/subserver/orchestration/service/` | P1-15 | `go test ./orchestration/service/...` |
| P1-19 | VerificationService（验收判定） | `apps/station/app/subserver/orchestration/service/` | P1-15 | `go test ./orchestration/service/...` |
| P1-20 | Handler 层（HTTP API） | `apps/station/app/subserver/orchestration/handler/` | P1-16~P1-19 | `go test ./orchestration/handler/...` |

### 7.4 Phase 1 验收标准

1. `./model/build.sh` 通过
2. `go test ./app/subserver/memory/...` 通过
3. `go test ./app/subserver/orchestration/...` 通过
4. Memory API 端点可访问（`/memory/search`, `/memory/persona`）
5. Orchestration API 端点可访问（`/orchestration/task/create`, `/orchestration/budget/get`）

---

## 8. Phase 2 — 主执行链

### 8.1 Turn Orchestration 闭环

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P2-1 | TurnService 集成 Memory Retrieval（前置检索） | `apps/station/app/subserver/agent/service/` | P1-9 | 单测：memory 正确注入 prompt |
| P2-2 | TurnService 集成 Memory Extraction（后置提取） | `apps/station/app/subserver/agent/service/` | P1-10 | 单测：对话后提取新记忆 |
| P2-3 | TurnService 集成 Skill Loading | `apps/station/app/subserver/agent/service/` | P1-9 | 单测：skill 正确路由 |
| P2-4 | TurnService 完善 Error Recovery | `apps/station/app/subserver/agent/service/` | 无 | 单测：各 FailoverReason 正确分类 |
| P2-5 | TurnService 完善 Context Compression | `apps/station/app/subserver/agent/service/` | 无 | 单测：token budget 保护生效 |
| P2-6 | 端到端 Turn 测试 | 集成测试 | P2-1~P2-5 | 完整 turn 流程通过 |

### 8.2 Memory 注入/提取 Pipeline

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P2-7 | Turn pipeline 调用 Memory Retrieval | `apps/station/app/subserver/agent/service/` | P2-1 | 集成测试：memory 注入 prompt |
| P2-8 | Turn pipeline 调用 Memory Extraction（异步） | `apps/station/app/subserver/agent/service/` | P2-2 | 集成测试：对话后提取成功 |
| P2-9 | Persona 生成与缓存 | `apps/station/app/subserver/memory/service/` | P1-11 | 单测：persona 正确生成 |

### 8.3 Skill 路由 & 安全扫描

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P2-10 | SkillsGuardService 安全扫描 | `apps/station/app/subserver/agent/service/` | 无 | 单测：恶意 skill 被拦截 |
| P2-11 | SkillVersion 版本管理 | `apps/station/app/subserver/agent/service/` | 无 | 单测：版本回滚生效 |
| P2-12 | Per-agent Skill Binding | `apps/station/app/subserver/agent/service/` | 无 | 单测：skill 绑定到 agent |

### 8.4 Phase 2 验收标准

1. `go test ./app/subserver/agent/...` 通过
2. 完整 Turn 流程端到端通过：用户输入 → Memory 检索 → Skill 加载 → Provider 调用 → Tool loop → Memory 提取 → TurnTrace 持久化
3. Memory 正确注入到 system prompt
4. 对话后异步提取新记忆并持久化
5. 恶意 skill 被 SkillsGuard 拦截

---

## 9. Phase 3 — 编排与验收

### 9.1 Collaboration Engine

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P3-1 | Expert Hierarchy 引擎 | `apps/station/app/subserver/orchestration/service/` | P1-16 | 单测：角色权限正确 |
| P3-2 | Roundtable 引擎 | `apps/station/app/subserver/orchestration/service/` | P1-16 | 单测：发散→收敛 |
| P3-3 | Debate Judge 引擎 | `apps/station/app/subserver/orchestration/service/` | P1-16 | 单测：多方案裁决 |
| P3-4 | Swarm 引擎 | `apps/station/app/subserver/orchestration/service/` | P1-16 | 单测：并行任务归约 |
| P3-5 | 引擎切换机制 | `apps/station/app/subserver/orchestration/service/` | P3-1~P3-4 | 单测：引擎动态切换 |

### 9.2 Consensus & Verification

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P3-6 | 共识收敛机制（evidence_ref） | `apps/station/app/subserver/orchestration/service/` | P1-17 | 单测：无证据反对不阻断 |
| P3-7 | L0/L1/L2 验收分级 | `apps/station/app/subserver/orchestration/service/` | P1-19 | 单测：各 level 正确判定 |
| P3-8 | 反附和规则 | `apps/station/app/subserver/orchestration/service/` | P3-6 | 单测：证据验证生效 |

### 9.3 Budget & Circuit Breaker

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P3-9 | Budget 预扣/结算 | `apps/station/app/subserver/orchestration/service/` | P1-18 | 单测：扣费正确 |
| P3-10 | Circuit Breaker 熔断 | `apps/station/app/subserver/orchestration/service/` | P3-9 | 单测：触顶自动熔断 |
| P3-11 | Resume 断点恢复 | `apps/station/app/subserver/orchestration/service/` | P1-16 | 单测：从 accepted 锚点恢复 |

### 9.4 Phase 3 验收标准

1. `go test ./app/subserver/orchestration/...` 通过
2. Expert Hierarchy 协作流程完整：Goal Owner → Architect → Planner → Supervisor → Executor → Verifier
3. 共识收敛：有证据反对才阻断，无证据反对不阻断
4. Budget 触顶自动熔断，附带已花成本和当前进度
5. Resume 从最近 accepted 锚点恢复，已完成任务不复跑

---

## 10. Phase 4 — Workspace & Growth

### 10.1 Workspace 隔离策略

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P4-1 | WorkspaceService（Station 级） | `apps/station/app/subserver/orchestration/service/` | P1-15 | `go test ./orchestration/service/...` |
| P4-2 | Workspace 隔离模式（shared/independent） | `apps/station/app/subserver/orchestration/service/` | P4-1 | 单测：隔离策略生效 |
| P4-3 | 路径 Guard 强化 | `apps/desktop/src-tauri/src/application/tools/` | P4-1 | `cargo test tools::tests` |
| P4-4 | Workspace 清理策略 | `apps/station/app/subserver/orchestration/service/` | P4-1 | 单测：清理过期任务 |

### 10.2 Growth 度量体系

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P4-5 | GrowthService（Growth Score 计算） | `apps/station/app/subserver/agent/service/` | 无 | `go test ./agent/service/...` |
| P4-6 | Feedback Collection | `apps/station/app/subserver/agent/service/` | 无 | 单测：反馈正确记录 |
| P4-7 | Knowledge Quality Assessment | `apps/station/app/subserver/agent/service/` | P4-5 | 单测：知识质量评估生效 |
| P4-8 | Knowledge Correction（有害知识回收） | `apps/station/app/subserver/agent/service/` | P4-7 | 单测：有害知识被回收 |

### 10.3 Phase 4 验收标准

1. `go test ./app/subserver/orchestration/...` 通过
2. `go test ./app/subserver/agent/...` 通过
3. Workspace 隔离：independent 模式生成独立目录
4. Growth Score 可计算：基于 turn success、feedback、skill effectiveness、memory trust
5. 有害知识被正确回收（trust score 降至阈值以下）

---

## 11. Phase 5 — UI Projection

### 11.1 Agent Profile 完善

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P5-1 | Agent Profile 按 LobeHub 蓝本补齐 | `apps/desktop/src/pages/AgentProfilePage.tsx` | Phase 2 | UI 功能完整 |
| P5-2 | Station Memory 对接 UI | `apps/desktop/src/pages/MemoryPage.tsx` | Phase 2 | 记忆正确展示 |
| P5-3 | Persona 可视化 | `apps/desktop/src/pages/MemoryPage.tsx` | Phase 2 | Persona 正确生成 |

### 11.2 Activity 事件流

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P5-4 | Activity 事件流完善 | `apps/desktop/src/pages/AgentProfilePage.tsx` | Phase 2 | 事件实时刷新 |
| P5-5 | Orchestration 状态投影 | `apps/desktop/src/runtimes/orchestrationRuntime.ts` | Phase 3 | 协作状态正确投影 |

### 11.3 Desktop Rust 同步

| ID | 任务 | 改动位置 | 依赖 | 验证 |
|----|------|---------|------|------|
| P5-6 | Memory Tauri commands（调用 Station API） | `apps/desktop/src-tauri/src/application/memory/` | Phase 2 | `cargo check` |
| P5-7 | Orchestration Tauri commands | `apps/desktop/src-tauri/src/application/orchestration/` | Phase 3 | `cargo check` |

### 11.4 Phase 5 验收标准

1. `pnpm run check` 通过
2. `pnpm run build` 通过
3. Memory 页面展示真实 Station 数据
4. Activity 事件实时刷新
5. 协作任务状态正确投影到 UI

---

## 12. 依赖关系图

```
Phase 1: Proto + Memory/Orchestration Subserver
    │
    ▼
Phase 2: Turn 闭环 + Memory 注入/提取 + Skill 路由
    │
    ├──► Phase 3: Collaboration Engine + Consensus + Budget
    │       │
    │       ▼
    │   Phase 4: Workspace + Growth
    │
    └──► Phase 5: UI Projection
            │
            └──► Phase 5-6/5-7: Desktop Rust commands
```

---

## 13. 验收总标准

1. **Proto**：`./model/build.sh` 通过
2. **Station**：`go test ./app/subserver/agent/...`、`go test ./app/subserver/memory/...`、`go test ./app/subserver/orchestration/...` 全部通过
3. **Desktop Rust**：`cargo check`、`cargo test` 通过
4. **Desktop Web**：`pnpm run check`、`pnpm run build` 通过
5. **端到端**：完整 Turn 流程通过，Memory 正确注入和提取，协作引擎正常工作

---

## 14. 影响面清单

| 层 | 影响 | 兼容策略 | 切换顺序 |
|----|------|---------|---------|
| **Station Subserver** | memory/orchestration 新增 | 新增独立 subserver | 先新增，再迁移 |
| **Proto** | memory/orchestration 新增 | 向后兼容 | 先定义，再生成 |
| **Desktop Rust** | memory/orchestration 新增 | 保留兼容层 | 逐步替换 stub |
| **Desktop Web** | store/runtimes/pages | 保留兼容 export | 逐步迁移 |
| **UI** | AgentProfile/MemoryPage/Activity | 渐进式替换 | 先功能，再体验 |

---

## 15. 关联文档

- [Agent Orchestration Architecture](../agent-orchestration-architecture.md)
- [Agent LobeHub Blueprint](../agent-lobehub-blueprint.md)
- [Agent Self-Growth Architecture](../agent-self-growth-architecture.md)
- [Agent Memory Architecture](../agent-memory-architecture.md)
- [Atelier Design](../../atelier/design.md)