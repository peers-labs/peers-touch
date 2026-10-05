# A2A 协议集成 — 模块目录结构

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 目录树

```
frame/core/agent/                          # 框架级一等公民
├── agent.go                               # Agent 接口定义 + 全局访问器
├── options.go                             # Option 模式配置
├── types.go                               # AgentCard、AgentSkill 等协议数据结构
├── task.go                                # Task 状态机；taskId/cancelFunc 注册表
├── message.go                             # A2A Message / Part / Artifact 结构
├── errors.go                              # A2A 错误码定义
└── stream.go                              # StreamResponse 类型定义

frame/core/plugin/native/agent/            # Native 实现
├── native.go                              # Agent 接口的 native 实现
├── plugin.go                              # Plugin 注册
├── options.go                             # 实现级配置
├── registry.go                            # 本地 + 远程 Agent Card 统一注册表
├── server.go                              # A2A JSON-RPC 分发
├── client.go                              # A2A Client（Card 解析、请求、SSE 消费）
├── converter.go                           # A2A Message ↔ 内部消息投影
├── propagation.go                         # Context propagation header 编解码
├── transport.go                           # http / inproc 双 transport
├── discovery.go                           # Agent Card 暴露与远程 Card 拉取/缓存
└── sse.go                                 # SSE 编码、心跳、缓冲

app/subserver/agent/                       # 业务层（已有，调整依赖）
├── service/delegation_service.go          # 改为依赖 frame/core/agent 的 Client
└── ...                                    # 其余 DDD 结构不变

access/api/                                # 路由层
└── handler_a2a.go                         # Hertz handler → frame/core/agent Handlers()
```

## 文件职责

| 路径 | 职责 |
|------|------|
| `frame/core/agent/agent.go` | Agent 接口定义（Registry + Client + Server facade）+ 全局访问器 |
| `frame/core/agent/types.go` | AgentCard、AgentSkill、AgentCapabilities 等 A2A 协议数据结构 |
| `frame/core/agent/task.go` | Task 状态机定义、TaskState 常量、TaskStatus / Task 结构 |
| `frame/core/agent/message.go` | A2A Message / Part（tagged union）/ Artifact 结构 |
| `frame/core/agent/errors.go` | JSON-RPC 标准错误码 + A2A 规范扩展错误码 |
| `frame/core/agent/stream.go` | StreamResponse 类型定义（OneOf wrapper） |
| `frame/core/agent/options.go` | Option 模式配置项 |
| `native/agent/native.go` | Agent 接口的 native 实现，组合 registry + server + client |
| `native/agent/plugin.go` | AgentPlugin 注册（init 自注册） |
| `native/agent/registry.go` | 本地 + 远程 Agent Card 统一注册表 |
| `native/agent/server.go` | A2A JSON-RPC 请求分发、AgentExecutor 回调 |
| `native/agent/client.go` | A2A HTTP Client，Card 拉取/缓存、Send/Stream/Cancel |
| `native/agent/converter.go` | A2A Message ↔ 内部 AgentMessage 投影转换 |
| `native/agent/propagation.go` | Context propagation header（Depth、User、Trace）编解码 |
| `native/agent/transport.go` | http / inproc 双 transport 策略 |
| `native/agent/discovery.go` | Agent Card 暴露（`/.well-known/`）与远程 Card 拉取/缓存 |
| `native/agent/sse.go` | SSE 编码、心跳、ring buffer 缓冲 |
| `access/api/handler_a2a.go` | Hertz handler 注册，路由 A2A 端点到 Native Agent |

## 依赖关系

```
frame/core/agent/  (接口层，零外部依赖)
       ▲
       │ 实现
frame/core/plugin/native/agent/
       │ 依赖
       ├── frame/core/server/     (Handler 接口)
       ├── frame/core/registry/   (服务发现)
       ├── frame/core/store/      (KV 持久化)
       └── frame/core/logger/     (日志)

app/subserver/agent/
       │ 依赖
       └── frame/core/agent/      (AgentClient、AgentRegistry)

access/api/
       │ 依赖
       └── frame/core/agent/      (Handlers)
```
