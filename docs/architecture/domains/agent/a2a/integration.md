# A2A 协议集成 — 集成与映射

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 1. 标识与会话语义映射

| Peers-Touch 现有 | A2A | 关系 |
|------------------|-----|------|
| `conversation_id` (proto) | `contextId` | 1:1 |
| 一次 `turn_id` | `taskId` | 1:1，每次 send 新建 |
| 多轮续聊（同一 Conversation）| 同一 `contextId`，多个 `taskId` | 多对一 |
| `agent_id` | Agent Card `name` | 1:1 |

---

## 2. delegation_service 改造

现有 `delegation_service.go` 通过 goroutine + semaphore 在进程内编排子 Agent。改造后依赖 Native Agent：

```
// 现有
delegation_service.Execute(agentName, input)
  → 进程内 goroutine 调用 turn_service

// 改造后
delegation_service.Execute(agentName, input)
  → agent.Resolve(agentName) → AgentCard
  → agent.Send(card, message, opts)  // 本地/远程透明
  → 收到 Task{state, artifacts}
  → 提取 Artifacts → 返回结果
```

---

## 3. StreamEvent 映射

| Agent SubServer 事件 | A2A 事件 | DataPart `data.kind` |
|---------------------|----------|----------------------|
| Turn 开始执行 | `statusUpdate`(WORKING) | — |
| 流式文本增量 | `artifactUpdate`(append=true) | — |
| Tool Call 事件 | `statusUpdate`(WORKING, message=DataPart) | `peers-touch.tool_call.v1` |
| Tool Result 事件 | `statusUpdate`(WORKING, message=DataPart) | `peers-touch.tool_result.v1` |
| Reasoning 事件 | `statusUpdate`(WORKING, message=DataPart) | `peers-touch.reasoning.v1` |
| 工具审批等待 | `statusUpdate`(INPUT_REQUIRED) | `peers-touch.approval_request.v1` |
| 子 Agent 回填 | `artifactUpdate`(append=false, lastChunk=true) | `peers-touch.delegation.v1` 元数据 |
| Turn 完成 | `statusUpdate`(COMPLETED) | — |
| Turn 失败 | `statusUpdate`(FAILED) | — |

DataPart 命名空间约束：所有 Peers-Touch 私有事件统一用 `peers-touch.<event>.v<n>` 作为 `data.kind`。外部 Client 可选择忽略。

与 Agent SubServer 的语义对应：

| Agent SubServer 概念 | A2A |
|---------------------|-----|
| 新建 Turn + 执行 `TurnService.Execute()` | `TASK_STATE_SUBMITTED` → `TASK_STATE_WORKING` |
| Turn 完成，final_response 回填 | `TASK_STATE_WORKING` → `TASK_STATE_COMPLETED`，结果作为 `Artifact` |
| Turn 失败（ErrorClassifier 分类） | `TASK_STATE_WORKING` → `TASK_STATE_FAILED` |
| 续聊（同一 conversation_id，新 turn_id） | 复用 `contextId` + 新建 `taskId` |
| 工具审批等待用户确认 | `TASK_STATE_WORKING` → `TASK_STATE_INPUT_REQUIRED` |
| 缺少远程 Agent 凭据 | `TASK_STATE_WORKING` → `TASK_STATE_AUTH_REQUIRED` |

---

## 4. 跨边界上下文传播

| 信息 | 承载方式 | 说明 |
|------|---------|------|
| 协议版本 | `A2A-Version` HTTP header（`"1.0"`） | 必须携带 |
| 调用深度 | HTTP header `X-PeersTouch-Depth` | Server 以 header 为准 |
| 用户身份 | HTTP header `X-PeersTouch-User`（含签名）/ Bearer token | Server 必须校验 |
| Trace / LogID | W3C TraceContext (`traceparent`) + `X-PeersTouch-LogID` | 跨进程串联日志 |
| 父 Task 引用 | `Message.referenceTaskIds` + `Task.metadata["peers-touch.parentTaskId"]` | 追溯调用链 |

---

## 5. 影响面分析

| 模块 | 影响 | 改动程度 |
|------|------|---------|
| `frame/core/` | 新增 `agent/` 目录（一等公民）| **新增** |
| `frame/core/plugin/` | 新增 `AgentPlugin` 注册 + `native/agent/` 实现 | **新增** |
| `frame/core/plugin/native/node/` | `initComponents` 新增 Agent 初始化段 | 小 |
| `app/subserver/agent/service/delegation_service.go` | 改为依赖 `frame/core/agent` Client | 中 |
| `app/subserver/agent/service/turn_service.go` | Agent Card 注册（本地 Agent 注册到 Native Agent） | 小 |
| `access/api/router.go` | 新增 A2A 路由 | 中 |
| Agent proto (`model/domain/agent/`) | 新增 `a2a.proto` 定义 A2A 协议结构 | **新增** |

---

> **设计决策与评审** → [decisions.md](./decisions.md)
> **实施计划** → [execution-plans/](./execution-plans/)
