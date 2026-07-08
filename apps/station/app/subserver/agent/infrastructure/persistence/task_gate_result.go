package persistence

import "time"

// TaskGateResult stores a durable query index for gate result events.
type TaskGateResult struct {
	GateResultID    string    `gorm:"primaryKey;type:varchar(36)"`
	TaskID          string    `gorm:"not null;type:varchar(36);index:idx_agent_task_gate_results_task"`
	StepID          string    `gorm:"type:varchar(36);index:idx_agent_task_gate_results_step"`
	TurnID          string    `gorm:"type:varchar(36);index:idx_agent_task_gate_results_turn"`
	EventID         string    `gorm:"type:varchar(36);index:idx_agent_task_gate_results_event"`
	EventSeq        int64     `gorm:"not null;default:0;index:idx_agent_task_gate_results_event_seq"`
	GateID          string    `gorm:"type:varchar(64);index:idx_agent_task_gate_results_gate"`
	GatePlanID      string    `gorm:"type:varchar(64);index:idx_agent_task_gate_results_plan"`
	Name            string    `gorm:"type:text"`
	Status          string    `gorm:"type:varchar(32);index:idx_agent_task_gate_results_status"`
	Summary         string    `gorm:"type:text"`
	Blocking        bool      `gorm:"not null;default:false;index:idx_agent_task_gate_results_blocking"`
	ArtifactIDsJSON string    `gorm:"type:text"`
	ChecksJSON      string    `gorm:"type:text"`
	ProducedBy      string    `gorm:"type:varchar(128);index:idx_agent_task_gate_results_produced_by"`
	PayloadJSON     string    `gorm:"type:text"`
	CreatedAt       time.Time `gorm:"not null;default:now();index:idx_agent_task_gate_results_created"`
}

func (TaskGateResult) TableName() string { return "agent_task_gate_results" }
