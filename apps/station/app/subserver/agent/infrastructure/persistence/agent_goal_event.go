package persistence

import "time"

// AgentGoalEvent is the replayable business event for one committed Goal
// revision. Realtime delivery is a projection of this row, never its owner.
type AgentGoalEvent struct {
	DomainEventID string    `gorm:"column:domain_event_id;primaryKey;type:varchar(64)"`
	GoalID        string    `gorm:"column:goal_id;not null;type:varchar(64);uniqueIndex:idx_agent_goal_events_goal_seq,priority:1;index"`
	EventSeq      uint64    `gorm:"column:event_seq;not null;uniqueIndex:idx_agent_goal_events_goal_seq,priority:2"`
	EventType     string    `gorm:"column:event_type;not null;type:varchar(96);index"`
	GoalRevision  uint64    `gorm:"column:goal_revision;not null"`
	CreatedAt     time.Time `gorm:"column:created_at;not null;index"`
}

func (AgentGoalEvent) TableName() string {
	return "agent_goal_events"
}
