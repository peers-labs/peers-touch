package db

import "time"

// ActorFederationVisibility stores one actor-owned visibility cap for one
// Federation. The global Actor.Visibility remains the upper bound.
type ActorFederationVisibility struct {
	ActorID            uint64 `gorm:"column:actor_id;primaryKey;autoIncrement:false"`
	FederationID       string `gorm:"column:federation_id;type:varchar(30);primaryKey"`
	ActorRefBytes      []byte `gorm:"column:actor_ref_bytes;type:bytea;not null"`
	StationPeerID      string `gorm:"column:station_peer_id;type:varchar(128);not null;index"`
	Visibility         int16  `gorm:"column:visibility;not null"`
	UpdatedByActorPTID string `gorm:"column:updated_by_actor_ptid;type:varchar(255);not null"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

func (*ActorFederationVisibility) TableName() string {
	return "touch_actor_federation_visibility"
}
