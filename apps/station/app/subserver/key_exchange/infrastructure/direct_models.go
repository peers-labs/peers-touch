package infrastructure

import (
	"strconv"
	"strings"
	"time"
)

// IdentityKeyModel stores the immutable Direct identity key for one actor
// device and the latest supported wire-version advertisement.
type IdentityKeyModel struct {
	ActorPtid         string    `gorm:"column:actor_ptid;size:255;primaryKey"`
	DeviceID          string    `gorm:"column:device_id;size:128;primaryKey"`
	IdentityKeyPub    []byte    `gorm:"column:identity_key_pub;type:bytea"`
	KeyFingerprint    string    `gorm:"column:key_fingerprint;size:128"`
	PublishedAtUnixMs int64     `gorm:"column:published_at_unix_ms"`
	SupportedVersions string    `gorm:"column:supported_versions;size:64"`
	CreatedAt         time.Time `gorm:"column:created_at"`
	UpdatedAt         time.Time `gorm:"column:updated_at"`
}

func (*IdentityKeyModel) TableName() string {
	return "key_exchange_identity_keys"
}

// SignedPreKeyModel stores the monotonic signed pre-key for one active device.
type SignedPreKeyModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorPtid string    `gorm:"column:actor_ptid;size:255;index:idx_ke_spk_actor_device,priority:1"`
	DeviceID  string    `gorm:"column:device_id;size:128;index:idx_ke_spk_actor_device,priority:2"`
	SPKID     int32     `gorm:"column:spk_id"`
	PublicKey []byte    `gorm:"column:public_key;type:bytea"`
	Signature []byte    `gorm:"column:signature;type:bytea"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (*SignedPreKeyModel) TableName() string {
	return "key_exchange_signed_pre_keys"
}

// OneTimePreKeyModel stores one consumable Direct pre-key for an actor device.
type OneTimePreKeyModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorPtid string    `gorm:"column:actor_ptid;size:255;uniqueIndex:idx_ke_opk_actor_dev_opkid,priority:1"`
	DeviceID  string    `gorm:"column:device_id;size:128;uniqueIndex:idx_ke_opk_actor_dev_opkid,priority:2"`
	OPKID     int32     `gorm:"column:opk_id;uniqueIndex:idx_ke_opk_actor_dev_opkid,priority:3"`
	PublicKey []byte    `gorm:"column:public_key;type:bytea"`
	Consumed  bool      `gorm:"column:consumed;default:false;index:idx_ke_opk_actor_dev_consumed,priority:3"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (*OneTimePreKeyModel) TableName() string {
	return "key_exchange_one_time_pre_keys"
}

func encodeSupportedVersions(versions []uint32) string {
	if len(versions) == 0 {
		return "0"
	}
	parts := make([]string, 0, len(versions))
	for _, version := range versions {
		parts = append(parts, strconv.FormatUint(uint64(version), 10))
	}
	return strings.Join(parts, ",")
}

func decodeSupportedVersions(value string) []uint32 {
	if strings.TrimSpace(value) == "" {
		return []uint32{0}
	}
	parts := strings.Split(value, ",")
	versions := make([]uint32, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.ParseUint(strings.TrimSpace(part), 10, 32)
		if err != nil {
			continue
		}
		versions = append(versions, uint32(parsed))
	}
	if len(versions) == 0 {
		return []uint32{0}
	}
	return versions
}
