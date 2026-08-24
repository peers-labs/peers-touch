package domain

import "time"

type TurnStatus string

const (
	TurnStatusRunning          TurnStatus = "running"
	TurnStatusWaitingLocalTool TurnStatus = "waiting_local_tool"
	TurnStatusCompleted        TurnStatus = "completed"
	TurnStatusFailed           TurnStatus = "failed"
	TurnStatusCancelled        TurnStatus = "cancelled"
	TurnStatusInterrupted      TurnStatus = "interrupted"
)

type Turn struct {
	TurnID         string
	ConversationID string
	AgentID        string
	UserInput      string
	FinalResponse  string
	ToolIterations int
	Status         TurnStatus
	StartedAt      time.Time
	EndedAt        *time.Time
	// Model records the LLM model that produced the final response. This is a
	// domain-only field (not proto-mapped) populated after the provider call
	// completes, so the turn stream "done" event can carry the model name back
	// to the client.
	Model string
}

type TurnTrace struct {
	TraceID              string
	TurnID               string
	SystemPromptHash     string
	MemorySnapshotHash   string
	SkillIndexHash       string
	SkillsLoaded         []string
	ToolCalls            []ToolCallRecord
	ProviderCalls        []ProviderCallRecord
	ReviewTriggered      bool
	ErrorClassified      []ClassifiedError
	CompressionTriggered bool
	CompressionBefore    int
	CompressionAfter     int
	DelegationResults    []DelegationResult
	KnowledgeChunks      []KnowledgeChunkReference
	CapabilitySnapshotID string
}

type TurnUsage struct {
	TurnID               string
	AttemptID            string
	InputTokens          uint64
	OutputTokens         uint64
	CacheTokens          uint64
	ReasoningTokens      uint64
	ToolDefinitionTokens uint64
	ProviderCallCount    uint32
	ToolCallCount        uint32
	ProviderLatency      time.Duration
	ToolLatency          time.Duration
	Cost                 *float64
	Currency             string
	ProviderID           string
	ModelID              string
	ToolCallIDs          []string
}

type TurnTraceEntry struct {
	Turn  Turn
	Trace TurnTrace
}

type TurnTraceListOptions struct {
	Ptid           string
	AgentID        string
	ConversationID string
	Page           int
	PageSize       int
}

type KnowledgeResourceType string

const (
	KnowledgeResourceTypeDocument  KnowledgeResourceType = "document"
	KnowledgeResourceTypeFolder    KnowledgeResourceType = "folder"
	KnowledgeResourceTypeProject   KnowledgeResourceType = "project"
	KnowledgeResourceTypeURL       KnowledgeResourceType = "url"
	KnowledgeResourceTypeNotebook  KnowledgeResourceType = "notebook"
	KnowledgeResourceTypeWorkspace KnowledgeResourceType = "workspace"
)

type KnowledgeResourcePolicy string

const (
	KnowledgeResourcePolicyManual   KnowledgeResourcePolicy = "manual"
	KnowledgeResourcePolicyAuto     KnowledgeResourcePolicy = "auto"
	KnowledgeResourcePolicyAlways   KnowledgeResourcePolicy = "always"
	KnowledgeResourcePolicyDisabled KnowledgeResourcePolicy = "disabled"
)

type KnowledgeResource struct {
	ResourceID string
	AgentID    string
	Type       KnowledgeResourceType
	Title      string
	Source     string
	Policy     KnowledgeResourcePolicy
	Status     string
}

type KnowledgeChunkReference struct {
	ChunkID        string
	ResourceID     string
	ResourceTitle  string
	Source         string
	ChunkIndex     int
	Score          float64
	ContentPreview string
}

type ToolCallRecord struct {
	ToolName  string
	Arguments string
	Result    string
	Duration  time.Duration
}

type ProviderCallRecord struct {
	Provider     string
	Model        string
	InputTokens  int
	OutputTokens int
	Latency      time.Duration
	CacheHit     bool
	CredentialID string
}
