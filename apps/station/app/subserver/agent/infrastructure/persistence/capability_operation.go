package persistence

import "time"

type CapabilityOperation struct {
	OperationID            string     `gorm:"primaryKey;type:varchar(64)"`
	IdempotencyKey         string     `gorm:"not null;type:varchar(160)"`
	PayloadHash            string     `gorm:"not null;type:varchar(64)"`
	Ptid                   string     `gorm:"not null;type:text;index:idx_capability_operation_actor_status,priority:1"`
	CapabilityID           string     `gorm:"not null;type:text"`
	CapabilityVersion      string     `gorm:"not null;type:text"`
	TargetDeviceID         string     `gorm:"not null;type:text"`
	CapabilitySessionID    string     `gorm:"not null;type:varchar(64)"`
	ExecutorLeaseID        string     `gorm:"not null;type:varchar(64)"`
	OperationKind          string     `gorm:"not null;type:varchar(64)"`
	Status                 int32      `gorm:"not null;index:idx_capability_operation_actor_status,priority:2"`
	Attempt                uint32     `gorm:"not null"`
	AttemptEpoch           uint64     `gorm:"not null"`
	FencingToken           uint64     `gorm:"not null"`
	Revision               uint64     `gorm:"not null"`
	Deadline               time.Time  `gorm:"not null;index"`
	LastEventSequence      uint64     `gorm:"not null"`
	CancelRequestedAt      *time.Time `gorm:"type:timestamp"`
	CancelAckAt            *time.Time `gorm:"type:timestamp"`
	DesiredTerminalOutcome int32      `gorm:"not null"`
	CleanupLeaseID         string     `gorm:"not null;type:varchar(64)"`
	CleanupEpoch           uint64     `gorm:"not null"`
	CleanupFencingToken    uint64     `gorm:"not null"`
	CleanupDeadline        *time.Time `gorm:"type:timestamp;index"`
	SideEffectStartedAt    *time.Time `gorm:"type:timestamp"`
	ProgressPercent        uint32     `gorm:"not null"`
	ProgressMessage        string     `gorm:"not null;type:text"`
	ResultRef              string     `gorm:"not null;type:text"`
	ErrorCode              int32      `gorm:"not null"`
	ErrorRetryable         bool       `gorm:"not null"`
	ErrorRecoveryAction    string     `gorm:"not null;type:text"`
	CleanupOutcome         string     `gorm:"not null;type:text"`
	BoundedArguments       []byte     `gorm:"not null;type:bytea"`
	ExternalIdempotencyKey string     `gorm:"not null;type:varchar(160)"`
	DispatchSequence       uint64     `gorm:"not null"`
	CreatedAt              time.Time  `gorm:"not null"`
	UpdatedAt              time.Time  `gorm:"not null"`
	TerminalAt             *time.Time `gorm:"type:timestamp"`
}

func (CapabilityOperation) TableName() string {
	return "agent_capability_operations"
}

type CapabilityOperationCommand struct {
	CommandID      string    `gorm:"primaryKey;type:varchar(64)"`
	Ptid           string    `gorm:"not null;type:text;uniqueIndex:idx_capability_operation_command,priority:1"`
	CommandKind    string    `gorm:"not null;type:varchar(32);uniqueIndex:idx_capability_operation_command,priority:2"`
	IdempotencyKey string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_capability_operation_command,priority:3"`
	PayloadHash    string    `gorm:"not null;type:varchar(64)"`
	OperationID    string    `gorm:"not null;type:varchar(64);index"`
	Revision       uint64    `gorm:"not null"`
	CreatedAt      time.Time `gorm:"not null"`
}

func (CapabilityOperationCommand) TableName() string {
	return "agent_capability_operation_commands"
}

type CapabilityOperationEvent struct {
	ID              string    `gorm:"primaryKey;type:varchar(64)"`
	OperationID     string    `gorm:"not null;type:varchar(64);uniqueIndex:idx_capability_operation_event,priority:1"`
	AttemptEpoch    uint64    `gorm:"not null;uniqueIndex:idx_capability_operation_event,priority:2"`
	Sequence        uint64    `gorm:"not null;uniqueIndex:idx_capability_operation_event,priority:3"`
	Status          int32     `gorm:"not null"`
	FencingToken    uint64    `gorm:"not null"`
	ProgressPercent uint32    `gorm:"not null"`
	ResultRef       string    `gorm:"not null;type:text"`
	ErrorCode       int32     `gorm:"not null"`
	ErrorRetryable  bool      `gorm:"not null"`
	RecoveryAction  string    `gorm:"not null;type:text"`
	PayloadHash     string    `gorm:"not null;type:varchar(64)"`
	Accepted        bool      `gorm:"not null"`
	RejectionCode   string    `gorm:"not null;type:varchar(100)"`
	OccurredAt      time.Time `gorm:"not null"`
	CreatedAt       time.Time `gorm:"not null"`
}

func (CapabilityOperationEvent) TableName() string {
	return "agent_capability_operation_events"
}

type CapabilityOperationEventRejection struct {
	ID           string    `gorm:"primaryKey;type:varchar(64)"`
	OperationID  string    `gorm:"not null;type:varchar(64);index"`
	Ptid         string    `gorm:"not null;type:text;index"`
	AttemptEpoch uint64    `gorm:"not null"`
	Sequence     uint64    `gorm:"not null"`
	FencingToken uint64    `gorm:"not null"`
	PayloadHash  string    `gorm:"not null;type:varchar(64)"`
	ReasonCode   string    `gorm:"not null;type:varchar(100)"`
	CreatedAt    time.Time `gorm:"not null"`
}

func (CapabilityOperationEventRejection) TableName() string {
	return "agent_capability_operation_event_rejections"
}

type CapabilityOperationOutbox struct {
	OutboxID       string     `gorm:"primaryKey;type:varchar(64)"`
	OperationID    string     `gorm:"not null;type:varchar(64);uniqueIndex:idx_capability_operation_outbox_fence,priority:1"`
	AttemptEpoch   uint64     `gorm:"not null"`
	FencingToken   uint64     `gorm:"not null;uniqueIndex:idx_capability_operation_outbox_fence,priority:2"`
	TargetDeviceID string     `gorm:"not null;type:text;index:idx_capability_operation_outbox_target,priority:1"`
	SessionID      string     `gorm:"not null;type:varchar(64);index:idx_capability_operation_outbox_target,priority:2"`
	Sequence       uint64     `gorm:"not null"`
	PayloadHash    string     `gorm:"not null;type:varchar(64)"`
	Envelope       []byte     `gorm:"not null;type:bytea"`
	AcknowledgedAt *time.Time `gorm:"type:timestamp"`
	CreatedAt      time.Time  `gorm:"not null"`
}

func (CapabilityOperationOutbox) TableName() string {
	return "agent_capability_operation_outbox"
}

type CapabilityOperationLease struct {
	LeaseID      string     `gorm:"primaryKey;type:varchar(64)"`
	OperationID  string     `gorm:"not null;type:varchar(64);uniqueIndex:idx_capability_operation_lease_epoch,priority:1"`
	AttemptEpoch uint64     `gorm:"not null;uniqueIndex:idx_capability_operation_lease_epoch,priority:2"`
	FencingToken uint64     `gorm:"not null"`
	Ptid         string     `gorm:"not null;type:text"`
	DeviceID     string     `gorm:"not null;type:text"`
	SessionID    string     `gorm:"not null;type:varchar(64)"`
	ExpiresAt    time.Time  `gorm:"not null;index"`
	ReleasedAt   *time.Time `gorm:"type:timestamp"`
	CreatedAt    time.Time  `gorm:"not null"`
}

func (CapabilityOperationLease) TableName() string {
	return "agent_capability_operation_leases"
}

type CapabilityCleanupLease struct {
	LeaseID      string     `gorm:"primaryKey;type:varchar(64)"`
	OperationID  string     `gorm:"not null;type:varchar(64);uniqueIndex:idx_capability_cleanup_lease_epoch,priority:1"`
	CleanupEpoch uint64     `gorm:"not null;uniqueIndex:idx_capability_cleanup_lease_epoch,priority:2"`
	FencingToken uint64     `gorm:"not null"`
	Ptid         string     `gorm:"not null;type:text"`
	DeviceID     string     `gorm:"not null;type:text"`
	SessionID    string     `gorm:"not null;type:varchar(64)"`
	ExpiresAt    time.Time  `gorm:"not null;index"`
	ReleasedAt   *time.Time `gorm:"type:timestamp"`
	CreatedAt    time.Time  `gorm:"not null"`
}

func (CapabilityCleanupLease) TableName() string {
	return "agent_capability_cleanup_leases"
}
