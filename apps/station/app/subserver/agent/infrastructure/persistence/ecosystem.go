// Changelog:
// 2026-08-14 — M11 localStorage→Station migration: persistence models for
//   Ecosystem Agent Groups and Topic Comments.

package persistence

import "time"

// EcosystemAgentGroup represents a user-defined group of agents for orchestration.
type EcosystemAgentGroup struct {
	ID                string    `gorm:"primaryKey;type:varchar(36)"`
	Name              string    `gorm:"not null;type:text"`
	Description       string    `gorm:"type:text"`
	MemberAgentIDs    string    `gorm:"type:text"` // JSON array of agent IDs
	OrchestrationMode string    `gorm:"type:varchar(20);default:'sequential'"`
	OwnerActorPTID    string    `gorm:"column:owner_actor_ptid;not null;type:text;index"`
	CreatedAt         time.Time `gorm:"not null;autoCreateTime"`
	UpdatedAt         time.Time `gorm:"not null;autoUpdateTime"`
}

func (EcosystemAgentGroup) TableName() string { return "ecosystem_agent_groups" }

// EcosystemTopicComment stores discussion comments on ecosystem topics.
type EcosystemTopicComment struct {
	ID         string    `gorm:"primaryKey;type:varchar(36)"`
	TopicKey   string    `gorm:"not null;type:varchar(36);index"`
	Content    string    `gorm:"not null;type:text"`
	AuthorPTID string    `gorm:"column:author_ptid;not null;type:text"`
	CreatedAt  time.Time `gorm:"not null;autoCreateTime"`
}

func (EcosystemTopicComment) TableName() string { return "ecosystem_topic_comments" }
