# Agent Workspace OSS 托管与配置拆解架构

> Agent 资源存储架构调整：Workspace 上移 Station 用 OSS 托管，config_json 拆解为结构化表，支持双端同步。
>
> **Capability binding supersession (2026-08-28)**: 本文第 4 节中的
> `AgentKnowledgeBinding` / `AgentSkillBinding` / `AgentMcpBinding` 写入 API
> 已由 `modern-chat-agent/decisions.md` 的 MCA-D15/MCA-D15K 取代。当前唯一
> binding authority 是 `capability.proto` 中的 `AgentCapabilityBinding`；
> 旧表和 `config_json` 字段仅作为受限迁移输入，不再提供 mutation contract。

---

## 1. 目标

### 1.1 核心目标
- Workspace 成为 Station 真源，支持双端同步（Desktop ↔ Mobile）
- 统一 Workspace 存储模型：目录型 / Git 型都通过 OSS 托管
- Agent 配置从 `config_json` blob 拆解为结构化表，支持细粒度查询和增量同步
- 建立事件驱动的同步机制，实现双端数据一致性

### 1.2 非目标
- 不改变现有 UI 层实现（React 组件、Zustand store）
- 不实现完整的离线队列（Phase 4 单独处理）
- 不涉及 Federation（跨 Station）同步

---

## 2. 架构原则

| 原则 | 说明 |
|------|------|
| **Station 为单一真源** | 所有跨端数据由 Station 持久化，端侧仅存加速副本 |
| **OSS 直传** | Workspace 文件端侧直传 OSS，Station 只管理元数据和签名 |
| **增量优先** | 同步优先采用增量模式，全量同步仅用于首次加载 |
| **向后兼容** | `config_json` 保留作为快照，新表并行写入 |
| **Proto-First** | 所有数据模型首先在 `model/domain/*.proto` 定义 |

---

## 3. Workspace OSS 托管方案

### 3.1 统一存储模型

| Workspace 类型 | OSS 存储形式 | 说明 |
|---------------|-------------|------|
| **目录型** | 普通对象（文件树扁平化） | 每个文件一个 OSS Object，key 格式：`<oss_prefix>/<relative_path>` |
| **Git 型** | 裸仓库打包 + 增量 commit | `.git/` 目录也存 OSS，作为特殊的目录型处理 |

**Station 不运行 git 进程，只做对象存储托管。Git 操作在端侧本地完成。**

### 3.2 目录结构

```
OSS Bucket: peers-touch-workspace
├── {actor_id}/
│   ├── {agent_id}/
│   │   ├── {workspace_id}/
│   │   │   ├── file1.txt
│   │   │   ├── src/
│   │   │   │   └── main.go
│   │   │   └── .git/
│   │   │       ├── HEAD
│   │   │       ├── objects/
│   │   │       └── refs/
```

### 3.3 数据模型（Proto）

新增 `model/domain/agent/workspace.proto`：

```protobuf
syntax = "proto3";

package peers_touch.model.agent.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/peers-labs/peers-touch/station/app/subserver/agent/model;model";

enum WorkspaceType {
  WORKSPACE_TYPE_UNSPECIFIED = 0;
  WORKSPACE_TYPE_DIRECTORY = 1;
  WORKSPACE_TYPE_GIT = 2;
}

enum WorkspaceStorageBackend {
  WORKSPACE_STORAGE_BACKEND_UNSPECIFIED = 0;
  WORKSPACE_STORAGE_BACKEND_OSS = 1;
  WORKSPACE_STORAGE_BACKEND_LOCAL = 2;
}

message Workspace {
  string id = 1;
  string agent_id = 2;
  string name = 3;
  WorkspaceType type = 4;
  WorkspaceStorageBackend storage_backend = 5;
  string oss_bucket = 6;
  string oss_prefix = 7;
  int64 total_bytes = 8;
  int32 file_count = 9;
  google.protobuf.Timestamp last_sync_at = 10;
  string last_synced_device = 11;
  map<string, string> meta = 12;
  google.protobuf.Timestamp created_at = 13;
  google.protobuf.Timestamp updated_at = 14;
}

message WorkspaceFile {
  string id = 1;
  string workspace_id = 2;
  string path = 3;
  int64 size = 4;
  string sha256 = 5;
  string mime_type = 6;
  google.protobuf.Timestamp last_modified_at = 7;
  google.protobuf.Timestamp created_at = 8;
  google.protobuf.Timestamp updated_at = 9;
}

message WorkspaceChange {
  string path = 1;
  string change_type = 2; // added | modified | deleted
  optional int64 size = 3;
  optional string sha256 = 4;
  optional string mime_type = 5;
}

// ── API ──

message CreateWorkspaceRequest {
  string agent_id = 1;
  string name = 2;
  WorkspaceType type = 3;
  map<string, string> meta = 4;
}

message CreateWorkspaceResponse {
  Workspace workspace = 1;
}

message GetWorkspaceRequest {
  string id = 1;
}

message GetWorkspaceResponse {
  Workspace workspace = 1;
  repeated WorkspaceFile files = 2;
}

message ListWorkspacesRequest {
  string agent_id = 1;
  int32 page = 2;
  int32 page_size = 3;
}

message ListWorkspacesResponse {
  repeated Workspace workspaces = 1;
  int32 total = 2;
}

message UpdateWorkspaceRequest {
  string id = 1;
  optional string name = 2;
  map<string, string> meta = 3;
}

message UpdateWorkspaceResponse {
  Workspace workspace = 1;
}

message DeleteWorkspaceRequest {
  string id = 1;
}

message DeleteWorkspaceResponse {
  bool success = 1;
}

message GetWorkspaceFilesRequest {
  string workspace_id = 1;
  optional string since = 2; // RFC3339 timestamp
  int32 page = 3;
  int32 page_size = 4;
}

message GetWorkspaceFilesResponse {
  repeated WorkspaceFile files = 1;
  int32 total = 2;
  string next_cursor = 3;
}

message GetWorkspaceFileDiffRequest {
  string workspace_id = 1;
  string since = 2; // RFC3339 timestamp
}

message GetWorkspaceFileDiffResponse {
  repeated WorkspaceChange changed = 1;
  repeated string deleted = 2;
}

message GetWorkspaceFileUploadUrlRequest {
  string workspace_id = 1;
  string path = 2;
  int64 content_length = 3;
  string content_type = 4;
  string content_sha256 = 5;
}

message GetWorkspaceFileUploadUrlResponse {
  string url = 1;
  string path = 2;
  int64 expires_in = 3;
}

message GetWorkspaceFileDownloadUrlRequest {
  string workspace_id = 1;
  string path = 2;
}

message GetWorkspaceFileDownloadUrlResponse {
  string url = 1;
  int64 expires_in = 2;
}

message CommitWorkspaceChangesRequest {
  string workspace_id = 1;
  repeated WorkspaceChange changes = 2;
  string client_request_id = 3; // 幂等 key
}

message CommitWorkspaceChangesResponse {
  bool success = 1;
  google.protobuf.Timestamp synced_at = 2;
}

message DeleteWorkspaceFilesRequest {
  string workspace_id = 1;
  repeated string paths = 2;
}

message DeleteWorkspaceFilesResponse {
  bool success = 1;
}
```

### 3.4 同步协议

```
端侧                               Station + OSS
  │                                    │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  pull (增量拉取)                                        │
  │  │  GET /agent/workspace/{id}/diff?since=<last_sync_at>    │
  │  └─────────────────────────────────────────────────────────┘
  │                                    │
  │                                    ├─ 查询 file 表变更列表
  │  ◄─────────────────────────────────────────────────────────  │
  │   { changed: [...], deleted: [...] }                        │
  │                                    │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  按需下载变更文件（OSS 直链）                              │
  │  │  GET /agent/workspace/{id}/file/download?path=X         │
  │  └─────────────────────────────────────────────────────────┘
  │                                    │
  │                                    ├─ 返回 presigned download URL
  │  ◄─────────────────────────────────────────────────────────  │
  │   { url: "https://oss/..." }                               │
  │                                    │
  │  ┌─────────────────────────────────────────────────────────┐
  │  │  push (增量上传)                                        │
  │  │  1. 获取上传签名 URL                                     │
  │  │     POST /agent/workspace/{id}/file/upload              │
  │  │  2. 端侧直传 OSS                                        │
  │  │  3. 提交变更确认                                         │
  │  │     POST /agent/workspace/{id}/commit                   │
  │  └─────────────────────────────────────────────────────────┘
  │                                    │
  │                                    ├─ 更新 file 表 + last_sync_at
  │                                    ├─ 发布 workspace.changed 事件
  │  ◄─────────────────────────────────────────────────────────  │
  │   { success: true, synced_at: "..." }                      │
```

### 3.5 事件定义

| 事件类型 | 触发时机 | Payload |
|---------|---------|---------|
| `agent.workspace.created` | Workspace 创建 | `workspace_id`, `agent_id`, `name` |
| `agent.workspace.updated` | Workspace 更新 | `workspace_id`, `updated_fields` |
| `agent.workspace.deleted` | Workspace 删除 | `workspace_id` |
| `agent.workspace.changed` | 文件变更提交 | `workspace_id`, `change_count`, `synced_at` |

---

## 4. config_json 拆解方案

### 4.1 当前问题

`Agent.config_json` 包含：
- chatConfig（历史长度、压缩策略、搜索模式、memory 配置、voice 配置）
- params（temperature、top_p、max_tokens）
- knowledgeResources（知识资源列表）
- toolsProfile / toolsAllow / toolsDeny
- mcpServers / skills

导致：
- 无法做数据库级查询
- 无法做细粒度增量更新
- 同步时只能全量覆盖

### 4.2 拆解后的表结构

新增 `model/domain/agent/agent_config.proto`：

```protobuf
syntax = "proto3";

package peers_touch.model.agent.v1;

import "google/protobuf/timestamp.proto";

option go_package = "github.com/peers-labs/peers-touch/station/app/subserver/agent/model;model";

// ── Agent Chat Config ──

message AgentChatConfig {
  string agent_id = 1;
  int32 history_count = 2;
  bool enable_history_count = 3;
  bool enable_auto_create_topic = 4;
  int32 auto_create_topic_threshold = 5;
  bool enable_max_tokens = 6;
  bool enable_streaming = 7;
  bool enable_context_compression = 8;
  string compression_model_id = 9;
  int32 context_window_size = 10;
  string search_mode = 11; // off | auto | on
  bool use_model_builtin_search = 12;
  google.protobuf.Timestamp updated_at = 13;
}

// ── Agent Model Params ──

message AgentModelParams {
  string agent_id = 1;
  double temperature = 2;
  double top_p = 3;
  double frequency_penalty = 4;
  double presence_penalty = 5;
  int32 max_tokens = 6;
  google.protobuf.Timestamp updated_at = 13;
}

// ── Agent Knowledge Binding ──

message AgentKnowledgeBinding {
  string id = 1;
  string agent_id = 2;
  string resource_id = 3;
  string policy = 4; // manual | auto | always | disabled
  bool enabled = 5;
  google.protobuf.Timestamp created_at = 6;
  google.protobuf.Timestamp updated_at = 7;
}

// ── Agent Skill Binding ──

message AgentSkillBinding {
  string id = 1;
  string agent_id = 2;
  string skill_id = 3;
  bool enabled = 4;
  google.protobuf.Timestamp created_at = 5;
  google.protobuf.Timestamp updated_at = 6;
}

// ── Agent MCP Binding ──

message AgentMcpBinding {
  string id = 1;
  string agent_id = 2;
  string server_name = 3;
  bool enabled = 4;
  google.protobuf.Timestamp created_at = 5;
  google.protobuf.Timestamp updated_at = 6;
}

// ── Agent Voice Config ──

message AgentVoiceConfig {
  string agent_id = 1;
  string tts_provider = 2; // browser | edge | openai
  string tts_voice = 3;
  double tts_speed = 4;
  bool tts_auto_read = 5;
  string stt_provider = 6; // browser | openai
  string stt_language = 7;
  bool stt_auto_stop = 8;
  google.protobuf.Timestamp updated_at = 9;
}

// ── Agent Tool Profile ──

message AgentToolProfile {
  string agent_id = 1;
  string profile = 2;
  string allow = 3;
  string deny = 4;
  google.protobuf.Timestamp updated_at = 5;
}

// ── API ──

// AgentChatConfig
message GetAgentChatConfigRequest { string agent_id = 1; }
message GetAgentChatConfigResponse { AgentChatConfig config = 1; }
message UpdateAgentChatConfigRequest { AgentChatConfig config = 1; }
message UpdateAgentChatConfigResponse { AgentChatConfig config = 1; }

// AgentModelParams
message GetAgentModelParamsRequest { string agent_id = 1; }
message GetAgentModelParamsResponse { AgentModelParams params = 1; }
message UpdateAgentModelParamsRequest { AgentModelParams params = 1; }
message UpdateAgentModelParamsResponse { AgentModelParams params = 1; }

// AgentKnowledgeBinding
message ListAgentKnowledgeBindingsRequest { string agent_id = 1; }
message ListAgentKnowledgeBindingsResponse { repeated AgentKnowledgeBinding bindings = 1; }
message CreateAgentKnowledgeBindingRequest { AgentKnowledgeBinding binding = 1; }
message CreateAgentKnowledgeBindingResponse { AgentKnowledgeBinding binding = 1; }
message UpdateAgentKnowledgeBindingRequest { AgentKnowledgeBinding binding = 1; }
message UpdateAgentKnowledgeBindingResponse { AgentKnowledgeBinding binding = 1; }
message DeleteAgentKnowledgeBindingRequest { string id = 1; }
message DeleteAgentKnowledgeBindingResponse { bool success = 1; }

// AgentSkillBinding
message ListAgentSkillBindingsRequest { string agent_id = 1; }
message ListAgentSkillBindingsResponse { repeated AgentSkillBinding bindings = 1; }
message CreateAgentSkillBindingRequest { AgentSkillBinding binding = 1; }
message CreateAgentSkillBindingResponse { AgentSkillBinding binding = 1; }
message UpdateAgentSkillBindingRequest { AgentSkillBinding binding = 1; }
message UpdateAgentSkillBindingResponse { AgentSkillBinding binding = 1; }
message DeleteAgentSkillBindingRequest { string id = 1; }
message DeleteAgentSkillBindingResponse { bool success = 1; }

// AgentMcpBinding
message ListAgentMcpBindingsRequest { string agent_id = 1; }
message ListAgentMcpBindingsResponse { repeated AgentMcpBinding bindings = 1; }
message CreateAgentMcpBindingRequest { AgentMcpBinding binding = 1; }
message CreateAgentMcpBindingResponse { AgentMcpBinding binding = 1; }
message UpdateAgentMcpBindingRequest { AgentMcpBinding binding = 1; }
message UpdateAgentMcpBindingResponse { AgentMcpBinding binding = 1; }
message DeleteAgentMcpBindingRequest { string id = 1; }
message DeleteAgentMcpBindingResponse { bool success = 1; }

// AgentVoiceConfig
message GetAgentVoiceConfigRequest { string agent_id = 1; }
message GetAgentVoiceConfigResponse { AgentVoiceConfig config = 1; }
message UpdateAgentVoiceConfigRequest { AgentVoiceConfig config = 1; }
message UpdateAgentVoiceConfigResponse { AgentVoiceConfig config = 1; }

// AgentToolProfile
message GetAgentToolProfileRequest { string agent_id = 1; }
message GetAgentToolProfileResponse { AgentToolProfile profile = 1; }
message UpdateAgentToolProfileRequest { AgentToolProfile profile = 1; }
message UpdateAgentToolProfileResponse { AgentToolProfile profile = 1; }
```

### 4.3 迁移策略

| 阶段 | 内容 | 说明 |
|------|------|------|
| Phase 1 | 新增表 + 并行写入 | 读写走新表，异步回写 `config_json` 兼容老代码 |
| Phase 2 | 代码迁移 | API 层切换到新表，旧接口标记 deprecated |
| Phase 3 | 清理 | 删除 `config_json` 字段，移除旧接口 |

### 4.4 配置变更事件

| 事件类型 | 触发时机 | Payload |
|---------|---------|---------|
| `agent.config.chat_updated` | ChatConfig 更新 | `agent_id`, `updated_fields` |
| `agent.config.params_updated` | ModelParams 更新 | `agent_id` |
| `agent.knowledge.added` | 知识资源绑定 | `agent_id`, `resource_id` |
| `agent.knowledge.removed` | 知识资源解绑 | `agent_id`, `resource_id` |
| `agent.skill.bound` | Skill 绑定 | `agent_id`, `skill_id`, `enabled` |
| `agent.skill.unbound` | Skill 解绑 | `agent_id`, `skill_id` |
| `agent.mcp.bound` | MCP 绑定 | `agent_id`, `server_name`, `enabled` |
| `agent.mcp.unbound` | MCP 解绑 | `agent_id`, `server_name` |

---

## 5. 端侧架构调整

### 5.1 Desktop 端

```
apps/desktop/src/
├── store/
│   └── workspace.ts          # Workspace store（新增）
├── services/
│   └── workspace-service.ts  # Workspace API 封装（新增）
├── runtimes/
│   └── agentWorkspaceRuntime.ts  # Workspace 运行时（新增）
└── components/
    └── AgentResourceManagement.tsx  # 已有，更新适配新 API
```

### 5.2 Mobile 端

```
apps/mobile/src/
├── store/
│   └── workspace.ts          # Workspace store（新增）
├── services/
│   └── workspace-service.ts  # Workspace API 封装（新增）
└── runtimes/
    └── agentWorkspaceRuntime.ts  # Workspace 运行时（新增）
```

### 5.3 同步逻辑

```
端侧同步流程（通用）
    │
    ├── 1. 启动时：全量拉取 Workspace 列表 + 文件清单
    │
    ├── 2. 监听 SSE 事件：
    │   ├── workspace.created → 添加到本地列表
    │   ├── workspace.changed → 触发增量拉取
    │   └── workspace.deleted → 从本地移除
    │
    ├── 3. 用户操作：
    │   ├── 创建/更新/删除 → 调用 Station API
    │   └── 文件操作 → 直传 OSS + commit
    │
    └── 4. 定时同步：每 5 分钟检查 last_sync_at，必要时增量拉取
```

---

## 6. 实施约束

### 6.1 数据库约束

| 约束 | 说明 |
|------|------|
| `agent_workspace.agent_id` | NOT NULL, INDEX |
| `agent_workspace_file.workspace_id` | NOT NULL, INDEX |
| `agent_workspace_file.path` | NOT NULL, UNIQUE (workspace_id, path) |
| `agent_knowledge_binding.agent_id + resource_id` | UNIQUE |
| `agent_skill_binding.agent_id + skill_id` | UNIQUE |
| `agent_mcp_binding.agent_id + server_name` | UNIQUE |

### 6.2 OSS 约束

| 约束 | 说明 |
|------|------|
| Object key 格式 | `{actor_id}/{agent_id}/{workspace_id}/{relative_path}` |
| 签名 URL 有效期 | 上传 5 分钟，下载 10 分钟 |
| 文件大小上限 | 100MB（与 OSS 子服务一致） |
| 可见性 | private（仅通过签名 URL 访问） |

---

## 7. 验收标准

### 7.1 Workspace 同步
- [ ] Workspace 创建后，双端 5 秒内可见
- [ ] 文件变更提交后，双端 10 秒内同步
- [ ] Git 型 Workspace 的 `.git/` 目录正确同步
- [ ] 端侧离线后重连，自动补齐变更

### 7.2 配置拆解
- [ ] 新增表结构与 Proto 定义一致
- [ ] API 支持细粒度配置更新
- [ ] `config_json` 向后兼容（并行写入）
- [ ] 配置变更事件正确触发

### 7.3 安全性
- [ ] OSS 签名 URL 正确限制权限和有效期
- [ ] 文件操作携带幂等 key，防止重复提交
- [ ] 端侧直传 OSS 不走 Station 数据流

---

## 8. 参考文档

- [Station/Desktop 职责边界](../../platform/station-desktop-boundary.md)
- [多端同步协议](../../../client/mobile/sync-protocol.md)
- [Agent Memory 架构](./agent-memory-architecture.md)
- [统一运行时存储架构](../../platform/runtime/storage.md)
