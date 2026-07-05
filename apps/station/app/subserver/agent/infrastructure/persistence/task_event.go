package persistence

import "time"

// TaskEvent stores the durable event outbox for Station-owned agent tasks.
type TaskEvent struct {
	ID        string    `gorm:"primaryKey;type:varchar(36)"`
	TaskID    string    `gorm:"not null;type:varchar(36);uniqueIndex:idx_agent_task_events_task_seq;index:idx_agent_task_events_task"`
	StepID    string    `gorm:"type:varchar(36);index:idx_agent_task_events_step"`
	TurnID    string    `gorm:"type:varchar(36);index:idx_agent_task_events_turn"`
	EventSeq  int64     `gorm:"not null;uniqueIndex:idx_agent_task_events_task_seq"`
	EventType int32     `gorm:"not null;type:integer;index:idx_agent_task_events_type"`
	Payload   string    `gorm:"type:text"`
	CreatedAt time.Time `gorm:"not null;autoCreateTime;index:idx_agent_task_events_created"`
}

func (TaskEvent) TableName() string { return "agent_task_events" }
