package infrastructure

import "time"

type socialRelationshipCommandModel struct {
	ActorPTID            string     `gorm:"column:actor_ptid;size:255;primaryKey"`
	CommandID            string     `gorm:"column:command_id;size:255;primaryKey"`
	CommandBytes         []byte     `gorm:"column:command_bytes;type:bytea;not null"`
	CommandPayloadSHA256 []byte     `gorm:"column:command_payload_sha256;type:bytea;not null"`
	ResultBytes          []byte     `gorm:"column:result_bytes;type:bytea;not null"`
	CreatedAt            time.Time  `gorm:"column:created_at;not null"`
	ResolvedAt           *time.Time `gorm:"column:resolved_at"`
}

func (*socialRelationshipCommandModel) TableName() string {
	return "social_relationship_commands"
}

type socialDirectionalRelationshipModel struct {
	ActorPTID               string     `gorm:"column:actor_ptid;size:255;primaryKey"`
	TargetActorPTID         string     `gorm:"column:target_actor_ptid;size:255;primaryKey"`
	ActorHomeStationPeerID  string     `gorm:"column:actor_home_station_peer_id;size:255;not null"`
	TargetHomeStationPeerID string     `gorm:"column:target_home_station_peer_id;size:255;not null"`
	Blocked                 bool       `gorm:"column:blocked;not null;index:idx_social_directional_block_list,priority:1"`
	Revision                int64      `gorm:"column:revision;not null"`
	LastEventHash           []byte     `gorm:"column:last_event_hash;type:bytea"`
	LastEventBytes          []byte     `gorm:"column:last_event_bytes;type:bytea"`
	BlockedAt               *time.Time `gorm:"column:blocked_at;index:idx_social_directional_block_list,priority:2"`
	UpdatedAt               time.Time  `gorm:"column:updated_at;not null"`
}

func (*socialDirectionalRelationshipModel) TableName() string {
	return "social_directional_relationships"
}
