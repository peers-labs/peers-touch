# Agent 入口架构重构设计

> **Status**: draft
> **Version**: v1.0
> **Created**: 2026-06-26
> **Owner**: Peers-Touch Agent Team
> **Module**: `apps/station/app/subserver/agent/`, `apps/desktop/src/`

---

## 1. 背景与问题

### 1.1 Station 端问题

当前 `agent.go` 作为 Agent Subserver 的入口，存在以下问题：

| 问题 | 表现 | 影响 |
|------|------|------|
| **上帝文件** | `Handlers()` 方法里手工 new 了 15+ 个 service，200+ 行装配代码 | 新增功能必须改入口文件，易冲突，可读性差 |
| **分层模糊** | `service/` 目录同时包含 domain service 和 application service | 职责不清，依赖混乱 |
| **硬编码依赖** | service 之间直接构造依赖，无法替换或 mock | 难以测试，难以扩展 |
| **无模块边界** | 所有 handler 平铺，没有按领域分组 | 新成员难以快速定位代码 |
| **无事件总线** | service 之间直接调用，耦合紧密 | 无法做事件驱动，难以解耦 |
| **Migration 混杂** | AutoMigrate 在 Init 里调用，所有模型混在一起 | 版本管理困难，回滚难 |

### 1.2 Desktop 端问题

| 问题 | 表现 | 影响 |
|------|------|------|
| **Runtime 过少** | 只有 `agentCapabilityRuntime` 和 `agentTopicRuntime` 两个 runtime | 所有能力挤在一个 runtime，职责不清 |
| **Store 肥大** | `agentStore` 同时管模型、Agent、Applets、配置 | 单 store 过大，重渲染范围广 |
| **入口分散** | 没有统一的 Agent 门面，各页面直接调各 service | 难以统一错误处理、缓存、权限校验 |
| **无生命周期** | 缺少 Agent 维度的 bootstrap/reconcile/teardown | 状态同步不可靠 |

---

## 2. 重构目标

1. **模块化装配**：按领域拆分模块，每个模块自包含（service + handler + repository）
2. **DDD 分层清晰**：明确 domain / application / infrastructure / interface 四层职责
3. **依赖注入**：通过构造函数注入，支持测试替换
4. **事件驱动**：领域事件总线，模块间通过事件通信而非直接调用
5. **可观测**：每个模块有明确的启动/停止/健康检查
6. **向后兼容**：重构期间保持 API 接口不变，逐步迁移

---

## 3. Station 端重构设计

### 3.1 目标架构图

```
agent subserver
├── agent.go                      # Subserver 入口（薄，只做模块注册）
├── options.go                    # 配置选项
├── plugin.go                     # 插件注册
│
├── module/                       # 按领域拆分的模块（新增目录）
│   ├── agent/                    # Agent 管理模块
│   │   ├── module.go             # 模块定义（注册 handler、service、repo）
│   │   ├── domain/               # 领域对象 + 领域服务
│   │   ├── application/          # 应用服务（用例编排）
│   │   ├── infrastructure/       # 持久化、外部服务
│   │   └── interface/            # HTTP handler
│   ├── turn/                     # Turn 执行模块
│   ├── memory/                   # Memory 模块
│   ├── skill/                    # Skill 模块
│   ├── workspace/                # Workspace 模块
│   ├── config/                   # Agent 配置模块
│   ├── orchestration/            # 编排模块
│   ├── growth/                   # Growth 模块
│   └── sse/                      # SSE 事件模块
│
├── domain/                       # 共享领域原语（保留现有，逐步迁移到各模块）
│   ├── error.go
│   └── event.go                  # 领域事件定义 + 事件总线接口
│
├── infrastructure/               # 共享基础设施（保留现有，逐步迁移）
│   ├── persistence/
│   ├── event/                    # 事件总线实现
│   └── oss/
│
├── handler/                      # 现有 handler（保留，逐步迁移到 module/）
├── service/                      # 现有 service（保留，逐步迁移到 module/）
└── model/                        # Proto 生成的模型
```

### 3.2 模块定义

每个模块实现 `AgentModule` 接口：

```go
type AgentModule interface {
    Name() string
    Init(ctx context.Context, deps ModuleDeps) error
    Start(ctx context.Context) error
    Stop(ctx context.Context) error
    Handlers() []server.Handler
}

type ModuleDeps struct {
    DB          *gorm.DB
    EventBus    EventBus
    JWTWrapper  server.Wrapper
    LogIDWrapper server.Wrapper
    Config      *ModuleConfig
}
```

### 3.3 DDD 分层职责

| 层 | 职责 | 放什么 | 不放什么 |
|----|------|--------|---------|
| **domain** | 领域对象、领域规则、领域服务接口 | Entity、Value Object、Domain Service Interface、Domain Event | 具体实现、数据库查询、HTTP |
| **application** | 用例编排、事务边界、DTO 转换 | Application Service、DTO、Command/Query | 领域规则、基础设施细节 |
| **infrastructure** | 技术实现、外部系统对接 | Repository 实现、外部 API 客户端、事件总线实现、OSS 客户端 | 业务逻辑 |
| **interface** | 对外接口适配 | HTTP Handler、gRPC Handler、SSE Handler | 业务逻辑、领域规则 |

### 3.4 领域事件总线

```go
// 事件总线接口
type EventBus interface {
    Publish(ctx context.Context, event DomainEvent) error
    Subscribe(eventType string, handler EventHandler)
}

// 领域事件基类
type DomainEvent struct {
    EventID   string
    EventType string
    OccurredAt time.Time
    ActorID   string
    Payload   interface{}
}
```

**事件清单（初期）**：
- `agent.created` / `agent.updated` / `agent.deleted`
- `agent.config.updated`
- `agent.workspace.created` / `agent.workspace.changed`
- `agent.memory.created` / `agent.memory.updated`
- `agent.skill.installed` / `agent.skill.updated`
- `agent.turn.started` / `agent.turn.completed` / `agent.turn.failed`
- `agent.growth.feedback_received`

### 3.5 Migration 管理

```
infrastructure/persistence/migrations/
├── 001_initial_schema.sql
├── 002_add_agent_visibility.sql
├── 003_add_workspace_tables.sql
├── 004_add_config_tables.sql
└── ...
```

使用版本化 migration，每个模块的 migration 独立编号，按时间顺序执行。

### 3.6 迁移策略

采用**绞杀者模式**逐步迁移：

| 阶段 | 内容 | 新旧共存 |
|------|------|---------|
| 1 | 新建 module 目录骨架，引入事件总线 | 是 |
| 2 | 迁移 Agent 管理模块到新架构 | 是，handler 代理转发 |
| 3 | 迁移 Memory 模块 | 是 |
| 4 | 迁移 Skill 模块 | 是 |
| 5 | 迁移 Turn 模块 | 是 |
| 6 | 迁移剩余模块 | 是 |
| 7 | 删除旧的 service/ 和 handler/ 目录 | 否 |

---

## 4. Desktop 端重构设计

### 4.1 目标架构图

```
src/
├── runtimes/
│   ├── agentRuntime.ts           # Agent 主 Runtime（bootstrap + reconcile）
│   ├── agentCapabilityRuntime.ts # 保留，拆分功能出去
│   ├── agentMemoryRuntime.ts     # Memory 同步 Runtime
│   ├── agentWorkspaceRuntime.ts  # Workspace 同步 Runtime
│   └── agentGrowthRuntime.ts     # Growth 数据 Runtime
│
├── store/
│   ├── agent.ts                  # Agent 基础信息 + 选中状态
│   ├── agentConfig.ts            # Agent 配置（拆分自 agent.ts）
│   ├── agentSkill.ts             # Skill 绑定状态
│   ├── agentMcp.ts               # MCP 绑定状态
│   ├── agentMemory.ts            # Memory 状态
│   ├── agentWorkspace.ts         # Workspace 状态
│   └── agentGrowth.ts            # Growth 状态
│
├── services/
│   ├── agent-service.ts          # Agent API 门面（统一入口）
│   ├── agent-config-service.ts   # 配置 API
│   ├── agent-memory-service.ts   # Memory API
│   ├── agent-workspace-service.ts # Workspace API
│   └── agent-growth-service.ts   # Growth API
│
└── modules/
    └── agent/                    # Agent 领域模块
        ├── index.ts              # 模块入口
        ├── types.ts              # 类型定义
        └── hooks.ts              # 通用 hooks
```

### 4.2 Runtime 分层

遵循 [runtime-projections](../../../client/desktop/runtime-projections.md) 的 Page / Runtime / Boot 合约：

| Runtime | 作用域 | bootstrap 做什么 | reconcile 触发时机 |
|---------|--------|-----------------|-------------------|
| **agentRuntime** | app | 加载当前 Agent、默认配置 | Agent 切换、登录态变化 |
| **agentMemoryRuntime** | agent | 加载 Memory 摘要、监听 SSE | Memory 事件、Agent 切换 |
| **agentWorkspaceRuntime** | agent | 加载 Workspace 列表、同步状态 | Workspace 事件、Agent 切换 |
| **agentGrowthRuntime** | agent | 加载 Growth 快照 | Feedback 事件、定时刷新 |

### 4.3 Store 拆分原则

每个 Store 遵循：
- **单一职责**：一个 store 只管一个领域的状态
- **可选择订阅**：组件只订阅需要的状态，避免不必要重渲染
- **标准化错误**：所有 store 继承 `RevalidationState`
- **动作命名**：`loadXxx` / `updateXxx` / `deleteXxx`

### 4.4 Service 门面

`agent-service.ts` 作为 Agent 领域的统一门面：

```typescript
// 门面模式：对外提供统一入口，内部路由到各子 service
export class AgentService {
  // Agent 基础 CRUD
  listAgents(): Promise<Agent[]>
  getAgent(id: string): Promise<Agent>
  createAgent(data: CreateAgentData): Promise<Agent>
  updateAgent(id: string, data: UpdateAgentData): Promise<Agent>
  deleteAgent(id: string): Promise<void>
  
  // 配置（转发给 config service）
  getChatConfig(agentId: string): Promise<AgentChatConfig>
  updateChatConfig(agentId: string, config: Partial<AgentChatConfig>): Promise<AgentChatConfig>
  getModelParams(agentId: string): Promise<AgentModelParams>
  updateModelParams(agentId: string, params: Partial<AgentModelParams>): Promise<AgentModelParams>
  
  // Skill 绑定（转发给 skill service）
  listSkillBindings(agentId: string): Promise<AgentSkillBinding[]>
  bindSkill(agentId: string, skillId: string): Promise<AgentSkillBinding>
  unbindSkill(agentId: string, skillId: string): Promise<void>
  
  // ... 其他子领域
}
```

---

## 5. 与其他重构项目的关系

### 5.1 Workspace OSS + Config 拆解

- **入口重构是基础**：Workspace 和 Config 模块直接在新架构下开发，不走旧架构
- **收益**：新模块从一开始就有清晰的分层和事件驱动

### 5.2 Agent 编排重构

- **编排模块在新架构下实现**：Orchestration Module 直接用新架构
- **事件驱动**：编排引擎通过事件总线监听其他模块的状态变化

---

## 6. 验收标准

### Station 端
- [ ] AgentModule 接口定义清晰，模块可独立注册和启动
- [ ] 至少 3 个核心模块（Agent、Memory、Skill）迁移到新架构
- [ ] 事件总线正常工作，至少 5 种领域事件正确发布和订阅
- [ ] 所有旧 API 接口保持兼容（测试用例全部通过）
- [ ] `go test ./...` 通过
- [ ] `gofmt -l .` 无输出

### Desktop 端
- [ ] Agent Store 拆分为 4+ 个独立 store
- [ ] 新增 3+ 个领域 Runtime（Memory、Workspace、Growth）
- [ ] AgentService 门面统一入口，外部调用不再直接调子 service
- [ ] `pnpm run check && pnpm run test && pnpm run build` 通过
- [ ] 无 console.log，所有用户-facing 文本走 i18n

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 迁移期间新旧代码共存导致混乱 | 中 | 明确迁移路线图，每个模块迁移独立 PR |
| 事件总线引入新的复杂度 | 中 | 初期只做关键事件，逐步扩展 |
| Store 拆分导致页面改动大 | 中 | 提供兼容的 selector，逐步迁移组件 |
| 向后兼容破坏 | 高 | 所有旧 API 先保留代理，验证通过后再删 |

---

## 8. 参考文档

- [Agent 统一架构路线图](./agent-unified-architecture-roadmap.md)
- [Runtime Projections](../../../client/desktop/runtime-projections.md) — Desktop Page/Runtime/Boot 合约
- [Station App Layer](../../../station/app-layer.md) — Station 业务 Subserver 与 DDD 分层入口
- [Agent Orchestration Architecture](./agent-orchestration-architecture.md) — 编排架构
- [Agent Workspace OSS Architecture](./agent-workspace-oss-architecture.md) — Workspace 架构
