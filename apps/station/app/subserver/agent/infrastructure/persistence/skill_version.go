// Changelog:
// 2026-04-11 — Created SkillVersion persistence model: records a version of a
//   skill's content before each mutation, enabling rollback when a skill patch
//   causes regression (the "dumbed-down agent" recovery path for skills).

package persistence

import "time"

// SkillVersion records a version of a skill's content before each mutation.
type SkillVersion struct {
	ID        string    `gorm:"primaryKey;type:varchar(36)"`
	SkillID   string    `gorm:"not null;type:varchar(36);index:idx_skill_versions_skill_id"`
	AgentID   string    `gorm:"not null;type:varchar(36);index:idx_skill_versions_agent"`
	Version   int       `gorm:"not null"`
	Content   string    `gorm:"not null;type:text"`
	Trigger   string    `gorm:"not null;type:varchar(30)"` // create, patch, rollback
	CreatedAt time.Time `gorm:"not null;default:now()"`
}

// TableName sets the table name.
func (SkillVersion) TableName() string { return "agent_skill_versions" }
