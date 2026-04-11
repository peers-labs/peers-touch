package domain

import "time"

type TurnStatus string

const (
	TurnStatusRunning     TurnStatus = "running"
	TurnStatusCompleted   TurnStatus = "completed"
	TurnStatusFailed      TurnStatus = "failed"
	TurnStatusInterrupted TurnStatus = "interrupted"
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
