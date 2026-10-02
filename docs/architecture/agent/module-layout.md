# Agent 模块目录结构

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-10-02 | **Updated**: 2026-10-02
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
├── modern-chat-agent/
├── provider-station-ownership/
└── execution-plans/

model/domain/agent/
apps/station/app/subserver/agent/
apps/desktop/src-tauri/src/application/
├── agent_turn/
└── mcp/
packages/agent-catalog/
tooling/acceptance/gates/agent/
```

## 2. 文件职责

| 路径 | 职责 |
|---|---|
| `docs/architecture/agent/` | Agent 架构入口、当前边界、决策和执行计划 |
| `docs/architecture/agent/modern-chat-agent/` | 单 Agent Chat 的详细产品与架构合同 |
| `docs/architecture/agent/provider-station-ownership/` | Provider 配置、凭证和执行 owner |
| `model/domain/agent/` | 跨层 proto 与生成代码输入 |
| `apps/station/app/subserver/agent/` | Agent 业务权威、持久化和执行编排 |
| `apps/desktop/src-tauri/src/application/agent_turn/` | Desktop Turn gateway 与流式桥接 |
| `apps/desktop/src-tauri/src/application/mcp/` | 本机 MCP 进程与执行能力 |
| `packages/agent-catalog/` | 受信 catalog 与 manifest 合同 |
| `tooling/acceptance/gates/agent/` | 真实 Agent Journey 驱动与证据采集 |

## 3. 依赖关系

```text
Desktop UI/runtime
       |
       v
Desktop Tauri Agent/MCP application
       |
       v
Station Agent subserver
       |
       +----> model/domain/agent
       +----> provider adapters
       +----> persistence

Acceptance Gate ---> production UI/Tauri/Station path
```

依赖规则：

- Model 不依赖 Station、Desktop 或 Acceptance。
- Station 可以依赖 Model，不依赖 Desktop。
- Desktop 通过共享合同和 Station gateway 消费业务能力。
- Acceptance 可驱动生产入口，但生产模块不得依赖 Acceptance。
- MCP secret 与子进程保留在 Desktop Tauri 边界，Station 只持有治理状态和回执。
