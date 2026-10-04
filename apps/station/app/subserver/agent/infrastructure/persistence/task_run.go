package persistence

import (
	"database/sql/driver"
	"fmt"
	"time"
)

type NullableConversationID string

func (id NullableConversationID) Value() (driver.Value, error) {
	if id == "" {
		return nil, nil
	}
	return string(id), nil
}

func (id *NullableConversationID) Scan(value any) error {
	switch typed := value.(type) {
	case nil:
		*id = ""
	case string:
		*id = NullableConversationID(typed)
	case []byte:
		*id = NullableConversationID(string(typed))
	default:
		return fmt.Errorf("scan TaskRun conversation_id from %T", value)
	}
	return nil
}

// TaskRun is the Station-owned lifecycle owner for an agent task.
// A Chat conversation maps to exactly one TaskRun with surface=CHAT; the
// ConversationID column carries the find-or-create key so a conversation can
// only ever own a single root task.
type TaskRun struct {
	TaskID              string                 `gorm:"primaryKey;type:varchar(36)"`
	Title               string                 `gorm:"type:text"`
	Description         string                 `gorm:"type:text"`
	Surface             int32                  `gorm:"not null;type:integer;index:idx_agent_task_runs_surface"`
	Status              int32                  `gorm:"not null;type:integer;index:idx_agent_task_runs_status"`
	OwnerActorPTID      string                 `gorm:"column:owner_actor_ptid;not null;type:text;index:idx_agent_task_runs_owner"`
	WorkspaceID         string                 `gorm:"type:varchar(64)"`
	ConversationID      NullableConversationID `gorm:"type:varchar(36);uniqueIndex:idx_agent_task_runs_conversation"`
	RootTurnID          string                 `gorm:"type:varchar(36)"`
	CurrentCheckpointID string                 `gorm:"type:varchar(36)"`
	MetaJSON            string                 `gorm:"type:text"`
	CreatedAt           time.Time              `gorm:"not null;autoCreateTime"`
	StartedAt           time.Time              `gorm:"not null;autoCreateTime"`
	UpdatedAt           time.Time              `gorm:"not null;autoUpdateTime"`
	EndedAt             *time.Time             `gorm:"type:timestamptz"`
	GoalID              string                 `gorm:"column:goal_id;not null;type:varchar(64);default:'';index:idx_agent_task_runs_goal"`
	GoalNodeID          string                 `gorm:"column:goal_node_id;not null;type:varchar(64);default:'';index:idx_agent_task_runs_goal_node"`
	RootStepID          string                 `gorm:"column:root_step_id;not null;type:varchar(36);default:''"`
}

func (TaskRun) TableName() string { return "agent_task_runs" }

// AgentGoalNode is one dependency-bound unit in a Station-owned Goal graph.
// TaskID is assigned before execution starts so every dispatch has stable
// Goal, node, task, step, and attempt identities.
type AgentGoalNode struct {
	GoalID                  string    `gorm:"column:goal_id;primaryKey;type:varchar(64)"`
	NodeID                  string    `gorm:"column:node_id;primaryKey;type:varchar(64)"`
	TaskID                  string    `gorm:"column:task_id;not null;type:varchar(36);uniqueIndex:idx_agent_goal_nodes_task"`
	Title                   string    `gorm:"column:title;not null;type:text"`
	Description             string    `gorm:"column:description;not null;type:text"`
	Status                  int32     `gorm:"column:status;not null;type:integer;index:idx_agent_goal_nodes_status"`
	PrerequisiteNodeIDsJSON string    `gorm:"column:prerequisite_node_ids_json;not null;type:text;default:'[]'"`
	Priority                int32     `gorm:"column:priority;not null;default:0"`
	CreatedAt               time.Time `gorm:"column:created_at;not null"`
	UpdatedAt               time.Time `gorm:"column:updated_at;not null"`
}

func (AgentGoalNode) TableName() string { return "agent_goal_nodes" }
