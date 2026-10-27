package persistence

import "time"

// SkillResource binds one immutable content blob to a Skill version through a
// package-relative path. Rows are append-only: updating a Skill creates a new
// version and a new set of references.
type SkillResource struct {
	ID             string    `gorm:"primaryKey;type:varchar(36)"`
	SkillID        string    `gorm:"not null;type:varchar(36);index:idx_skill_resources_version,priority:1;uniqueIndex:idx_skill_resource_path,priority:1"`
	AgentID        string    `gorm:"not null;type:varchar(36);index"`
	Version        int       `gorm:"not null;index:idx_skill_resources_version,priority:2;uniqueIndex:idx_skill_resource_path,priority:2"`
	Path           string    `gorm:"not null;type:varchar(255);uniqueIndex:idx_skill_resource_path,priority:3"`
	Kind           string    `gorm:"not null;type:varchar(32);index"`
	ExecutionOwner string    `gorm:"not null;type:varchar(32)"`
	ContentHash    string    `gorm:"not null;type:varchar(64);index"`
	Size           uint64    `gorm:"not null"`
	CreatedAt      time.Time `gorm:"not null"`
	UpdatedAt      time.Time `gorm:"not null"`
}

func (SkillResource) TableName() string { return "agent_skill_resources" }
