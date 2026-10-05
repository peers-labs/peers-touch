# Agent 统一重构执行计划

> 基于 [Agent 统一架构路线图](../agent-unified-architecture-roadmap.md) 的完整执行路线
> 整合入口架构重构 + Workspace OSS + Config 拆解 + Agent 编排重构三大项目

---

## 1. 阶段总览

| 阶段 | 名称 | 对应原项目 | 预估规模 | 依赖 |
|------|------|-----------|---------|------|
| **Phase 0** | Proto 统一契约定义 | 三项目共有 | 中 | 无 |
| **Phase 0.5** | 入口架构骨架（模块化 + 事件总线） | 入口重构 | 中 | Phase 0 |
| **Phase 1** | 数据与同步底座（Workspace OSS + Config 拆解） | Workspace OSS 项目 Phase 1-2 | 大 | Phase 0.5 |
| **Phase 2** | SSE 事件系统 | Workspace OSS 项目 Phase 3 | 中 | Phase 1 |
| **Phase 2.5** | Agent Core 模块迁移（Agent/Memory/Skill/Turn） | 入口重构 | 大 | Phase 2 |
| **Phase 3** | Agent Core 能力增强（五层记忆 + Skill 路由 + Turn 闭环） | Orchestration 项目 Phase 1-2 | 大 | Phase 2.5 |
| **Phase 4** | 编排引擎（协作 + 共识 + 验收 + 预算） | Orchestration 项目 Phase 3 | 大 | Phase 3 |
| **Phase 5** | 离线操作队列 | Workspace OSS 项目 Phase 4 | 中 | Phase 2 |
| **Phase 6** | UI Projection + Desktop 入口重构 | Orchestration 项目 Phase 5 + 入口重构 | 中 | Phase 4 + Phase 5 |

---

## 2. Phase 0: Proto 统一契约定义

### 目标
一次性定义所有领域的 Proto 契约，避免后续阶段反复修改 Proto 导致生成工具链重复执行。

### 任务清单

#### 2.1 Workspace Proto
| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 workspace.proto | `model/domain/agent/workspace.proto` | Workspace、WorkspaceFile、WorkspaceChange 及 CRUD/上传/下载/commit API |

#### 2.2 Agent Config Proto
| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 agent_config.proto | `model/domain/agent/agent_config.proto` | AgentChatConfig、AgentModelParams、AgentKnowledgeBinding、AgentSkillBinding、AgentMcpBinding、AgentVoiceConfig、AgentToolProfile 及 API |

#### 2.3 Orchestration Proto
| 任务 | 文件 | 说明 |
|------|------|------|
| 新增 orchestration.proto | `model/domain/agent/orchestration.proto` | CollaborationTask、TaskNode、Vote、EvidenceRef、AcceptanceVerdict、Budget、CircuitBreakerState 及 API |

#### 2.4 Proto 更新
| 任务 | 文件 | 说明 |
|------|------|------|
| 更新 agent.proto | `model/domain/agent/agent.proto` | 添加 workspace_id 字段、完善 Agent 配置引用 |
| 更新 memory.proto | `model/domain/agent/memory.proto` | 对齐五层记忆模型字段 |
| 执行 Proto 生成 | `model/build.sh` | 生成 Go / TS / Rust 类型 |

### 验收标准
- [ ] 4 个 Proto 文件（workspace / agent_config / orchestration / 更新 agent / memory）编译通过
- [ ] `model/build.sh` 执行成功，Go/TS/Rust 生成文件正确
- [ ] 字段命名统一，类型一致，无冲突

---

## 2.5. Phase 0.5: 入口架构骨架

### 目标
建立模块化的 Agent Subserver 骨架和领域事件总线，为后续所有模块提供统一的装配基础设施。新模块（Workspace、Config、Orchestration）直接在新架构下开发。

### Station 层

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| AgentModule 接口定义 | `apps/station/app/subserver/agent/module.go` | 模块接口：Name/Init/Start/Stop/Handlers |
| 模块依赖上下文 | `apps/station/app/subserver/agent/module.go` | ModuleDeps：DB、EventBus、JWTWrapper、Config |
| 领域事件总线接口 | `apps/station/app/subserver/agent/domain/event.go` | EventBus 接口、DomainEvent 基类 |
| 事件总线实现 | `apps/station/app/subserver/agent/infrastructure/event/event_bus.go` | 内存事件总线实现（同步+异步） |
| 模块注册机制 | `apps/station/app/subserver/agent/agent.go` | 重构 agent.go，改为注册模块列表 |
| Migration 版本化管理 | `apps/station/app/subserver/agent/infrastructure/persistence/migrations/` | 版本化 SQL migration，替换 AutoMigrate |

### 验收标准
- [ ] AgentModule 接口定义清晰，可独立注册和启动
- [ ] 事件总线发布/订阅正常，至少 3 种事件类型验证通过
- [ ] 重构后的 agent.go 代码量减少 50%+（只做模块注册）
- [ ] 所有现有功能保持兼容（旧 API 全部正常工作）
- [ ] `go test ./...` 通过

---

## 3. Phase 1: 数据与同步底座

### 目标
实现 Workspace OSS 托管与 config_json 拆解，建立 Station 侧的结构化数据底座。

### 子阶段 1.1: Workspace OSS 托管

#### Station 层

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| GORM 模型 | `apps/station/app/subserver/agent/infrastructure/persistence/models.go` | AgentWorkspace、AgentWorkspaceFile |
| Repository | `apps/station/app/subserver/agent/infrastructure/persistence/workspace.go` | Workspace CRUD、文件清单、增量 diff 查询 |
| OSS 签名服务 | `apps/station/app/subserver/agent/infrastructure/oss/workspace_oss.go` | 上传/下载签名 URL 生成 |
| Domain Service | `apps/station/app/subserver/agent/domain/workspace_service.go` | 业务逻辑、幂等校验、变更提交 |
| Application Service | `apps/station/app/subserver/agent/service/workspace_service.go` | API 层适配（注：当前项目 service 目录即 application service） |
| Handler | `apps/station/app/subserver/agent/handler/workspace_handler.go` | HTTP handler |
| Router 注册 | `apps/station/app/subserver/agent/agent.go` | 注册 workspace 路由 |
| Migration | `apps/station/app/subserver/agent/infrastructure/persistence/migrations/` | 创建 agent_workspace、agent_workspace_file 表 |

#### Desktop 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| Workspace Store | `apps/desktop/src/store/workspace.ts` | Zustand store，管理 workspace 列表与文件 |
| Workspace Service | `apps/desktop/src/services/workspace-service.ts` | Station API 封装 + OSS 直传 |
| API 类型更新 | `apps/desktop/src/services/desktop_api.ts` | 添加 Workspace 相关类型 |

#### Mobile 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| Workspace Store | `apps/mobile/src/store/workspace.ts` | Zustand store |
| Workspace Service | `apps/mobile/src/services/workspace-service.ts` | Station API 封装 |

### 子阶段 1.2: config_json 拆解

#### Station 层

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| GORM 模型 | `apps/station/app/subserver/agent/infrastructure/persistence/models.go` | 7 张新表模型 |
| Repository | `apps/station/app/subserver/agent/infrastructure/persistence/agent_config.go` | 配置 CRUD |
| Domain Service | `apps/station/app/subserver/agent/domain/agent_config_service.go` | 配置业务逻辑 |
| Application Service | `apps/station/app/subserver/agent/service/agent_config_service.go` | API 层适配 |
| Handler | `apps/station/app/subserver/agent/handler/agent_config_handler.go` | HTTP handler |
| Router 注册 | `apps/station/app/subserver/agent/agent.go` | 注册配置路由 |
| Migration | `apps/station/app/subserver/agent/infrastructure/persistence/migrations/` | 创建 7 张新表 |
| 数据迁移脚本 | `apps/station/app/subserver/agent/infrastructure/persistence/migrations/` | 从 config_json 迁移到新表 |
| 并行写入 Hook | `apps/station/app/subserver/agent/infrastructure/persistence/` | 写入新表时同步更新 config_json |

#### Desktop 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| API 类型更新 | `apps/desktop/src/services/desktop_api.ts` | 添加配置相关类型 |
| Agent Store 更新 | `apps/desktop/src/store/agent.ts` | 支持细粒度配置更新 |
| Skill Store 更新 | `apps/desktop/src/store/skill.ts` | 支持 Agent-Skill 绑定 |
| MCP Store 更新 | `apps/desktop/src/store/mcp.ts` | 支持 Agent-MCP 绑定 |

#### Mobile 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| API 类型更新 | `apps/mobile/src/services/` | 添加配置相关类型 |
| Stores 更新 | `apps/mobile/src/store/` | 支持细粒度配置更新 |

### 验收标准
- [ ] Workspace CRUD API 功能正常
- [ ] OSS 签名 URL 生成正确，端侧可直传
- [ ] 变更提交幂等性验证通过
- [ ] 7 张配置表 Migration 执行成功
- [ ] 数据迁移脚本执行成功，数据正确
- [ ] 细粒度配置 API 功能正常
- [ ] `config_json` 并行写入验证通过

---

## 4. Phase 2: SSE 事件系统

### 目标
建立事件驱动的同步机制，实现 Workspace 和 Config 变更的实时推送。

### Station 层

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| 事件类型定义 | `apps/station/app/subserver/agent/domain/events.go` | workspace.*, agent.config.*, agent.knowledge.*, agent.skill.*, agent.mcp.* |
| 事件发布器 | `apps/station/app/subserver/agent/infrastructure/event/event_publisher.go` | 发布到 SSE 通道 |
| SSE Handler | `apps/station/app/subserver/agent/handler/sse_handler.go` | 订阅 agent 领域事件 |
| Workspace 事件接入 | `apps/station/app/subserver/agent/domain/workspace_service.go` | 变更提交时发布事件 |
| Config 事件接入 | `apps/station/app/subserver/agent/domain/agent_config_service.go` | 配置变更时发布事件 |

### Desktop 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| SSE 客户端 | `apps/desktop/src/services/sse-client.ts` | 连接 Station SSE |
| 事件处理器 | `apps/desktop/src/runtimes/eventHandler.ts` | 处理 agent.* 事件 |
| Stores 响应更新 | `apps/desktop/src/store/` | agent / workspace / skill / mcp store 响应事件 |

### Mobile 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| SSE 客户端 | `apps/mobile/src/services/sse-client.ts` | 连接 Station SSE |
| 事件处理器 | `apps/mobile/src/runtimes/eventHandler.ts` | 处理 agent.* 事件 |

### 验收标准
- [ ] Workspace 变更事件正确触发
- [ ] 配置变更事件正确触发
- [ ] 端侧 SSE 连接稳定，自动重连
- [ ] 事件去重机制生效
- [ ] 端侧状态实时更新（< 2s 延迟）

---

## 4.5. Phase 2.5: Agent Core 模块迁移

### 目标
将现有的 Agent、Memory、Skill、Turn 四大核心模块从旧架构（平铺 service/handler 目录）迁移到新的模块化 DDD 架构，为后续能力增强打好结构基础。

### 迁移策略
采用**绞杀者模式**：每个模块独立迁移，迁移期间旧 handler 代理转发到新模块，验证通过后删除旧代码。

### 子阶段 2.5.1: Agent 管理模块迁移

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| 新建 module/agent 目录结构 | `apps/station/app/subserver/agent/module/agent/` | domain / application / infrastructure / interface 四层 |
| 迁移领域模型 | `module/agent/domain/` | Agent 实体、领域服务接口 |
| 迁移 Repository 实现 | `module/agent/infrastructure/persistence/` | GORM Repository |
| 迁移应用服务 | `module/agent/application/` | Agent CRUD 用例编排 |
| 迁移 HTTP Handler | `module/agent/interface/http/` | REST handler |
| 注册模块 | `apps/station/app/subserver/agent/agent.go` | 添加 AgentModule 到模块列表 |
| 旧 handler 代理转发 | `handler/agent_handler.go` | 临时代理，确保兼容 |
| 删除旧代码 | `service/agent_service.go` + `handler/agent_handler.go` | 验证通过后删除 |

### 子阶段 2.5.2: Memory 模块迁移

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| 新建 module/memory 目录结构 | `apps/station/app/subserver/agent/module/memory/` | 四层架构 |
| 迁移 Memory 领域逻辑 | `module/memory/domain/` | MemoryItem、MemoryService 接口 |
| 迁移持久化实现 | `module/memory/infrastructure/` | GORM Repository + Embedding |
| 迁移应用服务 | `module/memory/application/` | CRUD + 检索 + 注入/提取 |
| 迁移 HTTP Handler | `module/memory/interface/http/` | Memory API |
| 接入事件总线 | `module/memory/` | 发布 memory.created / memory.updated 事件 |
| 删除旧代码 | `service/memory_service.go` + `handler/memory_handler.go` | 验证通过后删除 |

### 子阶段 2.5.3: Skill 模块迁移

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| 新建 module/skill 目录结构 | `apps/station/app/subserver/agent/module/skill/` | 四层架构 |
| 迁移 Skill 领域逻辑 | `module/skill/domain/` | Skill、SkillVersion、trust 体系 |
| 迁移持久化实现 | `module/skill/infrastructure/` | GORM Repository |
| 迁移应用服务 | `module/skill/application/` | CRUD + import + trust scan |
| 迁移 HTTP Handler | `module/skill/interface/http/` | Skill API |
| 接入事件总线 | `module/skill/` | 发布 skill.installed / skill.updated 事件 |
| 删除旧代码 | `service/skill_service.go` + `handler/skill_handler.go` | 验证通过后删除 |

### 子阶段 2.5.4: Turn 模块迁移

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| 新建 module/turn 目录结构 | `apps/station/app/subserver/agent/module/turn/` | 四层架构 |
| 迁移 Turn 领域逻辑 | `module/turn/domain/` | Turn、TurnTrace、tool loop 规则 |
| 迁移持久化实现 | `module/turn/infrastructure/` | GORM Repository |
| 迁移应用服务 | `module/turn/application/` | Turn 执行编排、stream、错误恢复 |
| 迁移 HTTP Handler | `module/turn/interface/http/` | Turn API + SSE stream |
| 接入事件总线 | `module/turn/` | 发布 turn.started / turn.completed / turn.failed 事件 |
| 删除旧代码 | `service/turn_service.go` + `handler/turn_handler.go` | 验证通过后删除 |

### 验收标准
- [ ] 4 个核心模块全部迁移到 module/ 新架构
- [ ] 所有旧 API 接口保持兼容（请求/响应格式不变）
- [ ] 领域事件正确发布，至少 10 种事件类型验证通过
- [ ] `agent.go` 代码量减少 70%+（只剩模块注册）
- [ ] `go test ./...` 全部通过
- [ ] 性能无下降（Turn 执行耗时波动 < 5%）

---

## 5. Phase 3: Agent Core 增强

### 目标
完善 Memory 五层模型、Skill 路由体系、Turn 执行闭环，为编排引擎打好基础。

### 子阶段 3.1: Memory 系统完善

#### Station 层

| 任务 | 说明 |
|------|------|
| Memory 五层模型落地 | Identity / Preference / Context / Experience / Activity |
| Memory 注入/提取 | Turn 开始时注入，结束时提取新记忆 |
| Memory 检索增强 | 向量 + 关键词 + 时间衰减混合检索 |
| Persona 系统 | 基于 Identity + Preference 生成 Agent Persona |

### 子阶段 3.2: Skill 路由与 Trust 体系

#### Station 层

| 任务 | 说明 |
|------|------|
| Skill trust scan 完善 | 导入时安全扫描、trust level 评定 |
| Skill 路由 | 按 trust level 和领域匹配路由 Skill |
| Skill 版本管理 | 版本追踪、回滚能力 |

### 子阶段 3.3: Turn 闭环增强

#### Station 层

| 任务 | 说明 |
|------|------|
| Context Assembly | Memory + Skill + Knowledge + Config 统一组装 |
| Review 环节 | Turn 结束后质量审查、错误分类、记忆提取 |
| Config 新表接入 | Turn 执行从新表读取配置，不再依赖 config_json |

### 验收标准
- [ ] Memory 五层模型完整，检索召回率达标
- [ ] Skill trust 体系正常，路由正确
- [ ] Turn 闭环完整：Context Assembly → Execution → Review → Growth
- [ ] Config 新表接入 Turn 执行，config_json 仅作兼容

---

## 6. Phase 4: 编排引擎

### 目标
实现多 Agent 协作引擎、共识收敛、验收判定、预算熔断。

### Station 层

| 任务 | 说明 |
|------|------|
| Orchestration Subserver 骨架 | 新建 orchestration subserver 或集成到 agent subserver |
| 协作引擎（Expert Hierarchy） | 默认模式：Goal Owner → Planner → Executor → Verifier |
| 任务分解与调度 | 将复杂任务拆分为子任务，分配给对应角色 |
| 共识收敛机制 | 投票、证据引用、终裁者签字 |
| 验收判定系统 | L0 二值判定 / L1 规则判定 / L2 人工判定 |
| 预算与熔断 | Token/Money/Time 三维预算、熔断检测、Resume 恢复 |

### 验收标准
- [ ] Expert Hierarchy 模式可正常执行协作任务
- [ ] 共识机制正确：终裁者签字 + 无未决反对 = reached
- [ ] L0/L1 验收可自动判定，L2 转人工
- [ ] 预算熔断触发正确，Resume 可从断点恢复

---

## 7. Phase 5: 离线操作队列

### 目标
实现端侧离线操作的本地队列、重连回放、冲突处理。

### Desktop 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| OfflineOperation 存储 | `apps/desktop/src/runtimes/offlineQueue.ts` | IndexedDB 存储离线操作 |
| 回放引擎 | `apps/desktop/src/runtimes/offlineQueue.ts` | FIFO 回放 + 幂等校验 |
| 冲突处理 UI | `apps/desktop/src/components/offlineConflictDialog.tsx` | 冲突提示与用户选择 |

### Mobile 端

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| OfflineOperation 存储 | `apps/mobile/src/runtimes/offlineQueue.ts` | SQLite 存储 |
| 回放引擎 | `apps/mobile/src/runtimes/offlineQueue.ts` | FIFO 回放 + 幂等校验 |

### 验收标准
- [ ] 离线操作正确入队（断网期间所有操作都被捕获）
- [ ] 重连后自动回放，顺序正确
- [ ] 幂等性验证通过（重复回放不产生脏数据）
- [ ] 冲突处理 UI 正常显示，用户选择后状态一致

---

## 8. Phase 6: UI Projection + Desktop 入口重构

### 目标
完成所有 UI 页面重构，同时完成 Desktop 端的入口架构重构（Runtime 拆分 + Store 拆分 + Service 门面）。

### 子阶段 6.1: Desktop 端入口重构

| 任务 | 文件路径 | 说明 |
|------|---------|------|
| Runtime 拆分 | `apps/desktop/src/runtimes/` | 拆分为 agentRuntime / agentMemoryRuntime / agentWorkspaceRuntime / agentGrowthRuntime |
| Store 拆分 | `apps/desktop/src/store/` | 拆分为 agentConfig / agentSkill / agentMcp / agentMemory / agentWorkspace / agentGrowth |
| AgentService 门面 | `apps/desktop/src/services/agent-service.ts` | 统一 Agent 领域入口，内部路由到各子 service |
| SSE 事件接入 | `apps/desktop/src/runtimes/` | 各 runtime 监听对应 SSE 事件，自动更新状态 |
| 兼容层 | `apps/desktop/src/store/agent.ts` | 保留旧 selector，逐步迁移组件 |

### 子阶段 6.2: UI Projection

#### Desktop 端

| 任务 | 说明 |
|------|------|
| Agent Profile 页面重构 | 展示 Agent 身份、配置、技能、MCP 的细粒度管理 |
| Memory 可视化 | 五层记忆浏览、搜索、手动管理 |
| Workspace 同步视图 | 文件浏览、同步状态、冲突解决 |
| Growth Dashboard | 成长度量、质量趋势、反馈统计、Growth Score |
| 协作任务视图 | 展示协作进度、角色分工、投票结果 |

#### Mobile 端

| 任务 | 说明 |
|------|------|
| Agent 设置页适配 | 适配新的细粒度配置 API |
| Workspace 基础视图 | 文件列表、同步状态 |

### 验收标准
- [ ] Desktop Runtime 拆分为 4+ 个领域 Runtime
- [ ] Desktop Store 拆分为 6+ 个独立 Store
- [ ] AgentService 门面统一入口，外部调用不再直接调子 service
- [ ] Agent Profile 页面功能完整，配置修改实时生效
- [ ] Memory 页面可浏览和搜索记忆
- [ ] Workspace 页面展示同步状态，可手动触发同步
- [ ] Growth 页面展示质量趋势和评分
- [ ] 所有用户-facing 文本走 i18n

---

## 9. 依赖关系总结

```
Phase 0 (Proto)
    │
    ▼
Phase 0.5 (入口架构骨架)
    │
    ▼
Phase 1 (数据底座) ────────────┐
    │                           │
    ▼                           │
Phase 2 (SSE 事件)              │
    │                           │
    ▼                           │
Phase 2.5 (Core 模块迁移)       │
    │                           │
    ▼                           │
Phase 3 (Agent Core 增强)       │
    │                           │
    ▼                           ▼
Phase 4 (编排引擎)        Phase 5 (离线队列)
    │                           │
    └─────────────┬─────────────┘
                  ▼
      Phase 6 (UI + Desktop 入口重构)
```

**关键路径**：Phase 0 → 0.5 → 1 → 2 → 2.5 → 3 → 4 → 6
**并行路径**：Phase 5 可与 Phase 2.5/3/4 并行开发（仅依赖 Phase 2）

---

## 10. 总体验收标准

### 功能完备性
- [ ] Workspace OSS 托管：创建、上传、下载、同步、删除
- [ ] Config 拆解：7 张表全部可用，细粒度 API 正常
- [ ] SSE 事件：所有领域事件正确触发与消费
- [ ] Memory 系统：五层模型、注入/提取、检索
- [ ] 编排引擎：Expert Hierarchy 模式、共识、验收、预算
- [ ] 离线队列：入队、回放、幂等、冲突处理
- [ ] Station 入口：模块化架构、事件总线、DDD 分层
- [ ] Desktop 入口：Runtime 拆分、Store 拆分、Service 门面
- [ ] UI：所有页面功能完整

### 质量标准
- [ ] Station: `gofmt -l .` 通过，`go test ./...` 通过
- [ ] Desktop: `pnpm run check && pnpm run test && pnpm run build` 通过
- [ ] 无 console.log / println! / fmt.Println
- [ ] 所有用户-facing 文本走 i18n
- [ ] 无硬编码 secrets

---

## 11. 参考文档

- [Agent 统一架构路线图](../agent-unified-architecture-roadmap.md) — 总览
- [Agent Workspace OSS Architecture](../agent-workspace-oss-architecture.md) — Workspace 详细设计
- [Agent Orchestration Architecture](../agent-orchestration-architecture.md) — 编排引擎详细设计
- [Agent Memory Architecture](../agent-memory-architecture.md) — Memory 详细设计
- [原 Workspace OSS 执行计划](./20260626-workspace-oss-config-refactor.md) — 原始四阶段计划
- [原 Agent 编排执行计划](./20260626-agent-orchestration-rebuild.md) — 原始五阶段计划
