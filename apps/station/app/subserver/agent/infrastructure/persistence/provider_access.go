package persistence

import "time"

// ProviderAccessGrant is owned by the Provider record, independently of the
// request actor and its conversation state.
type ProviderAccessGrant struct {
	ID               string `gorm:"primaryKey;type:varchar(36)"`
	ProviderRecordID string `gorm:"not null;type:varchar(36);index"`
	AllActors        bool   `gorm:"not null"`
	ActorPTID        string `gorm:"column:actor_ptid;not null;type:text;default:''"`
	AllModels        bool   `gorm:"not null"`
	ModelID          string `gorm:"not null;type:text;default:''"`
}

func (ProviderAccessGrant) TableName() string { return "agent_provider_access_grants" }

// ProviderPolicy has one Station-owned row. Its ID is a resource key, not PTID.
type ProviderPolicy struct {
	ID                       string    `gorm:"primaryKey;type:varchar(16)"`
	PersonalProvidersEnabled bool      `gorm:"not null;default:false"`
	AIAllActors              bool      `gorm:"not null;default:true"`
	AIActorPTIDs             string    `gorm:"column:ai_actor_ptids;not null;type:text;default:'[]'"`
	Revision                 int64     `gorm:"not null;default:0"`
	UpdatedAt                time.Time `gorm:"not null;autoUpdateTime"`
}

func (ProviderPolicy) TableName() string { return "agent_provider_policy" }
