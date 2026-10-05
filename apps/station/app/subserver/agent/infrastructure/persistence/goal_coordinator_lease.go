package persistence

import "time"

const GoalCoordinatorLeaseActive = "active"

// GoalCoordinatorLease fences scheduling decisions for one Goal graph.
// Generation advances only after expiry takeover; dispatch sequence advances
// for every newly prepared TaskRun under the current generation.
type GoalCoordinatorLease struct {
	GoalID           string    `gorm:"column:goal_id;primaryKey;type:varchar(64)"`
	OwnerID          string    `gorm:"column:owner_id;not null;type:varchar(128);index:idx_goal_coordinator_leases_owner"`
	Generation       uint64    `gorm:"column:generation;not null;default:1"`
	GoalRevision     uint64    `gorm:"column:goal_revision;not null"`
	GraphRevision    uint64    `gorm:"column:graph_revision;not null"`
	DispatchSequence uint64    `gorm:"column:dispatch_sequence;not null;default:0"`
	Status           string    `gorm:"column:status;not null;type:varchar(32);index:idx_goal_coordinator_leases_status"`
	AcquiredAt       time.Time `gorm:"column:acquired_at;not null"`
	HeartbeatAt      time.Time `gorm:"column:heartbeat_at;not null"`
	ExpiresAt        time.Time `gorm:"column:expires_at;not null;index:idx_goal_coordinator_leases_expires"`
	UpdatedAt        time.Time `gorm:"column:updated_at;not null"`
}

func (GoalCoordinatorLease) TableName() string {
	return "agent_goal_coordinator_leases"
}
