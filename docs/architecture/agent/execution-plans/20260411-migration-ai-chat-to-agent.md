# P1: 存量 ai_chat 迁移至 agent subserver

## 依赖

- 依赖 System Prompt Assembly（P0，turn handler 需要 prompt 组装能力）
- 依赖 Memory 有界存储（P0，memory_service 需要就位）
- 依赖 Skill 文件系统（P0，skill_service 需要就位）
- 依赖 Error Recovery（P0，error_classifier_service + credential_pool_service 需要就位）
- 依赖 Context Compression 工程化（P0，compression_service 完整 9 步流程需要就位）

## 目标

将现有 `apps/station/app/subserver/ai_chat` 的存量能力迁移到 `agent` subserver，完成以下三件事：

1. **存量不丢失** — 聊天补全、session 管理、provider 管理等基础能力原样承接
2. **新服务全部就位** — error classification、context compression、delegation、credential pool、context reference 五大新 service 在目标目录中就位并注册
3. **领域对象完整** — domain 层包含全部 7 个领域对象文件（turn、memory、skill、review、conversation、error、delegation、credential）

## Hermes 参照

| peers-touch 目标 service | Hermes 源文件 | 核心职责 |
|---|---|---|
| `turn_service.go` | `run_agent.py` — `run_conversation()` | turn loop 编排，retry loop，compression trigger |
| `prompt_assembly_service.go` | `agent/prompt_builder.py` | 8 层 system prompt 组装 |
| `memory_service.go` | `agent/memory_store.py` | memory CRUD + 冻结快照 |
| `skill_service.go` | `agent/skill_manager.py` | skill CRUD + 渐进式披露 |
| `review_service.go` | `run_agent.py` — `_spawn_background_review()` | background review 触发 |
| `compression_service.go` | `agent/context_compressor.py` | 完整 9 步 compression |
| `provider_service.go` | `agent/llm_client.py` + prompt caching | LLM 调用 + cache_control 注入 |
| `error_classifier_service.go` | `agent/error_classifier.py` | 12 种 FailoverReason 分类管线 |
| `delegation_service.go` | `run_agent.py` — delegate 流程 | 子 Agent 编排（errgroup） |
| `credential_pool_service.go` | `agent/credential_pool.py` | 凭证池管理（轮换、cooldown、lease） |
| `context_reference_service.go` | `agent/prompt_builder.py` — context ref 解析 | @file/@folder/@url/@diff/@staged 解析 |

## 当前状态

### 存量 ai_chat 目录结构

```
apps/station/app/subserver/ai_chat/
  aichat.go                        # subserver 注册（实现 server.Subserver）
  plugin.go                        # plugin 注册（init() 注册到 plugin.SubserverPlugins）
  options.go                       # Options 封装
  db/model/                        # GORM 模型层
    provider.go, session.go, message.go, topic.go, user.go, attachment.go
  errcode/error.go                 # 业务错误码
  handler/                         # HTTP Handler 层
    chat_handler.go, session_handler.go, message_handler.go, provider_handler.go
  model/                           # Protobuf 生成的请求/响应模型
    chat.pb.go, session_messages.pb.go, provider.pb.go, ai_models.pb.go
  service/                         # 业务逻辑层
    chat_service.go, session_service.go, message_service.go, provider_service.go
```

### 存量问题

- 无错误分类能力 — API 错误直接崩溃
- 无 context compression — 长对话触达 context limit 即中断
- 无 credential 轮换 — 单 API key 用完即止
- 无 delegation — 不支持子 Agent
- 无 context reference — 不支持 @file 等引用

## 交付物

### 1. Station subserver 目标目录结构

```
apps/station/app/subserver/agent/
  agent.go                                # subserver 注册 + 路由
  plugin.go                               # plugin 注册
  options.go                              # Options 封装

  handler/
    turn_handler.go                       # POST /agent/turn/execute
    memory_handler.go                     # /agent/memory/*
    skill_handler.go                      # /agent/skill/*
    provider_handler.go                   # /agent/provider/*（从 ai_chat 迁移）
    session_handler.go                    # /agent/session/*（从 ai_chat 迁移）

  service/
    turn_service.go                       # turn loop 编排（retry + compression trigger + delegation）
    prompt_assembly_service.go            # system prompt 8 层组装
    memory_service.go                     # memory CRUD + 冻结快照 + 安全扫描
    skill_service.go                      # skill CRUD + 渐进式披露 + Skills Guard 扫描
    review_service.go                     # background review 触发 + review LLM call
    compression_service.go               # context compression 完整 9 步：
                                          #   knowledge salvage → provider notify → pre-prune →
                                          #   structured summary → iterative summary →
                                          #   tail protection → pair integrity →
                                          #   session split → rebuild prompt
    provider_service.go                   # LLM provider 调用 + prompt caching（cache_control 注入）
    error_classifier_service.go           # 12 种 FailoverReason 分类管线 + 恢复提示输出
    delegation_service.go                 # 子 Agent 编排：隔离、工具集交集、并发控制（errgroup）
    credential_pool_service.go            # 凭证池：多 key 轮换、exhausted cooldown、OAuth refresh、lease
    context_reference_service.go          # @file/@folder/@url/@diff/@staged 解析注入

  domain/
    turn.go                               # Turn, TurnTrace, NudgeState
    memory.go                             # MemoryItem, MemorySnapshot
    skill.go                              # SkillManifest, SkillVersion, ScanResult, Finding
    review.go                             # ReviewResult
    conversation.go                       # Conversation, Message（表名 agent_conversations / agent_messages）
    error.go                              # ClassifiedError, FailoverReason（12 种 enum）
    delegation.go                         # DelegationResult, DelegationTask
    credential.go                         # CredentialEntry, RotationStrategy

  infrastructure/
    persistence/                          # DB 读写层
    provider/                             # LLM API client（OpenAI / Anthropic / custom）
    embedding/                            # 向量检索（后期扩展）

  proto/
    agent.proto                           # ExecuteTurnRequest/Response, TurnTrace
    memory.proto                          # Memory CRUD messages
    skill.proto                           # Skill CRUD messages
```

### 2. 存量模块承接映射

| 存量模块 | 存量文件 | 承接方式 |
|---|---|---|
| subserver 注册 | `aichat.go` | 重命名为 `agent.go`，路由前缀 `/ai_chat` → `/agent`（保留 `/ai_chat` 兼容别名 6 个月） |
| plugin 注册 | `plugin.go` | `plugin.SubserverPlugins["ai-chat"]` → `plugin.SubserverPlugins["agent"]`，config key 同步更新 |
| CompleteChat | `service/chat_service.go` | 重构为 `turn_service.go`，在 LLM 调用前后加入 prompt assembly、tool execution、retry loop、compression trigger |
| Session model | `db/model/session.go` | 迁移为 `domain/conversation.go`，表名 `ai_chat_sessions` → `agent_conversations` |
| Message model | `db/model/message.go` | 迁移为 `domain/message.go`（合并入 `conversation.go`），表名 `ai_chat_messages` → `agent_messages` |
| Provider model | `db/model/provider.go` | 保留在 `infrastructure/provider/`，不改表名 |
| Provider 调用 | `service/chat_service.go` 中的 OpenAI/custom 调用 | 提取为 `service/provider_service.go`，增加 prompt caching（cache_control breakpoint 注入） |
| Session handler | `handler/session_handler.go` | 迁移到 `handler/session_handler.go`，路由更新 |
| Provider handler | `handler/provider_handler.go` | 迁移到 `handler/provider_handler.go`，路由更新 |

### 3. 新增 service 说明

| 新增 service | 核心职责 | 领域对象 |
|---|---|---|
| `error_classifier_service.go` | HTTP status + error code + message pattern → `ClassifiedError`，输出 retry / compress / rotate / fallback 提示 | `domain/error.go` — `ClassifiedError`, `FailoverReason` |
| `compression_service.go` | 完整 9 步 context compression：pre-prune → structured summary → iterative summary → tail protection → pair integrity → session split | `domain/turn.go` — `TurnTrace.compression_triggered` |
| `delegation_service.go` | 子 Agent 并发编排：隔离 conversation、工具集交集过滤、DELEGATE_BLOCKED_TOOLS、MAX_CONCURRENT_CHILDREN=3、MAX_DEPTH=2 | `domain/delegation.go` — `DelegationResult`, `DelegationTask` |
| `credential_pool_service.go` | 多 key 轮换（fill_first / round_robin / random / least_used）、exhausted cooldown（1h）、OAuth refresh、lease 机制 | `domain/credential.go` — `CredentialEntry`, `RotationStrategy` |
| `context_reference_service.go` | 解析 user message 中的 @file / @folder / @url / @diff / @staged 前缀，加载内容注入 context | 无独立领域对象，直接生成 content block 注入 turn context |

### 4. Proto 定义（更新版）

```protobuf
// agent.proto

message ExecuteTurnRequest {
  string conversation_id = 1;
  string agent_id = 2;
  string user_message = 3;
}

message ExecuteTurnResponse {
  string turn_id = 1;
  string response_content = 2;
  TurnTrace trace = 3;
}

message TurnTrace {
  string system_prompt_hash = 1;
  string memory_snapshot_hash = 2;
  string skill_index_hash = 3;
  repeated string skills_loaded = 4;
  repeated ToolCallRecord tool_calls = 5;
  bool review_triggered = 6;
  repeated ClassifiedErrorEvent error_classified = 7;     // NEW: error classification events
  CompressionEvent compression_event = 8;                 // NEW: compression event (if triggered)
  repeated DelegationResult delegation_results = 9;       // NEW: child agent results
}

// NEW: from error_classifier_service
message ClassifiedErrorEvent {
  int32 attempt = 1;
  string reason = 2;            // FailoverReason string: "auth", "rate_limit", "context_overflow", ...
  int32 status_code = 3;
  string provider = 4;
  string model = 5;
  string action = 6;            // "retry", "compress", "rotate_credential", "fallback", "abort"
  int64 timestamp = 7;
}

// NEW: from compression_service
message CompressionEvent {
  int32 pre_compression_tokens = 1;
  int32 post_compression_tokens = 2;
  int32 messages_pruned = 3;
  bool iterative = 4;            // true = iterative summary update, false = first-time structured summary
  int64 triggered_at = 5;
}

// NEW: from delegation_service
message DelegationRequest {
  string parent_turn_id = 1;
  string task_description = 2;
  repeated string requested_tools = 3;
  string agent_id = 4;
}

message DelegationResult {
  string task_id = 1;
  string agent_id = 2;
  string task_description = 3;
  string result_content = 4;
  string status = 5;               // "completed", "failed", "timeout"
  int64 started_at = 6;
  int64 completed_at = 7;
}
```

### 5. 数据库迁移

```sql
-- Phase 1: Rename existing tables
ALTER TABLE ai_chat_sessions RENAME TO agent_conversations;
ALTER TABLE ai_chat_messages RENAME TO agent_messages;

-- Phase 2: Existing new tables (defined in P0 execution plans)
-- agent_memories       — from memory-bounded-store execution plan
-- agent_skills         — from skill-filesystem-and-routing execution plan
-- agent_reviews        — from background-review execution plan

-- Phase 3: New table for credential pool
CREATE TABLE agent_credential_pool (
    credential_id   TEXT PRIMARY KEY,
    provider        TEXT NOT NULL,                                         -- "anthropic", "openai", "custom:xxx"
    label           TEXT,                                                  -- human-readable label
    auth_type       TEXT NOT NULL CHECK(auth_type IN ('api_key', 'oauth')),
    priority        INTEGER DEFAULT 0,                                    -- for fill_first strategy
    source          TEXT NOT NULL CHECK(source IN ('env', 'auth_store', 'config')),
    status          TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'exhausted', 'error')),
    request_count   INTEGER DEFAULT 0,
    exhausted_at    TIMESTAMP,
    cooldown_until  TIMESTAMP,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Note: access_token / refresh_token NOT stored in DB — 从 Station 安全存储层（Keychain / encrypted store）读取
-- agent_credential_pool 只存元数据和状态，不存 secret
CREATE INDEX idx_credential_pool_provider ON agent_credential_pool(provider);
CREATE INDEX idx_credential_pool_status ON agent_credential_pool(status);
```

### 6. Tauri 层变更

| 模块 | 文件 | 变更 |
|---|---|---|
| chat commands | `interface/tauri_commands/chat.rs` | 路由地址改为 `/agent/turn/execute` |
| chat mod | `application/chat/mod.rs` | 当前是本地调 LLM，改为转发给 Station |
| skills mod | `application/skills/mod.rs` | stub 改为转发 Station `/agent/skill/*` |
| memory mod | `application/memory/mod.rs` | stub 改为转发 Station `/agent/memory/*` |
| agents mod | `application/agents/mod.rs` | 保留，agent profile 仍可本地管理 |

### 7. Desktop 层变更

| 模块 | 文件 | 变更 |
|---|---|---|
| desktop_api.ts | `services/desktop_api.ts` | `streamChat` → `executeAgentTurn`，API 路径更新 |
| chat.ts store | `store/chat.ts` | 适配新的 turn 响应结构（含 TurnTrace 全字段） |
| ChatPage.tsx | `pages/ChatPage.tsx` | 无 UI 变更，底层 API 替换 |
| MemoryPage.tsx | `pages/MemoryPage.tsx` | 接入真实 memory API |
| SkillsTab.tsx | `components/SkillsTab.tsx` | 接入真实 skill API |
| **DelegationPanel** | `components/DelegationPanel.tsx` | **NEW**: 展示子 Agent 委派状态和结果（task_description + status + result_content） |
| **CompressionIndicator** | `components/CompressionIndicator.tsx` | **NEW**: 在 TurnTrace 区域展示 compression 事件（pre/post token 数、是否 iterative） |
| **TurnTrace display** | `components/TurnTracePanel.tsx` | **增强**: 新增 error classification events 列表、compression event 卡片、delegation results 列表 |

### 8. 兼容策略

- Station `/ai_chat/*` 路由保留 **6 个月** 作为别名，内部 HTTP redirect 到 `/agent/*`
- Tauri 通信层同时支持旧路由和新路由，灰度切换
- 数据库做 **ALTER TABLE RENAME**，不做 CREATE + MIGRATE（避免数据拷贝风险）
- 配置文件 `sub_aichat.yml` 保留，新增 `sub_agent.yml`，优先读取新配置，fallback 到旧配置
- Desktop API layer 保留 `streamChat` 函数签名 **3 个月**，标记 `@deprecated`

## 步骤

### Phase 1: 目录与骨架（存量迁移）

1. 创建 `apps/station/app/subserver/agent/` 目录结构（handler / service / domain / infrastructure / proto）
2. 迁移 provider 相关代码到 `infrastructure/provider/`
3. 迁移 session / message handler 和 service 到新目录
4. 将 `CompleteChat` 重构为 `turn_service.ExecuteTurn`（保留原有逻辑，先不加新能力）
5. 迁移 domain 对象：`session.go` → `conversation.go`，`message.go` → `conversation.go`
6. 执行数据库迁移脚本（ALTER TABLE RENAME）
7. 注册 `/ai_chat` 兼容别名路由

### Phase 2: 新 service 创建

8. 创建 `domain/error.go` — `FailoverReason`（12 种 enum）+ `ClassifiedError` 领域对象
9. 创建 `service/error_classifier_service.go` — 完整分类管线 + pattern 列表
10. 创建 `domain/credential.go` — `CredentialEntry`, `RotationStrategy`
11. 创建 `service/credential_pool_service.go` — 多 key 轮换 + cooldown + lease
12. 创建 `agent_credential_pool` 表
13. 创建 `service/compression_service.go` — 完整 9 步流程
14. 创建 `domain/delegation.go` — `DelegationResult`, `DelegationTask`
15. 创建 `service/delegation_service.go` — goroutine 子 Agent 编排 + errgroup
16. 创建 `service/context_reference_service.go` — @file/@folder/@url/@diff/@staged 解析

### Phase 3: turn loop 集成

17. 在 `turn_service.go` 中集成 error classifier retry loop
18. 在 `turn_service.go` 中集成 compression trigger（ShouldCompress → Compress 流程）
19. 在 `turn_service.go` 中集成 credential rotation（ShouldRotateCredential → MarkExhaustedAndRotate）
20. 在 `turn_service.go` 中集成 delegation 支持（delegate_task tool call → delegation_service）
21. 在 `turn_service.go` 中集成 context reference 解析（turn 开始时解析 user message 中的 @ 引用）

### Phase 4: Proto + TurnTrace 扩展

22. 更新 `agent.proto`：新增 `ClassifiedErrorEvent`、`CompressionEvent`、`DelegationRequest`、`DelegationResult` message
23. 在 `TurnTrace` 中新增 `error_classified`、`compression_event`、`delegation_results` 字段
24. 生成 Go + TypeScript protobuf 代码

### Phase 5: Tauri 层

25. 更新 Tauri 层路由（`/ai_chat` → `/agent`）
26. Tauri 通信层支持新 TurnTrace 字段的透传

### Phase 6: Desktop 层

27. 更新 Desktop API 层（`streamChat` → `executeAgentTurn`）
28. 创建 `DelegationPanel` 组件 — 展示子 Agent 委派状态和结果
29. 创建 `CompressionIndicator` 组件 — 展示 compression 事件
30. 增强 `TurnTracePanel` — 新增 error classification events、compression event、delegation results 展示

### Phase 7: 清理

31. 删除旧的 `subserver/ai_chat` 目录
32. 标记 `sub_aichat.yml` 为 deprecated
33. 标记 Desktop `streamChat` 为 `@deprecated`

## 验收标准

### 存量功能

- [ ] 旧的聊天补全功能在新 agent subserver 下正常工作
- [ ] `/ai_chat/*` 路由仍可访问（兼容别名 redirect 到 `/agent/*`）
- [ ] `/agent/turn/execute` 返回完整 `TurnTrace`（含所有新字段）
- [ ] Desktop ChatPage 通过新 API 正常对话
- [ ] 数据库迁移后旧数据可正常读取（agent_conversations / agent_messages）
- [ ] MemoryPage 和 SkillsTab 接入真实 API

### Error Recovery

- [ ] `error_classifier_service.go` 就位，12 种 FailoverReason 全部覆盖
- [ ] API 错误被自动分类，retry / compress / rotate / fallback 策略正确执行
- [ ] TurnTrace 中可见 `error_classified` 事件列表

### Context Compression

- [ ] `compression_service.go` 就位，完整 9 步流程实现
- [ ] 长对话触达 50% context window 时自动触发 compression
- [ ] Desktop `CompressionIndicator` 展示 pre/post token 数
- [ ] TurnTrace 中可见 `compression_event`

### Delegation

- [ ] `delegation_service.go` 就位，支持子 Agent 并发编排
- [ ] DELEGATE_BLOCKED_TOOLS 过滤生效（子 Agent 不能 delegate / memory / send_message）
- [ ] MAX_CONCURRENT_CHILDREN=3、MAX_DEPTH=2 约束生效
- [ ] Desktop `DelegationPanel` 展示子 Agent 执行状态和结果
- [ ] TurnTrace 中可见 `delegation_results`

### Credential Pool

- [ ] `credential_pool_service.go` 就位，支持多 key 轮换
- [ ] `agent_credential_pool` 表创建成功，不存 secret
- [ ] 凭证 exhausted 后进入 1h cooldown，cooldown 结束后自动恢复
- [ ] 并发子 Agent 场景下 lease 机制正常工作

### Context Reference

- [ ] `context_reference_service.go` 就位
- [ ] @file、@folder、@url、@diff、@staged 五种引用类型均可正确解析并注入 context

### Desktop 新组件

- [ ] `DelegationPanel` 可见子 Agent task description + status + result
- [ ] `CompressionIndicator` 在 compression 触发时显示
- [ ] `TurnTracePanel` 增强版展示 error classification events、compression event、delegation results
