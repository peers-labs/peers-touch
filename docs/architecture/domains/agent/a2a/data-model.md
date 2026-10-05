# A2A 协议集成 — 数据模型

> **Status**: draft
> **Version**: v2.0
> **Created**: 2026-04-18 | **Updated**: 2026-04-20
> **Owner**: Architecture Team

---

## 1. 协议层数据结构

> Proto-First 原则：以下结构最终须在 `model/domain/agent/a2a.proto` 中定义，Go 结构作为设计阶段的表达。

### 1.1 AgentCard

```go
// frame/core/agent/types.go

type AgentCard struct {
    Name                string                     `json:"name"`
    Description         string                     `json:"description"`
    Version             string                     `json:"version"`
    SupportedInterfaces []AgentInterface            `json:"supportedInterfaces"`
    DocumentationURL    string                     `json:"documentationUrl,omitempty"`
    IconURL             string                     `json:"iconUrl,omitempty"`
    Provider            *AgentProvider             `json:"provider,omitempty"`
    Capabilities        AgentCapabilities          `json:"capabilities"`
    SecuritySchemes     map[string]SecurityScheme  `json:"securitySchemes,omitempty"`
    SecurityRequirements []SecurityRequirement     `json:"securityRequirements,omitempty"`
    DefaultInputModes   []string                   `json:"defaultInputModes"`
    DefaultOutputModes  []string                   `json:"defaultOutputModes"`
    Skills              []AgentSkill               `json:"skills,omitempty"`
}

type AgentInterface struct {
    URL             string `json:"url"`
    ProtocolBinding string `json:"protocolBinding"` // "JSONRPC"
    ProtocolVersion string `json:"protocolVersion"` // "1.0"
}

// SecurityRequirement — OpenAPI Security Requirement Object 语义
// 数组成员之间是 OR 关系，map 内多 scheme 是 AND 关系
type SecurityRequirement map[string][]string

type AgentProvider struct {
    Organization string `json:"organization"`
    URL          string `json:"url,omitempty"`
}

type AgentCapabilities struct {
    Streaming              bool             `json:"streaming"`
    PushNotifications      bool             `json:"pushNotifications"`
    StateTransitionHistory bool             `json:"stateTransitionHistory"`
    ExtendedAgentCard      bool             `json:"extendedAgentCard,omitempty"`
    Extensions             []AgentExtension `json:"extensions,omitempty"`
}

type AgentExtension struct {
    URI         string         `json:"uri"`
    Description string         `json:"description,omitempty"`
    Required    bool           `json:"required,omitempty"`
    Params      map[string]any `json:"params,omitempty"`
}

type AgentSkill struct {
    ID          string   `json:"id"`
    Name        string   `json:"name"`
    Description string   `json:"description"`
    Tags        []string `json:"tags,omitempty"`
    Examples    []string `json:"examples,omitempty"`
    InputModes  []string `json:"inputModes,omitempty"`
    OutputModes []string `json:"outputModes,omitempty"`
}
```

### 1.2 SecurityScheme

```go
// SecurityScheme — discriminated union (OneOf)
type SecurityScheme struct {
    APIKey        *APIKeySecurityScheme        `json:"apiKeySecurityScheme,omitempty"`
    HTTPAuth      *HTTPAuthSecurityScheme      `json:"httpAuthSecurityScheme,omitempty"`
    OAuth2        *OAuth2SecurityScheme        `json:"oauth2SecurityScheme,omitempty"`
    OpenIDConnect *OpenIDConnectSecurityScheme `json:"openIdConnectSecurityScheme,omitempty"`
    MTLS          *MTLSSecurityScheme          `json:"mtlsSecurityScheme,omitempty"`
}

type APIKeySecurityScheme struct {
    Name string `json:"name"`
    In   string `json:"in"` // "header" | "query" | "cookie"
}

type HTTPAuthSecurityScheme struct {
    Scheme       string `json:"scheme"`
    BearerFormat string `json:"bearerFormat,omitempty"`
}

type OAuth2SecurityScheme struct {
    Flows map[string]any `json:"flows"`
}

type OpenIDConnectSecurityScheme struct {
    OpenIDConnectURL string `json:"openIdConnectUrl"`
}

type MTLSSecurityScheme struct{}
```

---

## 2. Task / Message / Artifact

### 2.1 Task 与 TaskStatus

```go
// frame/core/agent/task.go

type TaskState string

const (
    TaskStateUnspecified   TaskState = "TASK_STATE_UNSPECIFIED"
    TaskStateSubmitted     TaskState = "TASK_STATE_SUBMITTED"
    TaskStateWorking       TaskState = "TASK_STATE_WORKING"
    TaskStateInputRequired TaskState = "TASK_STATE_INPUT_REQUIRED"
    TaskStateAuthRequired  TaskState = "TASK_STATE_AUTH_REQUIRED"
    TaskStateCompleted     TaskState = "TASK_STATE_COMPLETED"     // terminal
    TaskStateFailed        TaskState = "TASK_STATE_FAILED"        // terminal
    TaskStateCanceled      TaskState = "TASK_STATE_CANCELED"      // terminal
    TaskStateRejected      TaskState = "TASK_STATE_REJECTED"      // terminal
)

type TaskStatus struct {
    State     TaskState `json:"state"`
    Message   *Message  `json:"message,omitempty"`
    Timestamp string    `json:"timestamp"`         // RFC3339
}

type Task struct {
    ID        string         `json:"id"`
    ContextID string         `json:"contextId"`
    Status    TaskStatus     `json:"status"`
    History   []Message      `json:"history,omitempty"`
    Artifacts []Artifact     `json:"artifacts,omitempty"`
    Metadata  map[string]any `json:"metadata,omitempty"`
}
```

### 2.2 Message、Part 与 Artifact

```go
// frame/core/agent/message.go

type Message struct {
    MessageID        string         `json:"messageId"`
    Role             string         `json:"role"`               // "ROLE_USER" | "ROLE_AGENT"
    Parts            []Part         `json:"parts"`
    ContextID        string         `json:"contextId,omitempty"`
    TaskID           string         `json:"taskId,omitempty"`
    ReferenceTaskIDs []string       `json:"referenceTaskIds,omitempty"`
    Extensions       []string       `json:"extensions,omitempty"`
    Metadata         map[string]any `json:"metadata,omitempty"`
}

// Part — tagged union, 以 Kind 字段判别类型
type Part struct {
    Text      string         `json:"text,omitempty"`
    Raw       string         `json:"raw,omitempty"`       // base64 bytes
    URL       string         `json:"url,omitempty"`
    Data      any            `json:"data,omitempty"`
    Filename  string         `json:"filename,omitempty"`
    MediaType string         `json:"mediaType,omitempty"`
    Metadata  map[string]any `json:"metadata,omitempty"`
}

type Artifact struct {
    ArtifactID  string         `json:"artifactId"`
    Name        string         `json:"name,omitempty"`
    Description string         `json:"description,omitempty"`
    Parts       []Part         `json:"parts"`
    Index       int            `json:"index,omitempty"`
    Extensions  []string       `json:"extensions,omitempty"`
    Metadata    map[string]any `json:"metadata,omitempty"`
}
```

---

## 3. 流式事件

```go
// frame/core/agent/stream.go

type StreamResponse struct {
    Task           *Task                     `json:"task,omitempty"`
    Message        *Message                  `json:"message,omitempty"`
    StatusUpdate   *TaskStatusUpdateEvent    `json:"statusUpdate,omitempty"`
    ArtifactUpdate *TaskArtifactUpdateEvent  `json:"artifactUpdate,omitempty"`
}

type TaskStatusUpdateEvent struct {
    TaskID    string         `json:"taskId"`
    ContextID string         `json:"contextId"`
    Status    TaskStatus     `json:"status"`
    Metadata  map[string]any `json:"metadata,omitempty"`
}

type TaskArtifactUpdateEvent struct {
    TaskID    string         `json:"taskId"`
    ContextID string         `json:"contextId"`
    Artifact  Artifact       `json:"artifact"`
    Append    bool           `json:"append,omitempty"`
    LastChunk bool           `json:"lastChunk,omitempty"`
    Metadata  map[string]any `json:"metadata,omitempty"`
}
```

---

## 4. JSON-RPC 错误码

```go
// frame/core/agent/errors.go

// 标准 JSON-RPC 错误码
const (
    ErrParseError     = -32700
    ErrInvalidRequest = -32600
    ErrMethodNotFound = -32601
    ErrInvalidParams  = -32602
    ErrInternal       = -32603
)

// A2A 规范扩展错误码
const (
    ErrTaskNotFound                           = -32001
    ErrTaskNotCancelable                      = -32002
    ErrPushNotificationNotSupported           = -32003
    ErrUnsupportedOperation                   = -32004
    ErrContentTypeNotSupported                = -32005
    ErrInvalidAgentResponse                   = -32006
    ErrAuthenticatedExtendedCardNotConfigured = -32007
    ErrExtensionSupportRequired               = -32008
    ErrVersionNotSupported                    = -32009
)
```

---

## 5. 持久化策略

Agent SubServer 的持久化（Turn、Conversation、AgentMessage）仍是 canonical source。Native Agent 层只持久化"A2A 协议状态"，并按需投影出 `Task.history` 与 `Artifacts`。

新增 KV / 表：

| Key | Value | 说明 |
|-----|-------|------|
| `a2a:task:{taskId}` | `TaskRecord{ contextId, agentName, state, createdAt, updatedAt, errorMsg, depth, parentTaskId }` | Task 元数据 |
| `a2a:context:{contextId}` | `conversationId` | 会话上下文 ↔ 内部 Conversation ID |
| `a2a:context:{contextId}:tasks` | `[taskId, ...]` | 同一 contextId 下的 Task 列表 |
| `a2a:task:{taskId}:artifacts` | `[Artifact, ...]` | Artifact 序列 |

投影规则：

- `Task.history` 由 `AgentMessage` 查询投影而成，按 `historyLength` 截断。
- `Task.artifacts` 直接从 `a2a:task:{taskId}:artifacts` 取出。
- `Task.status.message` 是协议层瞬态，不入 AgentMessage 持久化。
- Turn 的 `final_response` 同时作为 Artifact 暴露。

短期 Task 完成后 `a2a:task:{id}` 保留 7 天供查询，到期清理。

---

> **与现有模块的映射** → [integration.md](./integration.md)
> **设计决策与评审** → [decisions.md](./decisions.md)
