package persistence

import "time"

// AtelierPolicy stores Station-owned Policy projection query records.
type AtelierPolicy struct {
	PolicyProjectionID string    `gorm:"primaryKey;type:varchar(128)"`
	PolicyID           string    `gorm:"not null;type:varchar(64);index:idx_agent_atelier_policies_policy"`
	TaskID             string    `gorm:"not null;type:varchar(36);index:idx_agent_atelier_policies_task"`
	HardDeny           bool      `gorm:"not null;default:false;index:idx_agent_atelier_policies_hard_deny"`
	SourceEventID      string    `gorm:"type:varchar(36);index:idx_agent_atelier_policies_event"`
	SourceEventSeq     int64     `gorm:"not null;default:0;index:idx_agent_atelier_policies_event_seq"`
	PayloadJSON        string    `gorm:"type:text"`
	CreatedAt          time.Time `gorm:"not null;autoCreateTime;index:idx_agent_atelier_policies_created"`
	UpdatedAt          time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_atelier_policies_updated"`
}

func (AtelierPolicy) TableName() string { return "agent_atelier_policies" }

// AtelierPolicyRule stores Station-owned Policy rule projection query records.
type AtelierPolicyRule struct {
	RuleID         string    `gorm:"primaryKey;type:varchar(96)"`
	PolicyID       string    `gorm:"not null;type:varchar(64);index:idx_agent_atelier_policy_rules_policy"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_atelier_policy_rules_task"`
	Scope          string    `gorm:"type:varchar(32);index:idx_agent_atelier_policy_rules_scope"`
	Expr           string    `gorm:"type:text"`
	Severity       string    `gorm:"type:varchar(32);index:idx_agent_atelier_policy_rules_severity"`
	SourceEventID  string    `gorm:"type:varchar(36);index:idx_agent_atelier_policy_rules_event"`
	SourceEventSeq int64     `gorm:"not null;default:0;index:idx_agent_atelier_policy_rules_event_seq"`
	PayloadJSON    string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime;index:idx_agent_atelier_policy_rules_created"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_atelier_policy_rules_updated"`
}

func (AtelierPolicyRule) TableName() string { return "agent_atelier_policy_rules" }

// AtelierDefect stores Station-owned Defect projection query records.
type AtelierDefect struct {
	DefectID       string    `gorm:"primaryKey;type:varchar(96)"`
	TaskID         string    `gorm:"not null;type:varchar(36);index:idx_agent_atelier_defects_task"`
	Source         string    `gorm:"type:varchar(32);index:idx_agent_atelier_defects_source"`
	State          string    `gorm:"type:varchar(32);index:idx_agent_atelier_defects_state"`
	EvidenceRef    string    `gorm:"type:text"`
	Summary        string    `gorm:"type:text"`
	ExpectedChange string    `gorm:"type:text"`
	TargetRefsJSON string    `gorm:"type:text"`
	SourceEventID  string    `gorm:"type:varchar(36);index:idx_agent_atelier_defects_event"`
	SourceEventSeq int64     `gorm:"not null;default:0;index:idx_agent_atelier_defects_event_seq"`
	PayloadJSON    string    `gorm:"type:text"`
	CreatedAt      time.Time `gorm:"not null;autoCreateTime;index:idx_agent_atelier_defects_created"`
	UpdatedAt      time.Time `gorm:"not null;autoUpdateTime;index:idx_agent_atelier_defects_updated"`
}

func (AtelierDefect) TableName() string { return "agent_atelier_defects" }
