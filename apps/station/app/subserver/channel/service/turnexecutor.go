package service

import (
	"context"
	"encoding/json"
	"time"
)

type AttachmentPayload struct {
	AttachmentID string
	FileName     string
	MIMEType     string
	Body         []byte
	Checksum     string
}

type TurnAdmissionInput struct {
	ActorPTID      string
	AgentID        string
	ConversationID string
	Title          string
	UserInput      string
	IdempotencyKey string
	Attachments    []AttachmentPayload
}

type TurnAdmissionResult struct {
	TurnID      string
	AdmissionID string
	Status      string // started | queued | replayed
}

type TurnSnapshot struct {
	TurnID         string
	Status         string
	Text           string
	Revision       uint64
	Pending        *TurnPendingInteraction
	Outputs        []TurnOutput
	TerminalReason string
	UpdatedAt      time.Time
}

type TurnPendingInteraction struct {
	Kind             string
	InteractionID    string
	ToolCallID       string
	Title            string
	Detail           string
	DecisionID       string
	ExpectedRevision uint64
	ExpiresAt        *time.Time
}

type TurnOutput struct {
	OutputID   string
	Kind       string
	Name       string
	MIMEType   string
	ObjectRef  string
	Checksum   string
	SizeBytes  uint64
	Summary    string
	SourceKind string
}

type ToolDecisionInput struct {
	TurnID           string
	ApprovalID       string
	ToolCallID       string
	DecisionID       string
	ExpectedRevision uint64
	Approved         bool
	IdempotencyKey   string
	PayloadHash      string
}

type TurnFeedbackInput struct {
	TurnID         string
	ConversationID string
	AgentID        string
	Positive       bool
	IdempotencyKey string
}

// RequesterToolExecutor runs provider-user work with the requester identity
// durably associated with a Channel turn. Implementations must fail closed
// when the turn, binding, tenant, region, or provider user does not match an
// active authorization.
type RequesterToolExecutor interface {
	ExecuteRequesterTool(
		ctx context.Context,
		turnID string,
		toolName string,
		arguments json.RawMessage,
	) (string, error)
}

// TurnExecutor is the host-neutral Agent boundary used by Channel. Admission
// is durable and idempotent; execution outlives the provider callback. Snapshot
// reads let Channel recover delivery after either process restarts.
type TurnExecutor interface {
	EnsureConversation(ctx context.Context, actorPTID, agentID, conversationID, title string) error
	AdmitTurn(ctx context.Context, input TurnAdmissionInput) (TurnAdmissionResult, error)
	ResolveAdmission(
		ctx context.Context,
		actorPTID, conversationID, admissionID string,
	) (TurnAdmissionResult, error)
	Snapshot(ctx context.Context, actorPTID, conversationID, turnID string) (TurnSnapshot, error)
	ReadOutput(
		ctx context.Context,
		actorPTID, turnID string,
		output TurnOutput,
	) ([]byte, error)
	CancelTurn(ctx context.Context, actorPTID, turnID string) error
	SubmitToolDecision(
		ctx context.Context, actorPTID string, input ToolDecisionInput,
	) error
	RecordFeedback(
		ctx context.Context, actorPTID string, input TurnFeedbackInput,
	) error
}
