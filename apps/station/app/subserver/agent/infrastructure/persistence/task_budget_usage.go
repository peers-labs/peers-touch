package persistence

import "time"

// TaskBudgetUsage stores Station-owned budget usage evidence for orchestration.
type TaskBudgetUsage struct {
	BudgetUsageID           string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID                  string    `gorm:"not null;type:varchar(36);index:idx_agent_task_budget_usages_task"`
	StepID                  string    `gorm:"type:varchar(36);index:idx_agent_task_budget_usages_step"`
	EventID                 string    `gorm:"type:varchar(36);index:idx_agent_task_budget_usages_event"`
	EventSeq                int64     `gorm:"not null;default:0;index:idx_agent_task_budget_usages_event_seq"`
	BudgetID                string    `gorm:"type:varchar(128);index:idx_agent_task_budget_usages_budget"`
	DirectRunID             string    `gorm:"type:varchar(64);index:idx_agent_task_budget_usages_direct_run"`
	ProviderID              string    `gorm:"type:varchar(128);index:idx_agent_task_budget_usages_provider"`
	Model                   string    `gorm:"type:varchar(128);index:idx_agent_task_budget_usages_model"`
	InputTokens             int64     `gorm:"not null;default:0"`
	OutputTokens            int64     `gorm:"not null;default:0"`
	TotalTokens             int64     `gorm:"not null;default:0;index:idx_agent_task_budget_usages_total_tokens"`
	UsedMoney               float64   `gorm:"not null;default:0"`
	EstimatedMoney          float64   `gorm:"not null;default:0"`
	ProviderBilledMoney     float64   `gorm:"not null;default:0"`
	ProviderBillingSource   string    `gorm:"type:varchar(128);index:idx_agent_task_budget_usages_billing_source"`
	ProviderBillingCurrency string    `gorm:"type:varchar(16)"`
	InputTokenPrice         float64   `gorm:"not null;default:0"`
	OutputTokenPrice        float64   `gorm:"not null;default:0"`
	PricingSource           string    `gorm:"type:varchar(128);index:idx_agent_task_budget_usages_pricing_source"`
	Source                  string    `gorm:"type:varchar(128);index:idx_agent_task_budget_usages_source"`
	PayloadJSON             string    `gorm:"type:text"`
	CreatedAt               time.Time `gorm:"not null;autoCreateTime;index:idx_agent_task_budget_usages_created"`
}

func (TaskBudgetUsage) TableName() string { return "agent_task_budget_usages" }
