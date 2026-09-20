package persistence

import "time"

// ConnectorResourceManifest stores one immutable OAuth resource projection.
// Superseded rows remain available for pinned ToolCall lineage.
type ConnectorResourceManifest struct {
	ID                   string     `gorm:"primaryKey;type:varchar(64)"`
	Ptid                 string     `gorm:"not null;type:text;index:idx_connector_resource_current,priority:1"`
	ConnectorID          string     `gorm:"not null;type:text;index:idx_connector_resource_current,priority:2"`
	OAuthConnectionID    string     `gorm:"not null;type:varchar(96);index"`
	ConnectionRevision   uint64     `gorm:"not null"`
	ResourceID           string     `gorm:"not null;type:text;index:idx_connector_resource_current,priority:3"`
	ResourceVersion      string     `gorm:"not null;type:text"`
	ScopesJSON           string     `gorm:"not null;type:text"`
	Status               int32      `gorm:"not null"`
	CapabilityID         string     `gorm:"not null;type:text;index"`
	CapabilityVersion    string     `gorm:"not null;type:text"`
	ToolName             string     `gorm:"not null;type:varchar(96);index"`
	ExpiresAt            *time.Time `gorm:"index"`
	CreatedAt            time.Time  `gorm:"not null"`
	SupersededAt         *time.Time `gorm:"index:idx_connector_resource_current,priority:4"`
	SupersededByRevision uint64     `gorm:"not null;default:0"`
}

func (ConnectorResourceManifest) TableName() string {
	return "agent_connector_resource_manifests"
}

// ConnectorManifestCommand records the immutable result of one projection sync.
type ConnectorManifestCommand struct {
	ID                 string    `gorm:"primaryKey;type:varchar(64)"`
	Ptid               string    `gorm:"not null;type:text;uniqueIndex:idx_connector_manifest_command,priority:1"`
	IdempotencyKey     string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_connector_manifest_command,priority:2"`
	PayloadHash        string    `gorm:"not null;type:varchar(64)"`
	ConnectorID        string    `gorm:"not null;type:text"`
	ConnectionRevision uint64    `gorm:"not null"`
	ResultPayload      []byte    `gorm:"not null;type:bytea"`
	CreatedAt          time.Time `gorm:"not null"`
}

func (ConnectorManifestCommand) TableName() string {
	return "agent_connector_manifest_commands"
}
