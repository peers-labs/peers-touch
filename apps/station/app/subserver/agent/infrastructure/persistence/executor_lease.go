package persistence

import "time"

// ExecutorLease fences step execution: a step only runs while its owner holds a
// valid lease (ExecutorID = Station worker instance id, ExpiresAt = now + ttl).
// The worker heartbeats to renew; an expired lease lets recovery reclaim the
// step at a step boundary.
type ExecutorLease struct {
	LeaseID      string    `gorm:"primaryKey;type:varchar(36)"`
	TaskID       string    `gorm:"not null;type:varchar(36);index:idx_agent_executor_leases_task"`
	StepID       string    `gorm:"type:varchar(36);index:idx_agent_executor_leases_step"`
	ExecutorID   string    `gorm:"not null;type:varchar(128)"`
	ExecutorKind int32     `gorm:"not null;type:integer"`
	Status       string    `gorm:"not null;type:varchar(32);index:idx_agent_executor_leases_status"`
	AcquiredAt   time.Time `gorm:"not null;autoCreateTime"`
	HeartbeatAt  time.Time `gorm:"not null;autoCreateTime"`
	ExpiresAt    time.Time `gorm:"not null;autoCreateTime;index:idx_agent_executor_leases_expires"`
}

func (ExecutorLease) TableName() string { return "agent_executor_leases" }
