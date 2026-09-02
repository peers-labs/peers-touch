package persistence

import "time"

// CapabilityManifest is the immutable, versioned capability catalog authority.
type CapabilityManifest struct {
	CapabilityID             string     `gorm:"primaryKey;type:text"`
	Version                  string     `gorm:"primaryKey;type:text"`
	SourceKind               int32      `gorm:"not null"`
	SourceInstanceID         string     `gorm:"not null;type:text"`
	DisplayMetadataJSON      string     `gorm:"not null;type:text"`
	InputSchemaRef           string     `gorm:"not null;type:text"`
	OutputSchemaRef          string     `gorm:"not null;type:text"`
	ExecutionOwner           int32      `gorm:"not null"`
	RequiredCapabilitiesJSON string     `gorm:"not null;type:text"`
	RiskClass                string     `gorm:"not null;type:text"`
	DefaultApprovalPolicy    int32      `gorm:"not null"`
	SecretBoundary           string     `gorm:"not null;type:text"`
	Availability             int32      `gorm:"not null"`
	PayloadHash              string     `gorm:"not null;type:varchar(64)"`
	CreatedAt                time.Time  `gorm:"not null"`
	RetiredAt                *time.Time `gorm:"index"`
	RetiredByPtid            string     `gorm:"type:text"`
	RetirementReason         string     `gorm:"type:text"`
	OwnerPtid                string     `gorm:"not null;type:text;index"`
}

func (CapabilityManifest) TableName() string { return "agent_capability_manifests" }

// CapabilityManifestCommand records idempotent catalog mutations.
type CapabilityManifestCommand struct {
	ID             string    `gorm:"primaryKey;type:varchar(64)"`
	Ptid           string    `gorm:"not null;type:text;uniqueIndex:idx_capability_manifest_command,priority:1"`
	CommandKind    string    `gorm:"not null;type:varchar(32);uniqueIndex:idx_capability_manifest_command,priority:2"`
	IdempotencyKey string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_capability_manifest_command,priority:3"`
	PayloadHash    string    `gorm:"not null;type:varchar(64)"`
	CapabilityID   string    `gorm:"not null;type:text"`
	Version        string    `gorm:"not null;type:text"`
	CreatedAt      time.Time `gorm:"not null"`
}

func (CapabilityManifestCommand) TableName() string {
	return "agent_capability_manifest_commands"
}

// AgentCapabilityBinding is the actor-scoped mutable policy reference.
type AgentCapabilityBinding struct {
	BindingID         string     `gorm:"primaryKey;type:varchar(64)"`
	Ptid              string     `gorm:"not null;type:text;index:idx_capability_binding_actor_agent,priority:1"`
	AgentID           string     `gorm:"not null;type:varchar(36);index:idx_capability_binding_actor_agent,priority:2"`
	CapabilityID      string     `gorm:"not null;type:text;index"`
	CapabilityVersion string     `gorm:"not null;type:text"`
	Enabled           bool       `gorm:"not null"`
	ApprovalPolicy    int32      `gorm:"not null"`
	AgentVersion      uint64     `gorm:"not null"`
	Revision          uint64     `gorm:"not null"`
	UpdatedAt         time.Time  `gorm:"not null"`
	TombstonedAt      *time.Time `gorm:"index"`
	TombstonedByPtid  string     `gorm:"type:text"`
	TombstoneReason   string     `gorm:"type:text"`
}

func (AgentCapabilityBinding) TableName() string { return "agent_capability_bindings" }

// CapabilityBindingCommand records actor-scoped idempotency outcomes.
type CapabilityBindingCommand struct {
	ID             string    `gorm:"primaryKey;type:varchar(64)"`
	Ptid           string    `gorm:"not null;type:text;uniqueIndex:idx_capability_binding_command,priority:1"`
	CommandKind    string    `gorm:"not null;type:varchar(32);uniqueIndex:idx_capability_binding_command,priority:2"`
	IdempotencyKey string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_capability_binding_command,priority:3"`
	PayloadHash    string    `gorm:"not null;type:varchar(64)"`
	BindingID      string    `gorm:"not null;type:varchar(64)"`
	Revision       uint64    `gorm:"not null"`
	ResultPayload  []byte    `gorm:"type:bytea"`
	CreatedAt      time.Time `gorm:"not null"`
}

func (CapabilityBindingCommand) TableName() string {
	return "agent_capability_binding_commands"
}

// CapabilityReadinessSnapshot stores one immutable admission decision.
type CapabilityReadinessSnapshot struct {
	SnapshotID  string    `gorm:"primaryKey;type:varchar(96)"`
	Ptid        string    `gorm:"not null;type:text;index:idx_capability_readiness_actor_agent,priority:1"`
	AgentID     string    `gorm:"not null;type:varchar(36);index:idx_capability_readiness_actor_agent,priority:2"`
	Payload     []byte    `gorm:"not null;type:bytea"`
	PayloadHash string    `gorm:"not null;type:varchar(64)"`
	CreatedAt   time.Time `gorm:"not null"`
	ExpiresAt   time.Time `gorm:"not null;index"`
}

func (CapabilityReadinessSnapshot) TableName() string {
	return "agent_capability_readiness_snapshots"
}

// CapabilityBackfillRun stores the deterministic reconciliation evidence.
type CapabilityBackfillRun struct {
	RunID       string    `gorm:"primaryKey;type:varchar(96)"`
	Payload     []byte    `gorm:"not null;type:bytea"`
	PayloadHash string    `gorm:"not null;type:varchar(64);uniqueIndex"`
	CreatedAt   time.Time `gorm:"not null"`
}

func (CapabilityBackfillRun) TableName() string {
	return "agent_capability_backfill_runs"
}
