package persistence

import "time"

// InterruptRequest stores the durable lifecycle of a human or policy interrupt.
type InterruptRequest struct {
	InterruptID       string     `gorm:"primaryKey;type:varchar(36)"`
	TaskID            string     `gorm:"not null;type:varchar(36);index:idx_agent_interrupt_requests_task"`
	StepID            string     `gorm:"type:varchar(36);index:idx_agent_interrupt_requests_step"`
	TurnID            string     `gorm:"type:varchar(36);index:idx_agent_interrupt_requests_turn"`
	InterruptType     string     `gorm:"type:text"`
	Status            int32      `gorm:"not null;type:integer;index:idx_agent_interrupt_requests_status"`
	PayloadJSON       string     `gorm:"type:text"`
	ResumePayloadJSON string     `gorm:"type:text"`
	CreatedAt         time.Time  `gorm:"not null;autoCreateTime;index:idx_agent_interrupt_requests_created"`
	ResolvedAt        *time.Time `gorm:"index:idx_agent_interrupt_requests_resolved"`
	ConsumedAt        *time.Time `gorm:"index:idx_agent_interrupt_requests_consumed"`
	ConsumedStepID    string     `gorm:"type:varchar(36);index:idx_agent_interrupt_requests_consumed_step"`
	ConsumedTurnID    string     `gorm:"type:varchar(36);index:idx_agent_interrupt_requests_consumed_turn"`
}

func (InterruptRequest) TableName() string { return "agent_interrupt_requests" }
