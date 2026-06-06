# Agent Kernel — 模块目录设计

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `apps/station/app/subserver/agent/`

---

## 1. Station 目录总览

目标目录按 DDD 边界组织，不把所有 service 塞进一个平面目录：

```text
apps/station/app/subserver/agent/
├── agent.go
├── handler/
├── application/
├── domain/
├── infrastructure/
├── projection/
└── errcode/
```

依赖方向：

```text
handler -> application -> domain
application -> infrastructure interfaces
infrastructure -> domain
projection -> application read models
domain -> no station handler / no desktop / no HTTP
```

---

## 2. `handler/`

职责：HTTP / stream 边界，做鉴权、参数绑定、proto request/response 映射、错误映射。

```text
handler/
├── agent_handler.go
├── runtime_profile_handler.go
├── thread_handler.go
├── turn_handler.go
├── stream_handler.go
├── tool_approval_handler.go
├── memory_handler.go
├── skill_handler.go
├── mcp_handler.go
├── a2a_handler.go
├── growth_handler.go
└── error_mapper.go
```

约束：

- handler 不直接调用 repository。
- handler 不组装 prompt。
- handler 不判断 tool policy。
- handler 不维护 Desktop projection 状态。

---

## 3. `application/`

职责：用例编排，事务边界，跨 domain service 协作。

```text
application/
├── agent_app.go
├── profile_app.go
├── thread_app.go
├── turn_app.go
├── stream_app.go
├── tool_app.go
├── memory_app.go
├── skill_app.go
├── mcp_app.go
├── a2a_app.go
├── channel_app.go
├── scheduler_app.go
└── growth_app.go
```

典型用例：

- `CreateAgent`
- `UpdateRuntimeProfile`
- `CreateThread`
- `ExecuteTurn`
- `StopTurn`
- `RespondToolApproval`
- `InstallSkillPackage`
- `ConnectMCPServer`
- `BindChannelAgent`
- `GenerateGrowthReport`

---

## 4. `domain/`

### 4.1 `domain/runtime/`

```text
domain/runtime/
├── logical_agent.go
├── runtime_profile.go
├── capability_set.go
├── turn_runner.go
├── runtime_event.go
└── runtime_errors.go
```

职责：RuntimeProfile、TurnRunner 状态机、运行事件、运行错误、Provider capability 判定。

### 4.2 `domain/provider/`

```text
domain/provider/
├── provider.go
├── descriptor.go
├── capability_set.go
├── control_policy.go
├── registry.go
├── kernel_native_provider.go
├── model_backend.go
├── model_backend_registry.go
├── cli_wrapped_provider.go
├── cli_bridge_policy.go
└── provider_event.go
```

职责：统一 AgentProvider 合同、Kernel-native / CLI-wrapped Provider 注册、ModelBackend 注册、可控性矩阵、CLI Provider 受限桥策略。

### 4.3 `domain/thread/`

```text
domain/thread/
├── thread.go
├── turn.go
├── turn_event.go
├── replay_policy.go
├── conversation_window.go
└── thread_title.go
```

职责：Thread / Turn 聚合、TurnEvent 顺序保证、历史截断和 replay、标题生成策略。

### 4.4 `domain/prompt/`

```text
domain/prompt/
├── assembler.go
├── identity_layer.go
├── runtime_layer.go
├── memory_layer.go
├── skill_layer.go
├── workspace_layer.go
├── tool_layer.go
├── channel_layer.go
└── prompt_hash.go
```

职责：Prompt 分层组装、各层 hash 生成、Token budget 与压缩策略。

### 4.5 `domain/tool/`

```text
domain/tool/
├── descriptor.go
├── registry.go
├── policy.go
├── approval.go
├── tool_dispatcher.go
├── audit.go
├── builtin/
│   ├── memory_tools.go
│   ├── skill_tools.go
│   ├── a2a_tools.go
│   ├── scheduler_tools.go
│   └── channel_tools.go
└── bridge/
    ├── desktop_bridge.go
    └── mcp_bridge.go
```

职责：schema-first 工具注册、tool allow/deny 与 risk policy、approval 生命周期、MCP / Desktop / Station service tool dispatch。这里的 `tool_dispatcher` 只分发工具调用，不代表 LLM Provider。

### 4.6 `domain/memory/`

```text
domain/memory/
├── memory_item.go
├── memory_snapshot.go
├── memory_retriever.go
├── memory_governance.go
├── memory_feedback.go
├── memory_rollback.go
└── knowledge_salvage.go
```

职责：Memory 存储与召回、信任分与归因、freeze / rollback / salvage。

### 4.7 `domain/skill/`

```text
domain/skill/
├── package.go
├── skill.go
├── disclosure.go
├── guard.go
├── versioning.go
├── import_export.go
└── skill_matcher.go
```

职责：SkillPackage 与 SkillRecord、渐进式披露、安全扫描、版本与回滚。

### 4.8 `domain/mcp/`

```text
domain/mcp/
├── server.go
├── connection.go
├── capability_cache.go
├── tool_projection.go
└── health.go
```

职责：MCP 服务器配置与连接、capability refresh、MCP tool 到 Station tool 的投影。

### 4.9 `domain/a2a/`

```text
domain/a2a/
├── agent_card.go
├── task.go
├── resolver.go
├── transport.go
├── local_transport.go
├── http_transport.go
└── policy.go
```

职责：Agent Card 生成、Task 状态机、本地/远程 resolver、per-agent call policy。

### 4.10 `domain/channel/`

```text
domain/channel/
├── binding.go
├── routing_policy.go
├── response_mode.go
├── surface_context.go
└── inbound_mapper.go
```

职责：Friend / Group / Channel 到 AgentThread 的映射、mention / always / ai-decide 响应策略、渠道上下文注入。

### 4.11 `domain/growth/`

```text
domain/growth/
├── event.go
├── trace.go
├── metrics.go
├── report.go
├── diagnostic.go
├── correction.go
└── dogfood.go
```

职责：TurnTrace、Growth metric、退化诊断、修正建议与 dogfood 验证。

### 4.12 `domain/scheduler/`

```text
domain/scheduler/
├── job.go
├── run.go
├── trigger.go
├── autonomous_turn.go
└── retry_policy.go
```

职责：Cron/autonomous job、后台 review、dogfood、定时 Agent Turn。

### 4.13 `domain/workspace/`

```text
domain/workspace/
├── context_reference.go
├── workspace_policy.go
├── local_path_grant.go
├── context_snapshot.go
└── coding_run.go
```

职责：@file / @folder / @diff / local path grant、Workspace context snapshot、未来 CodingRun 的领域合同。

---

## 5. `infrastructure/`

```text
infrastructure/
├── persistence/
│   ├── agent_repo.go
│   ├── runtime_profile_repo.go
│   ├── thread_repo.go
│   ├── turn_repo.go
│   ├── tool_call_repo.go
│   ├── memory_repo.go
│   ├── skill_repo.go
│   ├── mcp_repo.go
│   ├── a2a_repo.go
│   └── growth_repo.go
├── provider/
│   ├── client.go
│   ├── openai_compatible.go
│   ├── stream_decoder.go
│   ├── tool_call_adapter.go
│   ├── eino_adapter.go
│   ├── model_backend_openai_compatible.go
│   ├── model_backend_anthropic.go
│   ├── model_backend_ollama.go
│   └── cli_runner_adapter.go
├── eventbus/
│   ├── publisher.go
│   └── subscriber.go
├── mcpclient/
├── a2aclient/
└── desktopbridge/
```

约束：

- repository interface 放 application/domain 需要的边界处；GORM 实现放 infrastructure。
- provider adapter 负责协议转换、CLI 进程外壳和事件归一，不决定业务 policy。
- desktopbridge 只对接 Desktop Rust 能力，不绕过 Station 真源。

---

## 6. `projection/`

```text
projection/
├── agent_list_projection.go
├── agent_profile_projection.go
├── thread_list_projection.go
├── thread_detail_projection.go
├── tool_approval_projection.go
├── memory_projection.go
├── skill_projection.go
└── growth_projection.go
```

职责：

- 为 Desktop RuntimeDescriptor 提供 read model。
- 合并 TurnEvent、ToolCall、GrowthEvent 到 UI 友好状态。
- 不承载业务写操作。

---

## 7. Desktop 目录规划

Desktop Web 目标目录：

```text
apps/desktop/src/
├── runtimes/agent/
│   ├── agentRuntime.ts
│   ├── projections.ts
│   ├── events.ts
│   └── api.ts
├── pages/agent/
│   ├── AgentCenterPage.tsx
│   ├── AgentChatPage.tsx
│   ├── AgentProfilePage.tsx
│   ├── AgentMemoryPage.tsx
│   ├── AgentSkillPage.tsx
│   ├── AgentToolsPage.tsx
│   ├── AgentMCPPage.tsx
│   ├── AgentA2APage.tsx
│   └── AgentGrowthPage.tsx
└── components/agent/
    ├── AgentHeader.tsx
    ├── AgentThreadList.tsx
    ├── AgentConversationFlow.tsx
    ├── ToolApprovalCard.tsx
    ├── MemoryInspector.tsx
    ├── SkillPackagePicker.tsx
    ├── RuntimeProfileEditor.tsx
    └── GrowthReportPanel.tsx
```

Desktop Rust 目标目录：

```text
apps/desktop/src-tauri/src/
├── agent/
│   ├── commands.rs
│   ├── station_client.rs
│   ├── stream_bridge.rs
│   ├── local_path_grant.rs
│   ├── cli_provider_launcher.rs
│   └── secure_store.rs
```

约束：

- Web 页面不直接调用 fetch；通过 `agentRuntime` 或 Desktop API service。
- Rust 不保存 Agent profile，不做 Tool policy，不把 CLI Provider 当成独立业务真源。
- 本地路径授权 token 必须由 Station 记录引用摘要，Desktop 只持有设备态 grant。
