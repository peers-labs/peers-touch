package persistence

import "time"

// AgentWorkspaceSandbox is the Station-authoritative allocation/authorization
// row for a WORKSPACE_SANDBOX execution target (WE-S2). Station never owns the
// process: state REQUESTED/ALLOCATED/DORMANT/FAILED/RELEASED reflects live
// provisioner truth. The container is disposable; the workspace volume is the
// persistence unit.
type AgentWorkspaceSandbox struct {
	SandboxRef    string     `gorm:"primaryKey;type:varchar(96)"`
	ActorPtid     string     `gorm:"not null;type:text;index:idx_workspace_sandbox_actor_agent_root,priority:1"`
	AgentID       string     `gorm:"not null;type:varchar(64);index:idx_workspace_sandbox_actor_agent_root,priority:2"`
	WorkspaceRoot string     `gorm:"not null;type:text;index:idx_workspace_sandbox_actor_agent_root,priority:3;index:idx_workspace_sandbox_active_root"`
	ImageRef      string     `gorm:"not null;type:text"`
	State         string     `gorm:"not null;type:varchar(16);index"`
	BackendKind   string     `gorm:"not null;type:varchar(32)"`
	VolumeRef     string     `gorm:"type:text"`
	Revision      uint64     `gorm:"not null"`
	CreatedAt     time.Time  `gorm:"not null"`
	LastLiveAt    time.Time  `gorm:"not null"`
	ReleasedAt    *time.Time `gorm:"index"`
}

func (AgentWorkspaceSandbox) TableName() string { return "agent_workspace_sandboxes" }
