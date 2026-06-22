package db

import (
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/util/id"
	"gorm.io/gorm"
)

// SocialStationModerationPolicy stores Station-scoped trust decisions
// used by federated social projections. Actor block remains in the
// friend-chat friendship graph; this table is for remote Station policy.
type SocialStationModerationPolicy struct {
	ID uint64 `gorm:"column:id;primaryKey;autoIncrement:false"`

	StationDomain string `gorm:"column:station_domain;type:varchar(255);index:idx_social_station_moderation_domain"`
	StationPeerID string `gorm:"column:station_peer_id;type:varchar(255);index:idx_social_station_moderation_peer"`
	Kind          string `gorm:"column:kind;type:varchar(48);not null;index:idx_social_station_moderation_kind"`
	Reason        string `gorm:"column:reason;type:text"`

	CreatedByActorID uint64 `gorm:"column:created_by_actor_id;index"`
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        gorm.DeletedAt `gorm:"index"`
}

func (SocialStationModerationPolicy) TableName() string {
	return "social_station_moderation_policies"
}

func (p *SocialStationModerationPolicy) BeforeCreate(tx *gorm.DB) error {
	if p.ID == 0 {
		p.ID = id.NextID()
	}
	return nil
}
