package persistence

import "time"

// CollaborationTask stores an Agent Canvas orchestration task.
type CollaborationTask struct {
	ID            string    `gorm:"primaryKey;type:varchar(36)"`
	Title         string    `gorm:"not null;type:text"`
	Description   string    `gorm:"type:text"`
	EngineType    int32     `gorm:"not null;type:integer"`
	Status        int32     `gorm:"not null;type:integer;index:idx_agent_collaboration_tasks_status"`
	GoalOwnerPTID string    `gorm:"column:goal_owner_ptid;not null;type:text;index:idx_agent_collaboration_tasks_owner_ptid"`
	WorkspaceID   string    `gorm:"type:text"`
	BudgetTokens  float64   `gorm:"not null;default:0"`
	BudgetMoney   float64   `gorm:"not null;default:0"`
	BudgetTimeMs  int64     `gorm:"not null;default:0"`
	MetaJSON      string    `gorm:"type:text"`
	CreatedAt     time.Time `gorm:"not null;autoCreateTime"`
	StartedAt     time.Time `gorm:"not null;autoCreateTime"`
	EndedAt       time.Time `gorm:"not null;autoCreateTime"`
}

func (CollaborationTask) TableName() string { return "agent_collaboration_tasks" }

// CollaborationTaskNode stores the per-Agent node projection for a task.
type CollaborationTaskNode struct {
	ID                  string    `gorm:"primaryKey;type:varchar(36)"`
	TaskID              string    `gorm:"not null;type:varchar(36);index:idx_agent_collaboration_task_nodes_task"`
	ParentNodeID        string    `gorm:"type:varchar(36)"`
	AgentID             string    `gorm:"not null;type:varchar(36);index:idx_agent_collaboration_task_nodes_agent"`
	Role                string    `gorm:"type:text"`
	Description         string    `gorm:"type:text"`
	Status              int32     `gorm:"not null;type:integer"`
	PrerequisiteNodeIDs string    `gorm:"type:text"`
	ResultSummary       string    `gorm:"type:text"`
	StartedAt           time.Time `gorm:"not null;autoCreateTime"`
	EndedAt             time.Time `gorm:"not null;autoCreateTime"`
}

func (CollaborationTaskNode) TableName() string { return "agent_collaboration_task_nodes" }
