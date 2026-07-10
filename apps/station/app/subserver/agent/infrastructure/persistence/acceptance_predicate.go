package persistence

import "time"

// AcceptancePredicate stores Station-owned acceptance predicate registry state.
type AcceptancePredicate struct {
	PredicateID    string    `gorm:"primaryKey;type:varchar(64)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_acceptance_predicates_task"`
	Scope          string    `gorm:"type:varchar(32);index:idx_agent_acceptance_predicates_scope"`
	Level          string    `gorm:"type:varchar(8);index:idx_agent_acceptance_predicates_level"`
	Evaluator      string    `gorm:"type:varchar(32);index:idx_agent_acceptance_predicates_evaluator"`
	Expr           string    `gorm:"type:text"`
	LastEval       *bool     `gorm:"index:idx_agent_acceptance_predicates_last_eval"`
	HumanSignoff   bool      `gorm:"not null;default:false;index:idx_agent_acceptance_predicates_human_signoff"`
	SourceEventID  string    `gorm:"type:varchar(36);index:idx_agent_acceptance_predicates_event"`
	SourceEventSeq int64     `gorm:"not null;default:0;index:idx_agent_acceptance_predicates_event_seq"`
	PayloadJSON    string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;default:now();index:idx_agent_acceptance_predicates_created"`
	UpdatedAt      time.Time `gorm:"not null;default:now();index:idx_agent_acceptance_predicates_updated"`
}

func (AcceptancePredicate) TableName() string { return "agent_acceptance_predicates" }
