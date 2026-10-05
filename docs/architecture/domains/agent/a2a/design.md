# A2A 协议集成 — 架构设计

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 1. 核心原则

1. **Native Agent 是一等公民** — 与 Registry、Logger、Store、Transport 并级，位于 `frame/core/agent/`，通过 Plugin 机制初始化，任一组件可对接。
2. **每个 Agent 是独立的 A2A Server** — 各自的 `/.well-known/agent-card.json` 和 `/a2a/{name}` 端点。
3. **统一通信路径** — 内部 Agent 间调用也走 HTTP JSON-RPC 2.0，通过 localhost loopback。
4. **本地/远程透明** — A2A Client 只看 Agent Card 中 `supportedInterfaces[0].url`，不区分目标 Agent 在进程内还是远端。
5. **canonical source 不变** — Agent SubServer 的持久化（Turn、Conversation、AgentMessage）仍是事实来源；A2A 层做投影与转换。
6. **渐进切换** — delegation 改造期保留 transport 策略开关，可在 `inproc` 与 `http` 间切换以支撑回滚。

---

## 2. A2A 协议要点

A2A 是基于 JSON-RPC 2.0 的开放协议，由 Linux Foundation 托管。本节摘录后续设计强相关的部分；以官方规范为准。

### 2.1 Agent Card

每个 A2A Agent 在固定路径 `/.well-known/agent-card.json` 暴露一份机器可读的能力声明：

```json
{
  "name": "peers-touch-agent",
  "description": "Peers-Touch 自成长 Agent，支持 Turn 执行、Memory 积累、Skill 管理",
  "version": "1.0.0",
  "supportedInterfaces": [
    {
      "url": "http://localhost:{port}/a2a/peers-touch-agent",
      "protocolBinding": "JSONRPC",
      "protocolVersion": "1.0"
    }
  ],
  "provider": { "organization": "Peers-Touch", "url": "https://..." },
  "capabilities": {
    "streaming": true,
    "pushNotifications": false,
    "stateTransitionHistory": true,
    "extendedAgentCard": false
  },
  "securitySchemes": {
    "stationBearer": {
      "httpAuthSecurityScheme": { "scheme": "bearer" }
    }
  },
  "securityRequirements": [ { "stationBearer": [] } ],
  "defaultInputModes":  ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    {
      "id": "self-growth-turn",
      "name": "自成长 Turn 执行",
      "description": "执行一次完整的 Agent Turn，包含 Prompt 组装、LLM 调用、工具执行、Memory 更新",
      "tags": ["turn", "self-growth", "memory"],
      "examples": ["执行一次对话轮次", "帮我分析这段代码"]
    }
  ]
}
```

要点：

- 一个 A2A Agent 对应一个 Agent Card 端点，路径固定为 `/.well-known/agent-card.json`。
- `supportedInterfaces[]` 声明协议绑定端点，Peers-Touch 仅实现 `protocolBinding = "JSONRPC"`。
- `securitySchemes` 中的每个 scheme 使用 discriminated union（OneOf）。
- `capabilities.extendedAgentCard` 替代了原先的 `supportsAuthenticatedExtendedCard`。

### 2.2 Task 状态机

```
              ┌──────────────────────────────┐
              │                              ▼
SUBMITTED ──► WORKING ──► COMPLETED (terminal)
              │   ▲           
              │   │
              │   └── INPUT_REQUIRED ──┐
              │                        │
              │   ┌── AUTH_REQUIRED ────┘
              │   │
              ├──► FAILED    (terminal)
              ├──► CANCELED  (terminal)
              └──► REJECTED  (terminal)
```

| 状态 | 含义 | 终态 |
|------|------|------|
| `TASK_STATE_SUBMITTED` | Task 已提交、尚未开始 | 否 |
| `TASK_STATE_WORKING` | Agent 正在处理 | 否 |
| `TASK_STATE_INPUT_REQUIRED` | Agent 等待调用方补充输入 | 否 |
| `TASK_STATE_AUTH_REQUIRED` | 需要补充凭据后才能继续 | 否 |
| `TASK_STATE_COMPLETED` | 任务成功完成 | 是 |
| `TASK_STATE_FAILED` | 任务失败 | 是 |
| `TASK_STATE_CANCELED` | 任务被取消 | 是 |
| `TASK_STATE_REJECTED` | Agent 拒绝处理 | 是 |

### 2.3 Message、Part 与 Artifact

A2A 消息以 `Message` 为单位，`Part` 使用带 `kind` 字段的 tagged union 判别类型：

```
Message
  ├── messageId  (必填，UUID)
  ├── contextId  (会话上下文 ID)
  ├── taskId     (所属 Task ID，首次发送可省略)
  ├── role       (ROLE_USER | ROLE_AGENT)
  ├── extensions (可选扩展 URI 数组)
  └── parts: [ Part, ... ]
        ├── { kind: "text", text: "..." }                          // TextPart
        ├── { kind: "file", file: { bytes: "<b64>", ... } }       // FilePart
        └── { kind: "data", data: { ... }, metadata: { ... } }    // DataPart
```

`Artifact` 是 Task 的产出物，与过程通信的 `Message` 区分。流式增量由 `TaskArtifactUpdateEvent` 的 `append` / `lastChunk` 字段控制。

### 2.4 JSON-RPC 方法

A2A 1.0 方法名使用 PascalCase：

| 方法 | 用途 | 传输 |
|------|------|------|
| `SendMessage` | 发送消息，同步返回 `Task` 或 `Message` | HTTP POST |
| `SendStreamingMessage` | 发送消息，流式返回事件 | HTTP POST + SSE |
| `GetTask` | 查询 Task 状态、历史与产物 | HTTP POST |
| `CancelTask` | 取消正在执行的 Task | HTTP POST |
| `SubscribeToTask` | 订阅 / 重新订阅一个 Task 的流式事件 | HTTP POST + SSE |
| `ListTasks` | 分页查询 Task 列表 | HTTP POST |

所有请求必须携带 `A2A-Version` HTTP header（值为 `"1.0"`）。

### 2.5 流式事件

`SendStreamingMessage` 与 `SubscribeToTask` 通过 SSE 推送事件。`StreamResponse` 使用 OneOf wrapper：

| OneOf 成员 | 字段 | 含义 |
|-----------|------|------|
| `task` | 完整 Task 快照 | 流首帧或重连首帧 |
| `statusUpdate` | `TaskStatusUpdateEvent` | 状态变化（含中间 message） |
| `artifactUpdate` | `TaskArtifactUpdateEvent` | Artifact 增量 |
| `message` | 完整 Message | Agent 主动推消息（不绑定 Task） |

---

## 3. 系统架构

```
                    ┌──────────────────────────────────────────────────────┐
                    │              Peers-Touch Station Process             │
                    │                                                      │
                    │  ┌────────────────────────────────────────────────┐  │
                    │  │  app/subserver/agent/ (业务层)                  │  │
                    │  │  Turn Loop · Memory · Skill · Growth · Review  │  │
                    │  │  前端 HTTP API (POST /agent/turn/execute ...)  │  │
                    │  └──────────────────┬─────────────────────────────┘  │
                    │                     │ 依赖                           │
                    │  ┌──────────────────┴─────────────────────────────┐  │
                    │  │  frame/core/agent/ (基础设施层 — 一等公民)       │  │
                    │  │                                                │  │
                    │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐     │  │
                    │  │  │  A2A     │  │  A2A     │  │  A2A     │     │  │
   /a2a/default ◄──┼──┼──┤  Server  │  │  Server  │  │  Server  │     │  │
   /a2a/lark    ◄──┼──┼──┤ (default)│  │  (lark)  │  │  (xxx)   │     │  │
   /a2a/...     ◄──┼──┼──┤          │  │          │  │          │     │  │
                    │  │  └────┬─────┘  └────┬─────┘  └────┬─────┘     │  │
                    │  │       │             │             │            │  │
                    │  │       ▼             ▼             ▼            │  │
                    │  │  ┌─────────────────────────────────────────┐   │  │
                    │  │  │           A2A Runtime Core              │   │  │
                    │  │  │  - Agent Registry (local + remote)     │   │  │
                    │  │  │  - JSON-RPC 分发 / SSE 编解码           │   │  │
                    │  │  │  - Task 状态机 & 取消注册表              │   │  │
                    │  │  │  - Context Propagation (depth/user)    │   │  │
                    │  │  │  - A2A ↔ internal message 投影/转换     │   │  │
                    │  │  └──────────────────────────────────────────┘  │  │
                    │  │                                                │  │
                    │  │  ┌─────────────────────────────────────────┐   │  │
                    │  │  │            A2A Client                   │   │  │
                    │  │  │  - 拉取 / 缓存 远程 Agent Card           │   │  │
                    │  │  │  - 发送 SendMessage | Stream             │   │  │
                    │  │  │  - SSE 消费 & SubscribeToTask            │   │  │
                    │  │  │  - Task 生命周期 / 重试 / 鉴权           │   │  │
                    │  │  └─────────────────────────────────────────┘   │  │
                    │  │                                                │  │
                    │  │  Discovery:                                    │  │
                    │  │   /a2a/{name}/.well-known/agent-card.json      │  │
                    │  └────────────────────────────────────────────────┘  │
                    │                                                      │
                    │  ── 并级的其他一等公民 ──                              │
                    │  frame/core/registry/   服务注册与发现               │
                    │  frame/core/logger/     结构化日志                   │
                    │  frame/core/store/      持久化存储                   │
                    │  frame/core/transport/  libp2p 传输                  │
                    │  frame/core/event/      实时事件推送 (SSE/WS)        │
                    │  frame/core/broker/     消息代理                     │
                    └──────────────────────────────────────────────────────┘
                              │                    ▲
                              │ A2A Client         │ A2A Server
                              ▼                    │
                    ┌─────────────────────┐  ┌─────────────────────┐
                    │  External A2A       │  │  External A2A       │
                    │  Server (远程 Agent)│  │  Client (外部调用方) │
                    └─────────────────────┘  └─────────────────────┘
```

---

## 4. 核心接口

Native Agent 遵循与 Registry、Logger 等相同的组件模式：

```go
// frame/core/agent/ — 与 frame/core/registry/ 并级

type Agent interface {
    // 基础生命周期（与 Registry、Logger 统一模式）
    Init(ctx context.Context, opts ...option.Option) error
    Options() Options
    String() string

    // Agent Registry（local + remote 统一视图）
    Register(ctx context.Context, card *AgentCard) error
    Deregister(ctx context.Context, name string) error
    Resolve(ctx context.Context, name string) (*AgentCard, error)
    List(ctx context.Context) ([]*AgentCard, error)

    // A2A Client（对等调用任意 Agent）
    Send(ctx context.Context, card *AgentCard, msg *Message, opts ...SendOption) (*Task, error)
    SendStream(ctx context.Context, card *AgentCard, msg *Message, opts ...SendOption) (<-chan StreamResponse, error)
    Cancel(ctx context.Context, card *AgentCard, taskID string) (*Task, error)

    // A2A Server（接收外部 A2A 请求的入口）
    Handlers() []server.Handler
}
```

初始化顺序（扩展 `native_init_top_comp.go` 的组件链）：

```
Logger → Store → Transport → Registry → Agent → Server → Client
                                          ↑
                                    新增一等公民
```

Plugin 注册模式与 Registry 一致：

```go
// frame/core/plugin/peer.go 扩展
var AgentPlugins = map[string]AgentPlugin{}

// native_init_top_comp.go 新增 Agent 初始化段
if s.opts.Agent == nil {
    agentName := config.Get("peers.agent.name").String(plugin.NativePluginName)
    s.opts.Agent = plugin.AgentPlugins[agentName].New()
}
if err := s.opts.Agent.Init(ctx, s.opts.AgentOptions...); err != nil {
    return fmt.Errorf("init agent err: %v", err)
}
```

---

## 5. 组件关系

Native Agent 作为一等公民，其他组件可以对等地依赖它：

| 消费方 | 使用方式 | 场景 |
|--------|---------|------|
| **Agent SubServer** | `agent.Resolve()` + `agent.Send()` | delegation_service 子 Agent 编排 |
| **Social SubServer** | `agent.Send()` | 社交场景触发 Agent 分析（如内容审核） |
| **Scheduler SubServer** | `agent.Send()` | 定时任务触发 Agent 执行（如 Background Review） |
| **Event System** | `agent.SendStream()` | 事件驱动的 Agent 流式响应 |
| **Registry** | `agent.List()` | 节点发现时聚合可用 Agent 能力 |
| **外部 A2A Client** | HTTP → `agent.Handlers()` | 跨 Station / 跨框架的 Agent 调用 |

这是 Native Agent 与纯业务 SubServer 的本质区别：**SubServer 只能被前端通过 HTTP 调用，而 Native Agent 可以被任意组件在代码层面直接依赖。**

---

## 6. HTTP 端点

Native Agent 暴露的 A2A 标准端点（通过 `agent.Handlers()` 注入主 Server）：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/a2a/{agent_name}` | POST | A2A JSON-RPC 端点 |
| `/a2a/{agent_name}/.well-known/agent-card.json` | GET | 单个 Agent Card（A2A 标准） |

Station 扩展端点（**非 A2A 标准**，供前端管理界面使用）：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/a2a/agents` | GET | 聚合视图：本地 + 已注册远程 Agent Card |
| `/api/a2a/agents` | POST | 通过 URL 注册一个远程 A2A Agent |
| `/api/a2a/agents/{name}` | DELETE | 移除远程 A2A Agent |
| `/api/a2a/tasks` | GET | 查询当前活跃 Task（运维用） |

---

> **详细模块目录结构** → [module-layout.md](./module-layout.md)
> **数据模型详情** → [data-model.md](./data-model.md)
> **设计决策与评审** → [decisions.md](./decisions.md)
