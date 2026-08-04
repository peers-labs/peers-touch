package persistence

import "time"

// TaskGatePlan stores Station-owned gate plans for orchestration nodes.
type TaskGatePlan struct {
	GatePlanID string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID     string    `gorm:"not null;type:varchar(36);index:idx_agent_task_gate_plans_task"`
	StepID     string    `gorm:"type:varchar(36);index:idx_agent_task_gate_plans_step"`
	Source     string    `gorm:"type:varchar(128);index:idx_agent_task_gate_plans_source"`
	Status     string    `gorm:"type:varchar(32);index:idx_agent_task_gate_plans_status"`
	PlanJSON   string    `gorm:"type:text"`
	CreatedAt  time.Time `gorm:"not null;autoCreateTime;index:idx_agent_task_gate_plans_created"`
	UpdatedAt  time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_task_gate_plans_updated"`
}

func (TaskGatePlan) TableName() string { return "agent_task_gate_plans" }
