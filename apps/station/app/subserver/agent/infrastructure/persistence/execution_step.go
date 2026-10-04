package persistence

import "time"

// ExecutionStep is a DAG step within a TaskRun. For a Chat root task one user
// message becomes one ExecutionStep bound to a single TurnID; the Attempt
// column expresses retry generations so an interrupted turn is never replayed —
// a new attempt creates a new step/turn instead.
type ExecutionStep struct {
	StepID            string     `gorm:"primaryKey;type:varchar(36)"`
	TaskID            string     `gorm:"not null;type:varchar(36);index:idx_agent_execution_steps_task"`
	ParentStepID      string     `gorm:"type:varchar(36)"`
	AgentID           string     `gorm:"not null;type:varchar(36);index:idx_agent_execution_steps_agent"`
	Role              string     `gorm:"type:text"`
	Description       string     `gorm:"type:text"`
	Status            int32      `gorm:"not null;type:integer;index:idx_agent_execution_steps_status"`
	TurnID            string     `gorm:"type:varchar(36);index:idx_agent_execution_steps_turn"`
	Attempt           int32      `gorm:"not null;default:1"`
	AttemptID         string     `gorm:"column:attempt_id;not null;type:varchar(36);default:'';index:idx_agent_execution_steps_attempt"`
	EligibleExecutors string     `gorm:"type:text"`
	ResultSummary     string     `gorm:"type:text"`
	StartedAt         time.Time  `gorm:"not null;autoCreateTime"`
	EndedAt           *time.Time `gorm:"type:timestamptz"`
}

func (ExecutionStep) TableName() string { return "agent_execution_steps" }
