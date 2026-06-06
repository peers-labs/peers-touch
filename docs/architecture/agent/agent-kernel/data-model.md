# Agent Kernel — 数据模型

> **Status**: draft
> **Version**: 2026.06
> **Created**: 2026-06-06 | **Updated**: 2026-06-06
> **Owner**: Architecture Team
> **Module**: `model/domain/agent/`

---

## 1. 建模原则

1. 所有跨端对象先进入 proto；Go / Rust / TypeScript 不手写平行模型。
2. 运行态对象必须记录 snapshot，避免 profile 后续修改污染已完成 Turn。
3. 语义知识、执行上下文、过程状态三者分离：Memory、Workspace、Thread/Turn 各自独立。
4. Tool / MCP / A2A 都使用 schema 和状态机表达，不用自由文本约定。
5. Growth 事件与 TurnTrace 是一等数据，不作为日志附属品。

---

## 2. Proto 包规划

建议新增目录：

```text
model/domain/agent/
├── agent.proto
├── runtime.proto
├── thread.proto
├── tool.proto
├── memory.proto
├── skill.proto
├── mcp.proto
├── a2a.proto
├── channel.proto
├── growth.proto
└── workspace.proto
```

如果 `model/build.sh` 当前不支持子目录，需要先扩展生成脚本；不要退回到 `model/domain/agent.proto` 巨型文件。

---

## 3. 核心实体

### 3.1 Agent 与 Runtime

```proto
message Agent {
  string id = 1;
  string name = 2;
  string display_name = 3;
  string description = 4;
  AgentStatus status = 5;
  string owner_actor_id = 6;
  string default_runtime_profile_id = 7;
  AgentPersona persona = 8;
  AgentPolicy policy = 9;
  AgentVisibility visibility = 10;
  int64 created_at_unix_ms = 11;
  int64 updated_at_unix_ms = 12;
}

message RuntimeProfile {
  string id = 1;
  string agent_id = 2;
  string name = 3;
  RuntimeKind kind = 4;
  AgentProviderConfig provider = 5;
  CapabilitySet capabilities = 6;
  ToolPolicy tool_policy = 7;
  MemoryPolicy memory_policy = 8;
  SkillPolicy skill_policy = 9;
  WorkspacePolicy workspace_policy = 10;
  map<string, string> launch_config = 11;
}

message AgentProviderConfig {
  string provider_id = 1;
  AgentProviderKind kind = 2;
  ModelBackendConfig model_backend = 3;
  AgentProviderCapabilitySet capabilities = 4;
  AgentProviderControlPolicy control_policy = 5;
  map<string, string> params = 6;
}

message ModelBackendConfig {
  string backend_id = 1;
  ModelBackendKind kind = 2;
  string model_id = 3;
  ModelBackendCapabilitySet capabilities = 4;
  map<string, string> params = 5;
}

message AgentProviderCapabilitySet {
  bool streaming = 1;
  bool station_tool_loop = 2;
  bool structured_output = 3;
  bool tool_result_injection = 4;
  bool system_prompt_control = 5;
  bool message_history_control = 6;
  bool context_window_control = 7;
  bool attachment_control = 8;
  bool stop = 9;
  bool resume = 10;
  bool usage_reporting = 11;
  bool event_trace = 12;
  bool workspace_access = 13;
  bool model_switch = 14;
}

message ModelBackendCapabilitySet {
  bool streaming = 1;
  bool native_tool_calling = 2;
  bool structured_output = 3;
  bool multimodal_input = 4;
  bool reasoning_output = 5;
  bool prompt_cache = 6;
  bool usage_reporting = 7;
  int64 context_window_tokens = 8;
}

message CapabilitySet {
  bool streaming = 1;
  bool native_tool_calling = 2;
  bool tool_approval = 3;
  bool mcp = 4;
  bool a2a = 5;
  bool attachments = 6;
  bool resume = 7;
  bool workspace_context = 8;
  bool local_execution = 9;
}
```

关键点：

- `Agent` 表达“谁”，不直接绑定 provider 细节。
- `RuntimeProfile` 表达“怎么跑”，并可以被多个 Thread snapshot。
- `AgentProviderConfig` 表达“这次 Turn 由哪个 AgentProvider 编排”，AgentProvider 可以是 Kernel-native 或 CLI-wrapped。
- `ModelBackendConfig` 表达“Kernel-native 底层使用哪个模型后端”，例如 OpenAI-compatible、Anthropic、Gemini、Ollama 或自定义网关。
- `AgentProviderCapabilitySet`、`AgentProviderControlPolicy` 和 `ModelBackendCapabilitySet` 是运行时决策来源，不让前端或 handler 按字符串判断具体 CLI 或厂商。

### 3.2 Thread 与 Turn

```proto
message AgentThread {
  string id = 1;
  string agent_id = 2;
  AgentSurface surface = 3;
  ThreadStatus status = 4;
  string title = 5;
  RuntimeProfileSnapshot runtime_snapshot = 6;
  ChannelTarget channel_target = 7;
  WorkspaceContext workspace_context = 8;
  int64 created_at_unix_ms = 9;
  int64 updated_at_unix_ms = 10;
}

message AgentTurn {
  string id = 1;
  string thread_id = 2;
  string agent_id = 3;
  TurnStatus status = 4;
  UserInput input = 5;
  string final_text = 6;
  TurnError error = 7;
  RuntimeProfileSnapshot runtime_snapshot = 8;
  TurnTrace trace = 9;
  int64 started_at_unix_ms = 10;
  int64 ended_at_unix_ms = 11;
}

message TurnEvent {
  string id = 1;
  string turn_id = 2;
  int64 sequence = 3;
  TurnEventKind kind = 4;
  string payload_json = 5;
  int64 created_at_unix_ms = 6;
}
```

`payload_json` 只作为事件多态载荷的过渡形式；稳定后应拆成 `oneof payload`。

### 3.3 Tool

```proto
message ToolDescriptor {
  string name = 1;
  ToolCategory category = 2;
  string owner = 3;
  string description = 4;
  string input_schema_json = 5;
  string output_schema_json = 6;
  ToolRiskLevel risk_level = 7;
  bool approval_required = 8;
  repeated string capability_tags = 9;
}

message ToolCall {
  string id = 1;
  string turn_id = 2;
  string tool_name = 3;
  string arguments_json = 4;
  ToolCallStatus status = 5;
  string result_json = 6;
  ToolApproval approval = 7;
  TurnError error = 8;
  int64 started_at_unix_ms = 9;
  int64 ended_at_unix_ms = 10;
}
```

工具输入输出必须有 schema；对外展示可做摘要，但审计记录需要能回溯。

### 3.4 Memory

```proto
message MemoryItem {
  string id = 1;
  MemoryScope scope = 2;
  string owner_id = 3;
  MemoryLayer layer = 4;
  string content = 5;
  repeated string tags = 6;
  double trust_score = 7;
  MemorySource source = 8;
  string source_turn_id = 9;
  MemoryStatus status = 10;
  int64 created_at_unix_ms = 11;
  int64 updated_at_unix_ms = 12;
}

message MemorySnapshot {
  string id = 1;
  string agent_id = 2;
  string thread_id = 3;
  repeated string memory_item_ids = 4;
  string content_hash = 5;
  int64 created_at_unix_ms = 6;
}
```

`MemorySnapshot` 是 Turn 可重放和 Growth 归因的关键。

### 3.5 Skill

```proto
message SkillPackage {
  string id = 1;
  string name = 2;
  SkillSource source = 3;
  SkillVisibility visibility = 4;
  string version = 5;
  string source_uri = 6;
  SkillPackageStatus status = 7;
  int64 created_at_unix_ms = 8;
  int64 updated_at_unix_ms = 9;
}

message SkillRecord {
  string id = 1;
  string package_id = 2;
  string identifier = 3;
  string title = 4;
  string description = 5;
  string content = 6;
  repeated string tags = 7;
  SkillRiskLevel risk_level = 8;
  SkillStatus status = 9;
  int64 version = 10;
}
```

Skill 的内容可先存 DB；后续如引入文件系统包，需要 DB 记录 source root 与内容 hash，避免 UI 与运行时看到不一致版本。

### 3.6 MCP、A2A 与 Growth

```proto
message MCPServer {
  string id = 1;
  string name = 2;
  MCPTransport transport = 3;
  string endpoint = 4;
  MCPAuth auth = 5;
  MCPServerStatus status = 6;
  repeated ToolDescriptor projected_tools = 7;
  int64 last_checked_at_unix_ms = 8;
}

message A2ATask {
  string id = 1;
  string context_id = 2;
  string caller_agent_id = 3;
  string target_agent_id = 4;
  A2ATaskStatus status = 5;
  string parent_turn_id = 6;
  string child_thread_id = 7;
  string artifact_json = 8;
}

message TurnTrace {
  string id = 1;
  string turn_id = 2;
  string system_prompt_hash = 3;
  string memory_snapshot_id = 4;
  string skill_index_hash = 5;
  repeated string used_memory_item_ids = 6;
  repeated string used_skill_ids = 7;
  repeated ToolCall tool_calls = 8;
  repeated ProviderCall provider_calls = 9;
  repeated GrowthEvent growth_events = 10;
}

message GrowthReport {
  string id = 1;
  string agent_id = 2;
  GrowthVerdict verdict = 3;
  double composite_score = 4;
  repeated GrowthMetric metrics = 5;
  repeated CorrectionProposal proposals = 6;
  int64 created_at_unix_ms = 7;
}
```

MCP tool 投影后仍进入 Station `ToolDescriptor`，统一走 tool policy、approval 与 TurnTrace。A2A context 可以映射到 `AgentThread`，但 A2A Task 状态必须独立记录。

---

## 4. 状态机

### 4.1 TurnStatus

```text
queued -> preparing -> running -> waiting_approval -> running -> completed
                                      |              -> failed
                                      |              -> cancelled
                                      -> expired
```

规则：

- `waiting_approval` 不等于失败，UI 必须显示可操作审批卡。
- `cancelled` 必须记录取消来源：user、system、timeout、shutdown。
- `failed` 必须带 typed error code。

### 4.2 ToolCallStatus

```text
created -> policy_checked -> waiting_approval -> executing -> completed
                         |                    -> rejected
                         |                    -> expired
                         -> denied
                         -> failed
```

规则：

- policy deny 与 tool 执行失败区分。
- approval rejected 与 expired 区分。
- 工具输出太大时只截断展示，不截断审计摘要和 artifact 引用。

### 4.3 MemoryStatus

```text
active -> suspected -> frozen -> archived
active -> archived
active -> deleted
```

规则：

- `deleted` 是用户显式删除。
- `archived` 是系统不再召回但保留审计。
- `frozen` 是暂时禁止修改/召回，等待人工确认。

---

## 5. 持久化边界

| 数据 | 建议表 | 真源 | 备注 |
|------|--------|------|------|
| Agent | `agent_agents` | Station DB | 逻辑定义 |
| RuntimeProfile | `agent_runtime_profiles` | Station DB | 可被 Thread snapshot |
| Thread | `agent_threads` | Station DB | Web / Channel / A2A 统一 |
| Turn | `agent_turns` | Station DB | 单轮执行 |
| TurnEvent | `agent_turn_events` | Station DB | stream replay |
| ToolCall | `agent_tool_calls` | Station DB | 审计与 UI |
| MemoryItem | `agent_memory_items` | Station DB | 长期语义 |
| MemorySnapshot | `agent_memory_snapshots` | Station DB | Turn freeze |
| SkillPackage | `agent_skill_packages` | Station DB | 包元信息 |
| SkillRecord | `agent_skills` | Station DB / optional FS | 内容与索引 |
| MCPServer | `agent_mcp_servers` | Station DB | 连接配置 |
| A2ATask | `agent_a2a_tasks` | Station DB | 协作状态 |
| GrowthEvent | `agent_growth_events` | Station DB | 原子事件 |
| GrowthReport | `agent_growth_reports` | Station DB | 汇总报告 |

---

## 6. Projection 模型

Desktop Web 不直接拼接 DB 对象，而消费 Station projection：

| Projection | 用途 |
|------------|------|
| `AgentListProjection` | Agent Center 列表、状态、最近运行 |
| `AgentProfileProjection` | Profile 页配置与能力矩阵 |
| `ThreadListProjection` | Chat 侧边栏 |
| `ThreadDetailProjection` | ConversationFlow、运行态、审批卡 |
| `ToolApprovalProjection` | 待审批工具聚合 |
| `MemoryProjection` | Memory Library |
| `SkillProjection` | Skill Library |
| `GrowthProjection` | Growth Dashboard |

Projection 可以由 HTTP 拉取 + event stream 增量刷新，所有新鲜度归 `agentRuntime` 管。
