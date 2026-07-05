package persistence

import (
	"encoding/json"
	"time"
)

// Skill maps to the agent_skills table.
// 2026-04-11 — Added Enabled field: disabled skills are excluded from
//
//	BuildSkillIndex, allowing temporary deactivation without deletion.
type Skill struct {
	ID          string          `gorm:"primaryKey;type:varchar(36)"`
	AgentID     string          `gorm:"not null;type:varchar(36);index:idx_skills_agent_id;uniqueIndex:idx_skills_agent_name,priority:1"`
	Name        string          `gorm:"not null;type:varchar(128);uniqueIndex:idx_skills_agent_name,priority:2"`
	Description string          `gorm:"not null;type:text"`
	Category    *string         `gorm:"type:varchar(64)"`
	Platforms   json.RawMessage `gorm:"type:jsonb"`
	Conditions  json.RawMessage `gorm:"type:jsonb"`
	Content     string          `gorm:"not null;type:text"`
	Source      *string         `gorm:"type:text"`
	TrustLevel  string          `gorm:"not null;type:varchar(20);default:'community'"`
	ScanVerdict *string         `gorm:"type:varchar(20)"`
	Enabled     bool            `gorm:"not null;default:true"`
	Version     int             `gorm:"not null;default:1"`
	ViewCount   int             `gorm:"not null;default:0"`
	ApplyCount  int             `gorm:"not null;default:0"`
	PatchCount  int             `gorm:"not null;default:0"`
	LastUsedAt  *time.Time      `gorm:"type:timestamptz"`
	CreatedAt   time.Time       `gorm:"not null;autoCreateTime"`
	UpdatedAt   time.Time       `gorm:"not null;autoUpdateTime"`
}

// TableName sets the table name.
func (Skill) TableName() string { return "agent_skills" }
