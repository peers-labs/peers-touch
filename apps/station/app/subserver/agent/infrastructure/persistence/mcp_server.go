package persistence

import "time"

// McpServer is the Station-owned MCP configuration head. SecretConfigJSON is
// executor-local: it is populated only for Station-owned servers and is never
// copied into API projections.
type McpServer struct {
	ServerID         string     `gorm:"primaryKey;type:varchar(64)"`
	Ptid             string     `gorm:"not null;type:text;uniqueIndex:idx_mcp_server_actor_name,priority:1"`
	Name             string     `gorm:"not null;type:varchar(128);uniqueIndex:idx_mcp_server_actor_name,priority:2"`
	Revision         uint64     `gorm:"not null"`
	Transport        int32      `gorm:"not null"`
	ExecutionOwner   int32      `gorm:"not null"`
	PublicConfigJSON string     `gorm:"not null;type:text"`
	SecretConfigJSON []byte     `gorm:"type:bytea"`
	ToolsJSON        string     `gorm:"not null;type:text"`
	Enabled          bool       `gorm:"not null"`
	Status           int32      `gorm:"not null"`
	LastError        string     `gorm:"not null;type:text"`
	LastTestedAt     *time.Time `gorm:"index"`
	CreatedAt        time.Time  `gorm:"not null"`
	UpdatedAt        time.Time  `gorm:"not null"`
	DeletedAt        *time.Time `gorm:"index"`
}

func (McpServer) TableName() string { return "agent_mcp_servers" }

type McpServerRevision struct {
	ServerID         string    `gorm:"primaryKey;type:varchar(64)"`
	Revision         uint64    `gorm:"primaryKey"`
	Ptid             string    `gorm:"not null;type:text;index"`
	Name             string    `gorm:"not null;type:varchar(128)"`
	Transport        int32     `gorm:"not null"`
	ExecutionOwner   int32     `gorm:"not null"`
	PublicConfigJSON string    `gorm:"not null;type:text"`
	SecretConfigJSON []byte    `gorm:"type:bytea"`
	ToolsJSON        string    `gorm:"not null;type:text"`
	Enabled          bool      `gorm:"not null"`
	Status           int32     `gorm:"not null"`
	LastError        string    `gorm:"not null;type:text"`
	CreatedAt        time.Time `gorm:"not null"`
}

func (McpServerRevision) TableName() string {
	return "agent_mcp_server_revisions"
}

type McpServerCommand struct {
	ID             string    `gorm:"primaryKey;type:varchar(64)"`
	Ptid           string    `gorm:"not null;type:text;uniqueIndex:idx_mcp_server_command,priority:1"`
	CommandKind    string    `gorm:"not null;type:varchar(32);uniqueIndex:idx_mcp_server_command,priority:2"`
	IdempotencyKey string    `gorm:"not null;type:varchar(160);uniqueIndex:idx_mcp_server_command,priority:3"`
	PayloadHash    string    `gorm:"not null;type:varchar(64)"`
	ServerID       string    `gorm:"not null;type:varchar(64)"`
	Revision       uint64    `gorm:"not null"`
	ResultPayload  []byte    `gorm:"not null;type:bytea"`
	CreatedAt      time.Time `gorm:"not null"`
}

func (McpServerCommand) TableName() string { return "agent_mcp_server_commands" }
