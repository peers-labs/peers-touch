package persistence

import "time"

// AgentGoal is the Station-owned durable root for one user objective.
type AgentGoal struct {
	GoalID                 string    `gorm:"column:goal_id;primaryKey;type:varchar(64)"`
	OwnerPTID              string    `gorm:"column:owner_ptid;not null;type:text;uniqueIndex:idx_agent_goals_owner_idempotency,priority:1;index:idx_agent_goals_owner_updated,priority:1"`
	WorkspaceID            string    `gorm:"column:workspace_id;not null;type:varchar(64);default:''"`
	Title                  string    `gorm:"column:title;not null;type:text"`
	Outcome                string    `gorm:"column:outcome;not null;type:text"`
	NonGoalsJSON           []byte    `gorm:"column:non_goals_json;not null;type:jsonb"`
	ConstraintsJSON        []byte    `gorm:"column:constraints_json;not null;type:jsonb"`
	BudgetJSON             []byte    `gorm:"column:budget_json;not null;type:jsonb"`
	AcceptanceCriteriaJSON []byte    `gorm:"column:acceptance_criteria_json;not null;type:jsonb"`
	Status                 int32     `gorm:"column:status;not null"`
	Revision               uint64    `gorm:"column:revision;not null;default:1"`
	GraphRevision          uint64    `gorm:"column:graph_revision;not null;default:0"`
	AcceptanceRevision     uint64    `gorm:"column:acceptance_revision;not null;default:0"`
	CreateIdempotencyKey   string    `gorm:"column:create_idempotency_key;not null;type:varchar(160);uniqueIndex:idx_agent_goals_owner_idempotency,priority:2"`
	CreatePayloadHash      string    `gorm:"column:create_payload_hash;not null;type:varchar(64)"`
	CreatedAt              time.Time `gorm:"column:created_at;not null"`
	UpdatedAt              time.Time `gorm:"column:updated_at;not null;index:idx_agent_goals_owner_updated,priority:2"`
}

func (AgentGoal) TableName() string {
	return "agent_goals"
}
