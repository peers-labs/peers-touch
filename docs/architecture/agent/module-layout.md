# Agent 模块目录结构

> **Status**: active
> **Version**: v1.3
> **Created**: 2026-10-02 | **Updated**: 2026-10-03
> **Owner**: Peers-Touch Agent Team

---

## 1. 目录树

```text
docs/architecture/agent/
├── README.md
├── design.md
├── decisions.md
├── data-model.md
├── module-layout.md
├── integration.md
├── proposals/
│   └── 20261003-personal-agent-os.md
├── modern-chat-agent/
├── provider-station-ownership/
└── execution-plans/

model/domain/agent/
apps/station/app/subserver/agent/
├── service/                     # Goal, TaskRun, Turn, capability and GoalAcceptance owners
└── infrastructure/persistence/ # Agent truth plus realtime outbox records
apps/station/app/subserver/events/
└── EventBus + /events/stream   # all Station realtime fan-out
apps/desktop/src-tauri/src/application/
├── agent_turn/
└── mcp/                        # Desktop-local secret/process executor only
packages/agent-catalog/
tooling/acceptance/gates/agent/
```

## 2. 文件职责

| 路径 | 职责 |
|---|---|
| `docs/architecture/agent/` | Agent 架构入口、当前边界、决策和执行计划 |
| `docs/architecture/agent/proposals/20261003-personal-agent-os.md` | Goal OS 产品增量、跨模块 owner 和 acceptance 合同 |
| `docs/architecture/agent/modern-chat-agent/` | 单 Agent Chat 的详细产品与架构合同 |
| `docs/architecture/agent/provider-station-ownership/` | Provider 配置、凭证和执行 owner |
| `model/domain/agent/` | 跨层 proto 与生成代码输入 |
| `apps/station/app/subserver/agent/` | Agent 业务权威、MCP 配置目录、Station-local MCP 执行与 Turn 编排 |
| `apps/station/app/subserver/events/` | 全 Station 唯一 realtime fan-out、bounded replay、subscriber backpressure 与 canonical SSE |
| `apps/desktop/src-tauri/src/application/agent_turn/` | Desktop Turn gateway 与流式桥接 |
| `apps/desktop/src-tauri/src/application/mcp/` | Desktop-local MCP secret、进程与执行能力 |
| `packages/agent-catalog/` | 受信 catalog 与 manifest 合同 |
| `tooling/acceptance/gates/agent/` | 真实 Agent Journey 驱动与证据采集 |

## 3. 依赖关系

```text
Desktop UI/runtime
       |
       v
Desktop Tauri Agent/MCP application
       | client-owned request/receipt
       v
Station Agent subserver ----> Station-local MCP executor
       |
       +----> model/domain/agent
       +----> provider adapters
       +----> persistence
       +----> shared Station EventBus ----> /events/stream

Acceptance Gate ---> production UI/Tauri/Station path
```

依赖规则：

- Model 不依赖 Station、Desktop 或 Acceptance。
- Station 可以依赖 Model，不依赖 Desktop。
- Desktop 通过共享合同和 Station gateway 消费业务能力。
- Acceptance 可驱动生产入口，但生产模块不得依赖 Acceptance。
- MCP Server 目录、脱敏配置、tool manifest、binding、readiness 与审计只在
  Station。
- MCP secret 与子进程保留在声明的 execution owner：
  `CLIENT_CAPABILITY` 位于 Desktop Tauri，`STATION` 位于 Station runtime。
- Desktop MCP 存储不得保留可独立枚举的配置目录或 readiness 真源。
- Goal、Goal graph、decision、budget 和 terminal acceptance 只在 Station。
- `GoalAcceptanceService` 是生产验收与 Goal terminal verdict owner；
  Acceptance Framework 只能驱动和读取生产路径。
- `TaskRun + ExecutionStep` 是唯一可执行工作生命周期；`AgentTask` 与
  `CollaborationTask` 在 hard cut 后不得拥有 handler、writer 或独立恢复器。
- durable Goal/Task mutation 必须同事务写入 `AgentRealtimeOutbox`，再由有 lease
  的 relay 转入共享 Station EventBus；Agent 不得创建私有 fan-out bus、
  subscriber registry、专属 SSE 或直接 dispatch 路径。
- Agent Canvas、Atelier 和 Home 只能依赖 Station Goal/Task projection。
- Runtime adapter 不能导入 Goal persistence 或直接推进 Goal lifecycle。
