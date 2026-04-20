# A2A 协议集成

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team
> **Module**: `frame/core/agent/` + `frame/core/plugin/native/agent/`

---

## 1. Document Scope

本文档集定义：

- A2A (Agent-to-Agent) 协议 1.0.0 在 Peers-Touch 中的集成方案
- Native Agent 作为框架级一等公民的定位与双层架构
- A2A 协议数据模型、状态机、流式事件的落地设计
- 与现有 Agent SubServer 的映射关系与迁移路径

本文档集不定义：

- Agent SubServer 的业务逻辑（Turn Loop、Memory、Skill、Growth）→ 见 `agent-self-growth-architecture.md`
- Station frame 的通用组件模式 → 见 `docs/station/frame-layer.md`
- 编码规范 → 见 `docs/global/coding-guide/station/`

---

## 2. 背景与问题

Peers-Touch Station 的 Agent 能力当前完全封装在 `app/subserver/agent/` 业务子服务器中。这种方式在单站场景下工作良好，但有三个根本性限制：

1. **无法与外部框架的 Agent 通信** — LangGraph、CrewAI、AutoGen 等框架的 Agent 无法参与协作
2. **没有标准发现机制** — Agent 能力只通过进程内注册表达，没有机器可读的能力描述
3. **Agent 不是架构一等公民** — Agent 仅作为 SubServer 存在于 `app/` 业务层，无法被其他组件对等地依赖和调用

本文提出双层 Agent 架构：

| 层级 | 位置 | 定位 |
|------|------|------|
| **Native Agent** | `frame/core/agent/` | 框架级基础设施组件，与 Registry、Logger、Store 并级 |
| **Agent SubServer** | `app/subserver/agent/` | 业务级 DDD 子服务器，面向前端的 Agent 业务入口 |

---

## 3. 设计目标

1. 全面采用 A2A 开放协议 1.0.0，每个 Agent 成为独立的 A2A Server
2. Agent 间通信统一走 HTTP JSON-RPC 2.0，本地与远程透明
3. Native Agent 组件可被 Station 内任意组件对等地依赖和调用
4. 外部框架的 Agent 可以通过标准 A2A 协议接入 Peers-Touch 生态
5. Peers-Touch 的 Agent 也可以作为 A2A Client 调用外部 A2A Server

---

## 4. A2A 与 MCP 的关系

|        | A2A | MCP |
|--------|-----|-----|
| 角色     | Agent ↔ Agent | Agent ↔ Tool/Resource |
| 交互模式   | 任务委托、协商、多轮对话 | 工具调用、资源访问 |
| 状态     | 有状态（Task 状态机） | 无状态（请求-响应） |
| 发现     | Agent Card | Server Capabilities |

两者互补，不冲突。A2A 补齐的是 Agent 层面的标准化协作协议。

---

## 5. 文档导航

| 文档 | 说明 |
|------|------|
| [design.md](./design.md) | 架构设计：协议要点、系统架构、核心接口、组件关系、HTTP 端点 |
| [decisions.md](./decisions.md) | 设计决策（D-01–D-07）+ 评审记录（R-01–R-25） |
| [data-model.md](./data-model.md) | 协议层数据结构、Task/Message/Artifact、流式事件、持久化策略 |
| [integration.md](./integration.md) | 与现有模块的标识映射、delegation 改造、事件映射、影响面 |
| [module-layout.md](./module-layout.md) | 模块目录结构与文件职责 |
| [execution-plans/](./execution-plans/) | 分阶段实施计划（Phase 1–4） |

---

## 6. 术语对照

| 术语 | 含义 |
|------|------|
| A2A | Agent-to-Agent，Linux Foundation 托管的开放协议 |
| Agent Card | Agent 能力声明文档，路径 `/.well-known/agent-card.json` |
| Native Agent | 框架级 Agent 组件，位于 `frame/core/agent/`，一等公民 |
| Agent SubServer | 业务级 Agent 子服务器，位于 `app/subserver/agent/`，DDD 组织 |
| `contextId` | 跨多个 Task 的会话上下文 ID，对应 `conversation_id` |
| `taskId` | 一次请求的 Task ID，对应 `turn_id` |
| Task | A2A 任务实体，带状态机 |
| Artifact | Task 的产出物，对应 Turn 的 `final_response` |
| Part | 消息片段，tagged union: `text` / `file` / `data` |

---

> **协议参考**: [A2A Specification 1.0.0](https://a2a-protocol.org/latest/) (Linux Foundation)
> **现有架构参考**: [agent-self-growth-architecture.md](../agent-self-growth-architecture.md)
