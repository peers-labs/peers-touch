package persistence

import (
	"time"
)

// ToolCall status values — mirrors proto ToolCallStatus enum.
const (
	ToolCallStatusProposed          = "proposed"
	ToolCallStatusWaitingApproval   = "waiting_approval"
	ToolCallStatusApproved          = "approved"
	ToolCallStatusDenied            = "denied"
	ToolCallStatusDispatchCommitted = "dispatch_committed"
	ToolCallStatusPrepared          = "prepared"
	ToolCallStatusSucceeded         = "succeeded"
	ToolCallStatusFailed            = "failed"
	ToolCallStatusCancelled         = "cancelled"
	ToolCallStatusExpired           = "expired"
	ToolCallStatusUnknownSideEffect = "unknown_side_effect"
)

const (
	ToolBatchStatusOpen                 = "open"
	ToolBatchStatusReadyForContinuation = "ready_for_continuation"
	ToolBatchStatusBlocked              = "blocked"
)

const (
	ToolReceiptStatusPrepared          = "prepared"
	ToolReceiptStatusApplied           = "applied"
	ToolReceiptStatusFailed            = "failed"
	ToolReceiptStatusReconciledUnknown = "reconciled_unknown"
)

const (
	ToolContinuationStatusReady                  = "ready"
	ToolContinuationStatusClaimed                = "claimed"
	ToolContinuationStatusCompleted              = "completed"
	ToolContinuationStatusReconciliationRequired = "reconciliation_required"
)

const (
	ClientExecutionReplayPolicyUnspecified           int32 = 0
	ClientExecutionReplayPolicyNoReplayAfterPrepared int32 = 1
	ClientExecutionReplayPolicyExternalIdempotency   int32 = 2
	ClientCapabilityLeaseRevokeReasonUnspecified     int32 = 0
	ClientCapabilityLeaseRevokeReasonAdminPolicy     int32 = 5
	LegacyPreparedWithoutRecoveryError                     = "legacy_prepared_without_recovery"
)

// ToolExecutionOwner values — mirrors proto ToolExecutionOwner enum.
const (
	ToolOwnerUnspecified      = "unspecified"
	ToolOwnerStation          = "station"
	ToolOwnerClientCapability = "client_capability"
)

// ToolCall is the durable state machine for one tool invocation within a turn.
// Inspired by LobeHub's pause/resume tool dispatch but with Station-owned
// durable decision lineage, fencing tokens, and exactly-once execution
// semantics (MCA-D15/D16).
type ToolCall struct {
	ID                          string     `gorm:"primaryKey;type:varchar(64)"`
	ActorID                     string     `gorm:"not null;type:varchar(255);index:idx_actor_tool_call,priority:1"`
	TurnID                      string     `gorm:"not null;type:varchar(36);index:idx_turn_tool_call,priority:1"`
	AttemptID                   string     `gorm:"not null;type:varchar(36);index"`
	ToolBatchID                 string     `gorm:"not null;type:varchar(64);index"`
	ToolName                    string     `gorm:"not null;type:varchar(200)"`
	ToolCallID                  string     `gorm:"not null;type:varchar(100);uniqueIndex:idx_actor_tool_call,priority:2"` // LLM tool_call_id
	CapabilityID                string     `gorm:"not null;type:varchar(200)"`
	SchemaVersion               string     `gorm:"not null;type:varchar(20);default:'1'"`
	ExecutionOwner              string     `gorm:"not null;type:varchar(30);default:'unspecified'"`
	BoundedArguments            []byte     `gorm:"not null;type:bytea"`
	ResourceRefs                []byte     `gorm:"not null;type:bytea"`
	ArgumentsHash               string     `gorm:"not null;type:varchar(64);default:''"`
	RedactedArguments           string     `gorm:"not null;type:text;default:''"`
	RiskClass                   string     `gorm:"not null;type:varchar(20);default:'low'"`
	ApprovalPolicy              string     `gorm:"not null;type:varchar(20);default:'auto'"`
	ManifestID                  string     `gorm:"not null;type:varchar(100);default:''"`
	BindingID                   string     `gorm:"not null;type:varchar(100);default:''"`
	ReadinessSnapID             string     `gorm:"not null;type:varchar(100);default:''"`
	ApprovalID                  string     `gorm:"not null;type:varchar(64);default:''"`
	DecisionID                  string     `gorm:"not null;type:varchar(64);default:''"`
	DecisionRevision            uint64     `gorm:"not null;default:0"`
	DecisionPayloadHash         string     `gorm:"not null;type:varchar(64);default:''"`
	Approved                    bool       `gorm:"not null;default:false"`
	CapabilitySessionID         string     `gorm:"not null;type:varchar(64);default:'';index"`
	TargetDeviceID              string     `gorm:"not null;type:varchar(255);default:''"`
	ExecutionClaimID            string     `gorm:"not null;type:varchar(64);default:''"`
	ExecutorLeaseID             string     `gorm:"not null;type:varchar(64);default:''"`
	CapabilityLeaseRevision     uint64     `gorm:"not null;default:0"`
	FencingToken                uint64     `gorm:"not null;default:0"`
	SideEffectReceipt           string     `gorm:"not null;type:varchar(100);default:''"`
	IdempotencyKey              string     `gorm:"not null;type:varchar(100);default:''"`
	DispatchSequence            uint64     `gorm:"not null;default:0"`
	PayloadHash                 string     `gorm:"not null;type:varchar(64);default:''"`
	ReplayPolicy                int32      `gorm:"not null;default:0"`
	ExternalIdempotencyKey      string     `gorm:"not null;type:varchar(100);default:''"`
	ReceiptRecoveryCredentialID string     `gorm:"not null;type:varchar(64);default:'';index"`
	Status                      string     `gorm:"not null;type:varchar(25);index"`
	ResultRef                   string     `gorm:"not null;type:text;default:''"`
	ResultID                    string     `gorm:"not null;type:varchar(64);default:''"`
	ErrorCode                   string     `gorm:"not null;type:varchar(100);default:''"`
	ResultPersisted             bool       `gorm:"not null;default:false"`
	ExecutionDeadline           *time.Time `gorm:"type:timestamp;index"`
	ReconciliationDeadline      *time.Time `gorm:"type:timestamp;index"`
	StartedAt                   *time.Time `gorm:"type:timestamp"`
	EndedAt                     *time.Time `gorm:"type:timestamp"`
	CreatedAt                   time.Time  `gorm:"not null"`
	UpdatedAt                   time.Time  `gorm:"not null"`
}

func (ToolCall) TableName() string { return "agent_tool_calls" }

// CanTransition checks whether a status transition is valid per the ToolCall
// state machine. This prevents illegal state jumps and ensures exactly-once
// semantics.
func ToolCallCanTransition(from, to string) bool {
	allowed := map[string][]string{
		ToolCallStatusProposed: {
			ToolCallStatusWaitingApproval,
			ToolCallStatusApproved,
			ToolCallStatusDenied,
			ToolCallStatusCancelled,
		},
		ToolCallStatusWaitingApproval: {
			ToolCallStatusApproved,
			ToolCallStatusDenied,
			ToolCallStatusCancelled,
			ToolCallStatusExpired,
		},
		ToolCallStatusApproved: {
			ToolCallStatusDispatchCommitted,
			ToolCallStatusCancelled,
		},
		ToolCallStatusDispatchCommitted: {
			ToolCallStatusPrepared,
			ToolCallStatusFailed,
			ToolCallStatusCancelled,
		},
		ToolCallStatusPrepared: {
			ToolCallStatusDispatchCommitted,
			ToolCallStatusSucceeded,
			ToolCallStatusFailed,
			ToolCallStatusCancelled,
			ToolCallStatusUnknownSideEffect,
		},
		// Terminal states — no transitions out.
		ToolCallStatusSucceeded:         nil,
		ToolCallStatusFailed:            nil,
		ToolCallStatusCancelled:         nil,
		ToolCallStatusExpired:           nil,
		ToolCallStatusUnknownSideEffect: nil,
		ToolCallStatusDenied:            nil,
	}
	targets, ok := allowed[from]
	if !ok {
		return false
	}
	for _, t := range targets {
		if t == to {
			return true
		}
	}
	return false
}

type ClientCapabilityLease struct {
	SessionID          string     `gorm:"primaryKey;type:varchar(64)"`
	ActorID            string     `gorm:"not null;type:varchar(255);index:idx_capability_actor_device,priority:1"`
	AuthSessionID      string     `gorm:"not null;type:varchar(255)"`
	DeviceID           string     `gorm:"not null;type:varchar(255);index:idx_capability_actor_device,priority:2"`
	PlatformKind       int32      `gorm:"not null"`
	ClientVersion      string     `gorm:"not null;type:varchar(64)"`
	ConnectionID       string     `gorm:"not null;type:varchar(255)"`
	LeaseID            string     `gorm:"not null;type:varchar(64);uniqueIndex"`
	LeaseRevision      uint64     `gorm:"not null;default:0"`
	CapabilitySetHash  string     `gorm:"not null;type:varchar(64);default:''"`
	DeviceSigningKeyID string     `gorm:"not null;type:varchar(255);default:''"`
	LeasePayload       []byte     `gorm:"not null;type:bytea"`
	DispatchSequence   uint64     `gorm:"not null;default:0"`
	ExpiresAt          time.Time  `gorm:"not null;index"`
	RevokedAt          *time.Time `gorm:"type:timestamp"`
	RevokeReason       int32      `gorm:"not null;default:0"`
	CreatedAt          time.Time  `gorm:"not null"`
	UpdatedAt          time.Time  `gorm:"not null"`
}

func (ClientCapabilityLease) TableName() string { return "agent_client_capability_leases" }

type ToolBatch struct {
	ID                  string     `gorm:"primaryKey;type:varchar(64)"`
	ActorID             string     `gorm:"not null;type:varchar(255);index"`
	TurnID              string     `gorm:"not null;type:varchar(36);uniqueIndex:idx_tool_batch_identity,priority:1"`
	AttemptID           string     `gorm:"not null;type:varchar(36);uniqueIndex:idx_tool_batch_identity,priority:2"`
	ConversationID      string     `gorm:"not null;type:varchar(36);index"`
	AgentID             string     `gorm:"not null;type:varchar(36);index"`
	Provider            string     `gorm:"not null;type:varchar(100)"`
	Model               string     `gorm:"not null;type:varchar(200)"`
	Effort              string     `gorm:"not null;type:varchar(20);default:''"`
	ThinkingMode        string     `gorm:"not null;type:varchar(20);default:'auto'"`
	SystemPrompt        string     `gorm:"not null;type:text"`
	Iteration           uint32     `gorm:"not null;uniqueIndex:idx_tool_batch_identity,priority:3"`
	MaxRetries          uint32     `gorm:"not null"`
	ContextWindowSize   uint32     `gorm:"not null"`
	TaskID              string     `gorm:"not null;type:varchar(64);default:''"`
	StepID              string     `gorm:"not null;type:varchar(64);default:''"`
	CapabilitySessionID string     `gorm:"not null;type:varchar(64);default:''"`
	ExpectedCallCount   uint32     `gorm:"not null"`
	TerminalCallCount   uint32     `gorm:"not null;default:0"`
	AppliedCallCount    uint32     `gorm:"not null;default:0"`
	Status              string     `gorm:"not null;type:varchar(32);index"`
	CreatedAt           time.Time  `gorm:"not null"`
	UpdatedAt           time.Time  `gorm:"not null"`
	SettledAt           *time.Time `gorm:"type:timestamp"`
}

func (ToolBatch) TableName() string { return "agent_tool_batches" }

type ToolDecisionCommand struct {
	ID                string    `gorm:"primaryKey;type:varchar(64)"`
	ActorID           string    `gorm:"not null;type:varchar(255);uniqueIndex:idx_tool_decision_idempotency,priority:1"`
	ToolCallID        string    `gorm:"not null;type:varchar(100);index"`
	ApprovalID        string    `gorm:"not null;type:varchar(64)"`
	DecisionID        string    `gorm:"not null;type:varchar(64)"`
	ExpectedRevision  uint64    `gorm:"not null"`
	CommittedRevision uint64    `gorm:"not null"`
	Approved          bool      `gorm:"not null"`
	IdempotencyKey    string    `gorm:"not null;type:varchar(100);uniqueIndex:idx_tool_decision_idempotency,priority:2"`
	PayloadHash       string    `gorm:"not null;type:varchar(64)"`
	Acknowledgement   []byte    `gorm:"not null;type:bytea"`
	CreatedAt         time.Time `gorm:"not null"`
}

func (ToolDecisionCommand) TableName() string { return "agent_tool_decision_commands" }

type ToolDispatchOutbox struct {
	RequestID               string     `gorm:"primaryKey;type:varchar(64)"`
	ActorID                 string     `gorm:"not null;type:varchar(255);index:idx_tool_outbox_target,priority:1"`
	CapabilitySessionID     string     `gorm:"not null;type:varchar(64);index:idx_tool_outbox_target,priority:2;uniqueIndex:idx_tool_outbox_sequence,priority:1"`
	TargetDeviceID          string     `gorm:"not null;type:varchar(255);index:idx_tool_outbox_target,priority:3"`
	DispatchSequence        uint64     `gorm:"not null;uniqueIndex:idx_tool_outbox_sequence,priority:2"`
	ToolCallID              string     `gorm:"not null;type:varchar(100);uniqueIndex:idx_tool_outbox_fence,priority:1"`
	FencingToken            uint64     `gorm:"not null;uniqueIndex:idx_tool_outbox_fence,priority:2"`
	CapabilityLeaseRevision uint64     `gorm:"not null;default:0"`
	PayloadHash             string     `gorm:"not null;type:varchar(64)"`
	Envelope                []byte     `gorm:"not null;type:bytea"`
	ExecutionDeadline       time.Time  `gorm:"not null;index"`
	ReconciliationDeadline  time.Time  `gorm:"not null;index"`
	AcknowledgedAt          *time.Time `gorm:"type:timestamp"`
	CreatedAt               time.Time  `gorm:"not null"`
}

func (ToolDispatchOutbox) TableName() string { return "agent_tool_dispatch_outbox" }

type ReceiptRecoveryCredential struct {
	ID                      string     `gorm:"primaryKey;type:varchar(64)"`
	ActorID                 string     `gorm:"not null;type:varchar(255);index"`
	DeviceID                string     `gorm:"not null;type:varchar(255);index"`
	DeviceSigningKeyID      string     `gorm:"not null;type:varchar(255)"`
	RequestID               string     `gorm:"not null;type:varchar(64);uniqueIndex"`
	ToolCallID              string     `gorm:"not null;type:varchar(100);uniqueIndex:idx_recovery_tool_fence,priority:1"`
	ExecutionClaimID        string     `gorm:"not null;type:varchar(64)"`
	CapabilityLeaseRevision uint64     `gorm:"not null"`
	FencingToken            uint64     `gorm:"not null;uniqueIndex:idx_recovery_tool_fence,priority:2"`
	PayloadHash             string     `gorm:"not null;type:varchar(64)"`
	ReplayPolicy            int32      `gorm:"not null"`
	ExecutionDeadline       time.Time  `gorm:"not null"`
	ReconciliationDeadline  time.Time  `gorm:"not null;index"`
	ScopeHash               string     `gorm:"not null;type:varchar(64)"`
	NonceHash               string     `gorm:"not null;type:varchar(64);uniqueIndex"`
	ConsumedReceiptDigest   string     `gorm:"not null;type:varchar(64);default:''"`
	ConsumedResultID        string     `gorm:"not null;type:varchar(64);default:''"`
	ConsumedAckRef          []byte     `gorm:"type:bytea"`
	IssuedAt                time.Time  `gorm:"not null"`
	ExpiresAt               time.Time  `gorm:"not null;index"`
	ConsumedAt              *time.Time `gorm:"type:timestamp"`
	InvalidatedAt           *time.Time `gorm:"type:timestamp"`
}

func (ReceiptRecoveryCredential) TableName() string {
	return "agent_receipt_recovery_credentials"
}

type ClientCapabilityCommand struct {
	ActorID            string    `gorm:"not null;type:varchar(255);uniqueIndex:idx_capability_command_nonce,priority:1"`
	DeviceID           string    `gorm:"not null;type:varchar(255);uniqueIndex:idx_capability_command_nonce,priority:2"`
	DeviceSigningKeyID string    `gorm:"not null;type:varchar(255);uniqueIndex:idx_capability_command_nonce,priority:3"`
	NonceHash          string    `gorm:"not null;type:varchar(64);uniqueIndex:idx_capability_command_nonce,priority:4"`
	CommandID          string    `gorm:"primaryKey;type:varchar(64)"`
	CommandDomain      int32     `gorm:"not null"`
	BodyHash           string    `gorm:"not null;type:varchar(64)"`
	IssuedAt           time.Time `gorm:"not null"`
	OutcomeCode        int32     `gorm:"not null;default:0"`
	LeaseID            string    `gorm:"not null;type:varchar(64);default:''"`
	LeaseRevision      uint64    `gorm:"not null;default:0"`
	ResponseRef        []byte    `gorm:"type:bytea"`
	CommittedAt        time.Time `gorm:"not null"`
	ExpiresAt          time.Time `gorm:"not null;index"`
}

func (ClientCapabilityCommand) TableName() string {
	return "agent_client_capability_commands"
}

type ToolReceiptAttempt struct {
	ID                  string    `gorm:"primaryKey;type:varchar(64)"`
	RequestID           string    `gorm:"not null;type:varchar(64);uniqueIndex:idx_tool_receipt_sequence,priority:1"`
	Sequence            uint64    `gorm:"not null;uniqueIndex:idx_tool_receipt_sequence,priority:2"`
	ToolCallID          string    `gorm:"not null;type:varchar(100);index"`
	FencingToken        uint64    `gorm:"not null"`
	Status              string    `gorm:"not null;type:varchar(32)"`
	PayloadHash         string    `gorm:"not null;type:varchar(64)"`
	ReceiptHash         string    `gorm:"not null;type:varchar(64)"`
	ResultID            string    `gorm:"not null;type:varchar(64);default:''"`
	SideEffectReceiptID string    `gorm:"not null;type:varchar(100);default:''"`
	BoundedResult       []byte    `gorm:"type:bytea"`
	ErrorCode           string    `gorm:"not null;type:varchar(100);default:''"`
	Accepted            bool      `gorm:"not null;default:false"`
	RejectionCode       string    `gorm:"not null;type:varchar(100);default:''"`
	OccurredAt          time.Time `gorm:"not null"`
	CreatedAt           time.Time `gorm:"not null"`
}

func (ToolReceiptAttempt) TableName() string { return "agent_tool_receipt_attempts" }

type ToolResult struct {
	ID            string    `gorm:"primaryKey;type:varchar(64)"`
	ToolCallID    string    `gorm:"not null;type:varchar(100);uniqueIndex"`
	MessageID     string    `gorm:"not null;type:varchar(36);uniqueIndex"`
	ToolBatchID   string    `gorm:"not null;type:varchar(64);index"`
	TurnID        string    `gorm:"not null;type:varchar(36);index"`
	AttemptID     string    `gorm:"not null;type:varchar(36)"`
	Status        string    `gorm:"not null;type:varchar(32)"`
	PayloadHash   string    `gorm:"not null;type:varchar(64)"`
	BoundedResult []byte    `gorm:"type:bytea"`
	ErrorCode     string    `gorm:"not null;type:varchar(100);default:''"`
	CreatedAt     time.Time `gorm:"not null"`
}

func (ToolResult) TableName() string { return "agent_tool_results" }

type ToolContinuation struct {
	ID                     string     `gorm:"primaryKey;type:varchar(64)"`
	TurnID                 string     `gorm:"not null;type:varchar(36);uniqueIndex:idx_tool_continuation_batch,priority:1"`
	AttemptID              string     `gorm:"not null;type:varchar(36);uniqueIndex:idx_tool_continuation_batch,priority:2"`
	ToolBatchID            string     `gorm:"not null;type:varchar(64);uniqueIndex:idx_tool_continuation_batch,priority:3"`
	Status                 string     `gorm:"not null;type:varchar(32);index"`
	LeaseID                string     `gorm:"not null;type:varchar(64);default:''"`
	FencingToken           uint64     `gorm:"not null;default:0"`
	LeaseExpiresAt         *time.Time `gorm:"type:timestamp"`
	ProviderRequestEmitted bool       `gorm:"not null;default:false"`
	ProviderIdempotent     bool       `gorm:"not null;default:false"`
	ProviderResponse       []byte     `gorm:"type:bytea"`
	CreatedAt              time.Time  `gorm:"not null"`
	UpdatedAt              time.Time  `gorm:"not null"`
	CompletedAt            *time.Time `gorm:"type:timestamp"`
}

func (ToolContinuation) TableName() string { return "agent_tool_continuations" }
