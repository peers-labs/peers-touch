package persistence

import "time"

// TurnArtifact is Station-owned metadata for a real file produced by a Turn.
// File bytes remain in the Desktop workspace until an OSS object is linked.
type TurnArtifact struct {
	ID               string    `gorm:"primaryKey;type:varchar(64)"`
	ActorPTID        string    `gorm:"column:actor_ptid;not null;type:text;index:idx_turn_artifact_actor_conversation,priority:1"`
	ConversationID   string    `gorm:"not null;type:varchar(36);index:idx_turn_artifact_actor_conversation,priority:2"`
	TurnID           string    `gorm:"not null;type:varchar(36);index:idx_turn_artifact_turn"`
	AgentID          string    `gorm:"not null;type:varchar(36);index:idx_turn_artifact_agent"`
	ToolCallID       string    `gorm:"not null;type:varchar(100);index:idx_turn_artifact_tool"`
	Kind             string    `gorm:"not null;type:varchar(20)"`
	Name             string    `gorm:"not null;type:varchar(255)"`
	Size             uint64    `gorm:"not null"`
	SHA256           string    `gorm:"not null;type:varchar(64)"`
	ClientLocalRef   string    `gorm:"not null;type:varchar(255)"`
	ClientDeviceID   string    `gorm:"not null;type:varchar(255)"`
	StationObjectRef string    `gorm:"not null;type:text;default:''"`
	CreatedAt        time.Time `gorm:"not null"`
	UpdatedAt        time.Time `gorm:"not null"`
}

func (TurnArtifact) TableName() string { return "agent_turn_artifacts" }
