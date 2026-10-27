package persistence

import "time"

// AgentRuntimeDefault is the actor-scoped explicit default provider/model.
// At most one row exists per actor; it is the Station truth new Topics
// inherit while historical turns keep their immutable provider attribution.
type AgentRuntimeDefault struct {
	ID                uint64    `gorm:"column:id;primaryKey;autoIncrement:true" json:"id"`
	ActorPTID         string    `gorm:"column:actor_ptid;size:255;not null;uniqueIndex" json:"actor_ptid"`
	DefaultProviderID string    `gorm:"column:default_provider_id;size:128;not null;default:''" json:"default_provider_id"`
	DefaultModelID    string    `gorm:"column:default_model_id;size:255;not null;default:''" json:"default_model_id"`
	Revision          int64     `gorm:"column:revision;not null;default:1" json:"revision"`
	CreatedAt         time.Time `gorm:"column:created_at" json:"created_at"`
	UpdatedAt         time.Time `gorm:"column:updated_at" json:"updated_at"`
}

func (AgentRuntimeDefault) TableName() string { return "agent_runtime_defaults" }
