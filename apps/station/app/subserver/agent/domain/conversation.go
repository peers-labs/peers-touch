package domain

import (
	"encoding/json"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

type ConversationStatus string

const (
	ConversationStatusActive     ConversationStatus = "active"
	ConversationStatusCompressed ConversationStatus = "compressed"
	ConversationStatusArchived   ConversationStatus = "archived"
	ConversationStatusDeleted    ConversationStatus = "deleted"
)

type Conversation struct {
	ConversationID        string
	AgentID               string
	ActorPTID             string
	Title                 string
	Description           string
	ProviderID            string
	ModelName             string
	Status                ConversationStatus
	ParentID              string
	ConfigJSON            json.RawMessage
	Meta                  map[string]string
	ActiveBranchMessageID string
	RuntimeBinding        *model.ConversationRuntimeBinding
	QueuedTurnCount       uint32
	Version               uint64
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// Thread is a durable sub-conversation forked from a source message.
type Thread struct {
	ThreadID        string
	ConversationID  string
	SourceMessageID string
	Title           string
	SourceSeq       int64
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type MessageRole string

const (
	MessageRoleSystem    MessageRole = "system"
	MessageRoleUser      MessageRole = "user"
	MessageRoleAssistant MessageRole = "assistant"
	MessageRoleTool      MessageRole = "tool"
)

type Message struct {
	MessageID         string
	ConversationID    string
	TurnID            string
	ModelName         string
	Role              MessageRole
	Status            string
	Content           string
	ReasoningJSON     json.RawMessage
	ToolCallsJSON     json.RawMessage
	MetadataJSON      json.RawMessage
	ErrorJSON         json.RawMessage
	AttachmentsJSON   json.RawMessage
	Seq               int64
	BranchID          string
	ReplacesMessageID string
	ParentMessageID   string
	ThreadID          string
	TombstonedAt      *time.Time
	TombstonedByPtid  string
	TombstoneReason   string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// ---------------------------------------------------------------------------
// Context Reference — parsed @-reference from user message
// Added: 2026-04-11 — domain types for context reference expansion pipeline.
// ---------------------------------------------------------------------------

// ContextReference represents a single @-reference parsed from a user message.
type ContextReference struct {
	Raw       string // the original matched text, e.g. "@file:main.go:10-20"
	Kind      string // file | folder | url | diff | staged | git
	Target    string // resolved target: path, URL, or commit count
	Start     int    // character start offset in the original message
	End       int    // character end offset in the original message
	LineStart int    // optional line range start (file kind only)
	LineEnd   int    // optional line range end (file kind only)
}

// ContextReferenceResult holds the outcome of processing all @-references in a message.
type ContextReferenceResult struct {
	Message         string             // the rewritten message with references replaced by expanded content
	OriginalMessage string             // the original user message before processing
	References      []ContextReference // all parsed references
	Warnings        []string           // non-fatal warnings (e.g. soft budget exceeded)
	InjectedTokens  int                // estimated total tokens injected
	Expanded        []string           // list of successfully expanded reference targets
	Blocked         []string           // list of blocked reference targets (security / budget)
}
