package persistence

import "time"

type AgentWorkspace struct {
	ID               string `gorm:"primaryKey;type:varchar(36)"`
	AgentID          string `gorm:"not null;type:varchar(36);index:idx_workspace_agent_id"`
	Name             string `gorm:"not null;type:text"`
	Type             string `gorm:"not null;type:varchar(20);default:'directory'"`
	StorageBackend   string `gorm:"not null;type:varchar(20);default:'oss'"`
	OSSBucket        string `gorm:"type:text"`
	OSSPrefix        string `gorm:"type:text"`
	TotalBytes       int64  `gorm:"not null;default:0"`
	FileCount        int32  `gorm:"not null;default:0"`
	LastSyncedAt     *time.Time
	LastSyncedDevice string    `gorm:"type:text"`
	Meta             string    `gorm:"type:text"`
	CreatedAt        time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt        time.Time `gorm:"not null;autoUpdateTime"`
}

func (AgentWorkspace) TableName() string { return "agent_workspaces" }

type AgentWorkspaceFile struct {
	ID             string `gorm:"primaryKey;type:varchar(36)"`
	WorkspaceID    string `gorm:"not null;type:varchar(36);index:idx_workspace_file_workspace_id"`
	Path           string `gorm:"not null;type:text"`
	Size           int64  `gorm:"not null;default:0"`
	SHA256         string `gorm:"type:text"`
	MimeType       string `gorm:"type:text"`
	LastModifiedAt *time.Time
	CreatedAt      time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime"`
}

func (AgentWorkspaceFile) TableName() string { return "agent_workspace_files" }
