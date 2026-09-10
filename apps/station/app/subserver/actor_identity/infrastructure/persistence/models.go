package persistence

import "time"

// ActorIdentityModel stores the continuity key and monotonic profile fence.
type ActorIdentityModel struct {
	PTID           string    `gorm:"column:ptid;size:255;primaryKey"`
	PublicKey      []byte    `gorm:"column:public_key;type:bytea;not null"`
	Fingerprint    []byte    `gorm:"column:fingerprint;type:bytea;not null"`
	ProfileVersion int64     `gorm:"column:profile_version;not null"`
	CreatedAt      time.Time `gorm:"column:created_at;not null"`
	UpdatedAt      time.Time `gorm:"column:updated_at;not null"`
}

// TableName binds ActorIdentityModel to the existing identity-owned table.
func (*ActorIdentityModel) TableName() string {
	return "actor_identity_keys"
}

// ActorDeviceModel is the canonical persistence projection for actor_devices.
type ActorDeviceModel struct {
	ID                 int64      `gorm:"column:id;primaryKey;autoIncrement"`
	PTID               string     `gorm:"column:ptid;size:255;not null;index:idx_device_ptid;uniqueIndex:idx_device_ptid_device,priority:1"`
	ActorAccount       string     `gorm:"column:actor_acct;size:255;not null"`
	ActorKind          int32      `gorm:"column:actor_kind;not null"`
	DeviceID           string     `gorm:"column:device_id;size:255;not null;uniqueIndex:idx_device_ptid_device,priority:2"`
	Label              string     `gorm:"column:label;size:255;not null"`
	HomeStationPeerID  string     `gorm:"column:home_station_peer_id;size:255;not null"`
	SigningKeyID       string     `gorm:"column:signing_key_id;size:255;not null;index"`
	PublicKey          []byte     `gorm:"column:public_key;type:bytea;not null"`
	ProfileVersion     int64      `gorm:"column:profile_version;not null"`
	VerificationSource int32      `gorm:"column:verification_source;not null"`
	Revoked            bool       `gorm:"column:revoked;not null;default:false"`
	CreatedAt          time.Time  `gorm:"column:created_at;not null"`
	RevokedAt          *time.Time `gorm:"column:revoked_at"`
}

// TableName binds ActorDeviceModel to the sole actor-device truth store.
func (*ActorDeviceModel) TableName() string {
	return "actor_devices"
}

type actorDeviceMetadataMigrationModel struct {
	ID           int64   `gorm:"column:id;primaryKey"`
	PTID         string  `gorm:"column:ptid;size:255"`
	ActorAccount *string `gorm:"column:actor_acct;size:255"`
	ActorKind    *int32  `gorm:"column:actor_kind"`
}

func (*actorDeviceMetadataMigrationModel) TableName() string {
	return "actor_devices"
}

type actorMetadataMigrationRow struct {
	PTID              string `gorm:"column:ptid"`
	PreferredUsername string `gorm:"column:preferred_username"`
	FederatedHandle   string `gorm:"column:federated_handle"`
	Kind              string `gorm:"column:kind"`
}

// ActorEndpointDirectoryVersionModel fences signed routing snapshots by Actor.
type ActorEndpointDirectoryVersionModel struct {
	ActorPTID   string    `gorm:"column:actor_ptid;size:255;primaryKey"`
	Version     uint64    `gorm:"column:directory_version;not null"`
	StateSHA256 []byte    `gorm:"column:state_sha256;type:bytea;not null"`
	UpdatedAt   time.Time `gorm:"column:updated_at;not null"`
}

// TableName binds the directory fence to the Actor Identity-owned store.
func (*ActorEndpointDirectoryVersionModel) TableName() string {
	return "actor_endpoint_directory_versions"
}
