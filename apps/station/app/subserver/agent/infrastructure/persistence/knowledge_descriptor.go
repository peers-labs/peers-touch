package persistence

import "time"

// KnowledgeResourceHead selects the current immutable descriptor revision.
type KnowledgeResourceHead struct {
	ResourceID       string     `gorm:"primaryKey;type:varchar(64)"`
	Ptid             string     `gorm:"not null;type:text;index:idx_knowledge_resource_actor,priority:1"`
	CurrentRevision  uint64     `gorm:"not null"`
	CreatedAt        time.Time  `gorm:"not null"`
	UpdatedAt        time.Time  `gorm:"not null"`
	TombstonedAt     *time.Time `gorm:"index"`
	TombstonedByPtid string     `gorm:"type:text"`
	TombstoneReason  string     `gorm:"type:text"`
}

func (KnowledgeResourceHead) TableName() string {
	return "agent_knowledge_resource_heads"
}

// KnowledgeResourceRevision stores one immutable actor-scoped descriptor revision.
type KnowledgeResourceRevision struct {
	ResourceID                string     `gorm:"primaryKey;type:varchar(64)"`
	Revision                  uint64     `gorm:"primaryKey"`
	Ptid                      string     `gorm:"not null;type:text;index:idx_knowledge_resource_revision_actor,priority:1"`
	Title                     string     `gorm:"not null;type:text"`
	ResourceKind              int32      `gorm:"not null"`
	LocatorKind               string     `gorm:"not null;type:varchar(32)"`
	StationContentRef         string     `gorm:"type:text"`
	ClientOpaqueResourceRef   string     `gorm:"type:text"`
	RequiredCapabilityID      string     `gorm:"type:text"`
	RequiredCapabilityVersion string     `gorm:"type:text"`
	DeviceID                  string     `gorm:"type:text"`
	IntegrityHash             string     `gorm:"type:varchar(128)"`
	ContentHash               string     `gorm:"type:varchar(64)"`
	IndexRevision             string     `gorm:"type:varchar(64)"`
	Availability              int32      `gorm:"not null"`
	ReasonCode                string     `gorm:"not null;type:text"`
	CreatedAt                 time.Time  `gorm:"not null"`
	UpdatedAt                 time.Time  `gorm:"not null"`
	TombstonedAt              *time.Time `gorm:"index"`
	TombstonedByPtid          string     `gorm:"type:text"`
	TombstoneReason           string     `gorm:"type:text"`
}

func (KnowledgeResourceRevision) TableName() string {
	return "agent_knowledge_resource_revisions"
}

// KnowledgeContentRevision owns bounded Station content without exposing it in API output.
type KnowledgeContentRevision struct {
	ContentRef    string    `gorm:"primaryKey;type:text"`
	ResourceID    string    `gorm:"not null;type:varchar(64);uniqueIndex:idx_knowledge_content_resource_revision,priority:1"`
	Revision      uint64    `gorm:"not null;uniqueIndex:idx_knowledge_content_resource_revision,priority:2"`
	Ptid          string    `gorm:"not null;type:text;index"`
	Content       []byte    `gorm:"not null;type:bytea"`
	ContentHash   string    `gorm:"not null;type:varchar(64)"`
	IndexRevision string    `gorm:"not null;type:varchar(64)"`
	CreatedAt     time.Time `gorm:"not null"`
}

func (KnowledgeContentRevision) TableName() string {
	return "agent_knowledge_content_revisions"
}

// KnowledgeDescriptorCommand records the exact result of an idempotent mutation.
type KnowledgeDescriptorCommand struct {
	ID                string    `gorm:"primaryKey;type:varchar(64)"`
	Ptid              string    `gorm:"not null;type:text;uniqueIndex:idx_knowledge_descriptor_command,priority:1"`
	CommandKind       string    `gorm:"not null;type:varchar(32);uniqueIndex:idx_knowledge_descriptor_command,priority:2"`
	IdempotencyKey    string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_knowledge_descriptor_command,priority:3"`
	PayloadHash       string    `gorm:"not null;type:varchar(64)"`
	ResourceID        string    `gorm:"not null;type:varchar(64)"`
	Revision          uint64    `gorm:"not null"`
	CapabilityID      string    `gorm:"not null;type:text"`
	CapabilityVersion string    `gorm:"not null;type:text"`
	CreatedAt         time.Time `gorm:"not null"`
}

func (KnowledgeDescriptorCommand) TableName() string {
	return "agent_knowledge_descriptor_commands"
}
