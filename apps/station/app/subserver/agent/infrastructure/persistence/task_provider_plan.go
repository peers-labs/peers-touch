package persistence

import "time"

// TaskProviderPlan stores the Station-owned typed provider plan for a task.
type TaskProviderPlan struct {
	ProviderPlanID string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_task_provider_plans_task"`
	Source         string    `gorm:"type:varchar(128);index:idx_agent_task_provider_plans_source"`
	Status         string    `gorm:"type:varchar(32);index:idx_agent_task_provider_plans_status"`
	PlanJSON       string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;default:now();index:idx_agent_task_provider_plans_created"`
	UpdatedAt      time.Time `gorm:"not null;default:now();index:idx_agent_task_provider_plans_updated"`
}

func (TaskProviderPlan) TableName() string { return "agent_task_provider_plans" }
