package identity

import "time"

// Identity represents the core identity of a user/entity
type Identity struct {
	ID          uint64    `gorm:"column:id;primaryKey"`
	PTID        string    `gorm:"column:ptid;uniqueIndex;size:255;not null"`
	Username    string    `gorm:"column:username;index;size:32;not null"`
	Namespace   string    `gorm:"column:namespace;index;size:64;not null"`
	Type        string    `gorm:"column:type;size:2;not null"`
	Fingerprint string    `gorm:"column:fingerprint;size:255;not null"`
	Version     string    `gorm:"column:version;size:10;default:'v1'"`
	Status      string    `gorm:"column:status;size:20;default:'active'"`
	CreatedAt   time.Time `gorm:"column:created_at;autoCreateTime"`
	UpdatedAt   time.Time `gorm:"column:updated_at;autoUpdateTime"`
}

func (*Identity) TableName() string { return "touch_identities" }

// Key represents a cryptographic key associated with an identity
type Key struct {
	ID         uint64     `gorm:"column:id;primaryKey"`
	IdentityID uint64     `gorm:"column:identity_id;index;not null"`
	PublicKey  []byte     `gorm:"column:public_key;not null"`
	Algorithm  string     `gorm:"column:algorithm;size:32;not null"`
	IsMaster   bool       `gorm:"column:is_master;default:false"`
	CreatedAt  time.Time  `gorm:"column:created_at;autoCreateTime"`
	RevokedAt  *time.Time `gorm:"column:revoked_at"`
}

func (*Key) TableName() string { return "touch_identity_keys" }
