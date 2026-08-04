package persistence

import "time"

// DirectRun stores the Station-owned runtime record for a direct model intent.
type DirectRun struct {
	DirectRunID       string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID            string    `gorm:"type:varchar(36);index:idx_agent_direct_runs_task"`
	ProviderID        string    `gorm:"not null;type:varchar(128);index:idx_agent_direct_runs_provider"`
	ModelIntent       string    `gorm:"not null;type:varchar(128);index:idx_agent_direct_runs_model"`
	InputSnapshotJSON string    `gorm:"type:text"`
	BudgetRef         string    `gorm:"type:varchar(128);index:idx_agent_direct_runs_budget"`
	PolicyRef         string    `gorm:"type:varchar(128);index:idx_agent_direct_runs_policy"`
	TraceID           string    `gorm:"type:varchar(128);index:idx_agent_direct_runs_trace"`
	State             string    `gorm:"type:varchar(64);index:idx_agent_direct_runs_state"`
	Source            string    `gorm:"type:varchar(128);index:idx_agent_direct_runs_source"`
	CreatedAt         time.Time `gorm:"not null;autoCreateTime;index:idx_agent_direct_runs_created"`
	UpdatedAt         time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_direct_runs_updated"`
}

func (DirectRun) TableName() string { return "agent_direct_runs" }
