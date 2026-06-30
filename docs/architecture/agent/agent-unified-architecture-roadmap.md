# Agent 统一架构路线图

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-06-26
> **Owner**: Peers-Touch Agent Team

---

## 1. 路线图总览

本文档整合 Agent 领域三大重构项目，形成统一的架构愿景与执行路线：

| 项目 | 架构文档 | 执行计划 | 核心交付 |
|------|---------|---------|---------|
| **入口架构重构** | [agent-entry-architecture-rebuild.md](./agent-entry-architecture-rebuild.md) | 见统一执行计划 Phase 0.5 + 1.5 | Station 模块化 + Desktop Runtime 拆分 + 事件总线 |
| **Workspace OSS + Config 拆解** | [agent-workspace-oss-architecture.md](./agent-workspace-oss-architecture.md) | [workspace-oss-config-refactor](./execution-plans/20260626-workspace-oss-config-refactor.md) | Workspace OSS 托管、config_json 拆解、SSE 事件、离线队列 |
| **Agent 编排重构** | [agent-orchestration-architecture.md](./agent-orchestration-architecture.md) | [agent-orchestration-rebuild](./execution-plans/20260626-agent-orchestration-rebuild.md) | Turn 闭环、Memory 系统、协作引擎、Growth、UI Projection |

**三者关系**：入口架构重构是**地基**，为所有能力提供模块化骨架；Workspace OSS + Config 拆解是**数据底座**，提供持久化与同步能力；Agent 编排重构是**能力层**，在底座之上实现智能执行与协作。

---

## 2. 统一领域边界

```
┌─────────────────────────────────────────────────────────────────────┐
│                        UI Projection Layer                          │
│  Agent Profile │ Memory View │ Workspace View │ Growth Dashboard   │
└───────────────────────────────▲─────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────┐
│                       Orchestration Layer                           │
│  Collaboration Engine │ Consensus │ Acceptance │ Budget & Circuit  │
└───────────────────────────────▲─────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────┐
│                         Agent Core Layer                            │
│  Turn Orchestration │ Memory │ Skill │ Tool Registry │ Delegation  │
└───────────────────────────────▲─────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────┐
│                    Data & Synchronization Layer                     │
│  Workspace OSS │ Structured Config │ SSE Events │ Offline Queue    │
└─────────────────────────────────────────────────────────────────────┘
```

### 领域责任总表

| 层级 | 领域 | 职责 | 核心产出 |
|------|------|------|---------|
| **UI Projection** | Agent Profile | Agent 身份、配置、技能的可视化 | Profile 页面、Settings Drawer |
| | Memory View | 记忆浏览、搜索、管理 | Memory 页面、检索 UI |
| | Workspace View | 工作空间文件浏览、同步状态 | Workspace 标签页、同步指示器 |
| | Growth Dashboard | 成长度量、质量趋势、反馈统计 | Growth 标签页、质量评分卡 |
| **Orchestration** | Collaboration Engine | 多 Agent 协作、任务分解、六引擎 | CollaborationTask、任务树 |
| | Consensus | 投票、证据引用、终裁者 | Vote、EvidenceRef、Decision |
| | Acceptance | 验收判定、L0/L1/L2 分级 | AcceptanceCriteria、Verdict |
| | Budget & Circuit | Token/Money/Time 预算、熔断恢复 | Budget、CircuitBreakerState |
| **Agent Core** | Turn Orchestration | Turn 执行闭环、tool loop、错误恢复 | Turn、TurnTrace、ToolCallRecord |
| | Memory | 五层记忆、检索、注入、提取 | MemoryItem、MemorySnapshot |
| | Skill | Skill CRUD、trust scan、版本管理 | Skill、SkillVersion |
| | Tool Registry | 工具注册、MCP 管理、builtin tools | ToolDefinition、McpServer |
| | Delegation | 任务委派、子 Agent 调用 | DelegationTask、DelegationResult |
| **Data & Sync** | Workspace OSS | 工作空间 OSS 托管、文件同步 | Workspace、WorkspaceFile、WorkspaceChange |
| | Structured Config | 配置拆解、细粒度 API | AgentChatConfig、AgentModelParams 等 |
| | SSE Events | 事件驱动同步、实时推送 | Event、SSE Stream |
| | Offline Queue | 离线操作、回放、冲突处理 | OfflineOperation、ReplayEngine |

---

## 3. 数据模型依赖关系

```
Agent (agent.proto)
  │
  ├── AgentChatConfig        (agent_config.proto)  ── 聊天配置
  ├── AgentModelParams       (agent_config.proto)  ── 模型参数
  ├── AgentKnowledgeBinding  (agent_config.proto)  ── 知识绑定
  ├── AgentSkillBinding      (agent_config.proto)  ── Skill 绑定
  ├── AgentMcpBinding        (agent_config.proto)  ── MCP 绑定
  ├── AgentVoiceConfig       (agent_config.proto)  ── 语音配置
  ├── AgentToolProfile       (agent_config.proto)  ── 工具配置
  │
  ├── Workspace              (workspace.proto)     ── 工作空间
  │    └── WorkspaceFile                          ── 文件元数据
  │
  ├── Memory                 (memory.proto)        ── 五层记忆
  ├── Skill                  (skill.proto)         ── Skill 定义
  ├── Turn                   (agent.proto)         ── Turn 记录
  │    └── TurnTrace                              ── 执行轨迹
  │
  └── GrowthSnapshot         (agent.proto)         ── 成长快照
```

---

## 4. 执行依赖图

```
Phase 0:  Proto 定义（所有领域）
   │
   ├── workspace.proto
   ├── agent_config.proto
   ├── orchestration.proto (待定义)
   └── 更新 agent.proto / memory.proto / skill.proto
   │
   ▼
Phase 1:  数据与同步底座
   │
   ├── Station: Workspace GORM + Repository + Service + Handler
   ├── Station: Config GORM + Repository + Service + Handler
   ├── Station: OSS 签名服务
   ├── Station: Migration + 数据迁移脚本
   └── 端侧: Workspace Store + Service
   │
   ▼
Phase 2:  SSE 事件系统
   │
   ├── Station: 事件定义 + 发布器 + SSE Handler
   ├── 端侧: SSE 客户端 + 事件处理器
   └── Workspace & Config 事件接入
   │
   ▼
Phase 3:  Agent Core 增强
   │
   ├── Memory Subserver 完善（五层模型）
   ├── Skill 路由与 trust 体系
   ├── Turn 闭环增强（context assembly → review）
   └── Config 新表接入 Turn 执行
   │
   ▼
Phase 4:  编排引擎
   │
   ├── Orchestration Subserver
   ├── 协作引擎（Expert Hierarchy 优先）
   ├── 共识收敛机制
   ├── 验收判定（L0/L1/L2）
   └── 预算与熔断
   │
   ▼
Phase 5:  离线操作队列
   │
   ├── 端侧: OfflineOperation 存储
   ├── 端侧: 回放引擎（FIFO + 幂等）
   ├── 端侧: 冲突处理 UI
   └── Station: 幂等性保障完善
   │
   ▼
Phase 6:  UI Projection
   │
   ├── Agent Profile 页面重构
   ├── Memory 可视化
   ├── Workspace 同步视图
   └── Growth Dashboard
```

---

## 5. 阶段验收总标准

| 阶段 | 必须满足 | 验证方式 |
|------|---------|---------|
| **Phase 0: Proto** | 所有 message 定义完整、API 契约清晰、字段命名一致 | `model/build.sh` 编译通过 |
| **Phase 1: 数据底座** | Workspace CRUD 正常、OSS 签名正确、配置 API 可用、数据迁移成功 | Station 集成测试 + Migration 验证 |
| **Phase 2: SSE** | 事件正确触发、端侧实时响应、连接稳定无泄漏 | SSE 压力测试 + 端到端同步验证 |
| **Phase 3: Agent Core** | Memory 注入/提取正常、Skill 路由正确、Turn Trace 完整 | Turn 执行测试 + Memory 检索测试 |
| **Phase 4: 编排引擎** | Expert Hierarchy 模式可用、共识机制正确、预算熔断生效 | 协作任务测试 + 预算熔断测试 |
| **Phase 5: 离线队列** | 离线操作入队、重连回放、幂等性通过、冲突 UI 正常 | 离线场景测试 + 冲突模拟 |
| **Phase 6: UI** | 所有页面功能完整、交互流畅、状态实时同步 | 人工验收 + E2E 测试 |

---

## 6. 设计原则（全项目统一）

1. **Proto-First** — 所有数据模型先在 `model/domain/*.proto` 定义
2. **Station 为唯一真源** — 跨端数据由 Station 持久化，端侧仅缓存
3. **事件驱动同步** — 状态变更通过 SSE 事件推送，避免轮询
4. **增量优先** — 同步优先增量，全量仅用于首次加载
5. **幂等性保障** — 所有写操作支持 `client_request_id` 幂等
6. **向后兼容** — 迁移期间新旧 API 并存，逐步切换
7. **无调试语句** — 禁止 `console.log` / `println!` / `fmt.Println`
8. **i18n 优先** — 所有用户-facing 文本走 locale 系统

---

## 7. 风险与依赖

### 外部依赖

| 依赖 | 影响范围 | 风险等级 | 说明 |
|------|---------|---------|------|
| OSS 服务可用性 | Phase 1 Workspace | 中 | 需支持签名 URL，与现有 OSS 子服务对齐 |
| SSE 连接稳定性 | Phase 2, 3, 4 | 中 | 移动端弱网环境需重连机制 |
| Proto 生成工具链 | Phase 0 | 低 | 需确保 Go/TS/Rust 生成器版本一致 |

### 技术风险

| 风险 | 缓解措施 |
|------|---------|
| config_json 迁移数据不一致 | 并行写入 + 数据校验脚本 + 灰度切换 |
| Workspace 大文件同步性能差 | 分片上传 + 断点续传 + 增量 diff |
| SSE 事件丢失 | 事件序号 + 重连补拉 + 去重机制 |
| 离线冲突处理复杂 | Phase 5 仅实现基础 FIFO 回放，高级策略后续迭代 |

---

## 8. 参考文档

- [Agent Orchestration Architecture](./agent-orchestration-architecture.md) — 编排层架构
- [Agent Workspace OSS Architecture](./agent-workspace-oss-architecture.md) — 数据与同步层架构
- [Agent Memory Architecture](./agent-memory-architecture.md) — Memory 系统架构
- [Agent Self-Growth Architecture](./agent-self-growth-architecture.md) — 自成长架构
- [Station/Desktop 边界](../boundaries/station-desktop-scope-boundary.md) — 职责边界
- [多端同步协议](../../client/mobile/sync-protocol.md) — 同步协议规范
