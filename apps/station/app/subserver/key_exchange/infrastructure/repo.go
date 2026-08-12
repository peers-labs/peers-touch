package infrastructure

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type IdentityKeyModel struct {
	ActorDID          string    `gorm:"column:actor_did;size:255;primaryKey"`
	DeviceID          string    `gorm:"column:device_id;size:128;primaryKey"`
	IdentityKeyPub    []byte    `gorm:"column:identity_key_pub;type:bytea"`
	KeyFingerprint    string    `gorm:"column:key_fingerprint;size:128"`
	PublishedAtUnixMs int64     `gorm:"column:published_at_unix_ms"`
	SupportedVersions string    `gorm:"column:supported_versions;size:64"`
	CreatedAt         time.Time `gorm:"column:created_at"`
	UpdatedAt         time.Time `gorm:"column:updated_at"`
}

func (IdentityKeyModel) TableName() string { return "key_exchange_identity_keys" }

type SignedPreKeyModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorDID  string    `gorm:"column:actor_did;size:255;index:idx_ke_spk_actor_device,priority:1"`
	DeviceID  string    `gorm:"column:device_id;size:128;index:idx_ke_spk_actor_device,priority:2"`
	SPKID     int32     `gorm:"column:spk_id"`
	PublicKey []byte    `gorm:"column:public_key;type:bytea"`
	Signature []byte    `gorm:"column:signature;type:bytea"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (SignedPreKeyModel) TableName() string { return "key_exchange_signed_pre_keys" }

type OneTimePreKeyModel struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	ActorDID  string    `gorm:"column:actor_did;size:255;uniqueIndex:idx_ke_opk_actor_dev_opkid,priority:1"`
	DeviceID  string    `gorm:"column:device_id;size:128;uniqueIndex:idx_ke_opk_actor_dev_opkid,priority:2"`
	OPKID     int32     `gorm:"column:opk_id;uniqueIndex:idx_ke_opk_actor_dev_opkid,priority:3"`
	PublicKey []byte    `gorm:"column:public_key;type:bytea"`
	Consumed  bool      `gorm:"column:consumed;default:false;index:idx_ke_opk_actor_dev_consumed,priority:3"`
	CreatedAt time.Time `gorm:"column:created_at"`
}

func (OneTimePreKeyModel) TableName() string { return "key_exchange_one_time_pre_keys" }

type GormRepo struct {
	db *gorm.DB
}

func NewGormRepo(db *gorm.DB) *GormRepo {
	return &GormRepo{db: db}
}

func (r *GormRepo) AutoMigrate() error {
	// One-time migration from pre-multi-device schema (identity row keyed only by
	// actor_did). If the table exists but is missing the device_id column, drop all
	// key_exchange_* tables once and recreate with composite PK (actor_did, device_id).
	//
	// Important: do NOT drop on every boot — only when legacy layout is detected —
	// otherwise a running Station would wipe published bundles every restart.
	if r.db.Migrator().HasTable(&IdentityKeyModel{}) {
		if !r.db.Migrator().HasColumn(&IdentityKeyModel{}, "device_id") {
			if err := r.db.Migrator().DropTable(&OneTimePreKeyModel{}, &SignedPreKeyModel{}, &IdentityKeyModel{}); err != nil {
				return fmt.Errorf("key_exchange: failed dropping legacy tables: %w", err)
			}
		}
	}
	if err := r.db.AutoMigrate(
		&IdentityKeyModel{},
		&SignedPreKeyModel{},
		&OneTimePreKeyModel{},
	); err != nil {
		return err
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, model := range []any{
			&OneTimePreKeyModel{},
			&SignedPreKeyModel{},
			&IdentityKeyModel{},
		} {
			if err := tx.Where("device_id IN ?", []string{"", "legacy"}).
				Delete(model).Error; err != nil {
				return fmt.Errorf("key_exchange: remove unaddressed legacy bundle rows: %w", err)
			}
		}
		return nil
	})
}

func (r *GormRepo) UpsertIdentityKey(actorDID, deviceID string, ikPub []byte, fingerprint string, publishedAtUnixMs int64, supportedVersions []uint32) error {
	now := time.Now()
	encodedVersions := encodeSupportedVersions(supportedVersions)
	var existing IdentityKeyModel
	err := r.db.Where("actor_did = ? AND device_id = ?", actorDID, deviceID).Take(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(&IdentityKeyModel{
			ActorDID:          actorDID,
			DeviceID:          deviceID,
			IdentityKeyPub:    ikPub,
			KeyFingerprint:    fingerprint,
			PublishedAtUnixMs: publishedAtUnixMs,
			SupportedVersions: encodedVersions,
			CreatedAt:         now,
			UpdatedAt:         now,
		}).Error
	}
	if err != nil {
		return err
	}
	existing.IdentityKeyPub = ikPub
	existing.KeyFingerprint = fingerprint
	existing.PublishedAtUnixMs = publishedAtUnixMs
	existing.SupportedVersions = encodedVersions
	existing.UpdatedAt = now
	return r.db.Save(&existing).Error
}

func (r *GormRepo) UpsertSignedPreKey(actorDID, deviceID string, spk domain.SignedPreKey) error {
	now := time.Now()
	var existing SignedPreKeyModel
	err := r.db.Where("actor_did = ? AND device_id = ?", actorDID, deviceID).Take(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(&SignedPreKeyModel{
			ActorDID:  actorDID,
			DeviceID:  deviceID,
			SPKID:     spk.ID,
			PublicKey: spk.PublicKey,
			Signature: spk.Signature,
			CreatedAt: now,
		}).Error
	}
	if err != nil {
		return err
	}
	existing.SPKID = spk.ID
	existing.PublicKey = spk.PublicKey
	existing.Signature = spk.Signature
	existing.CreatedAt = now
	return r.db.Save(&existing).Error
}

func (r *GormRepo) UploadOneTimePreKeys(actorDID, deviceID string, keys []domain.OneTimePreKey) error {
	if len(keys) == 0 {
		return nil
	}
	now := time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, k := range keys {
			row := OneTimePreKeyModel{
				ActorDID:  actorDID,
				DeviceID:  deviceID,
				OPKID:     k.ID,
				PublicKey: k.PublicKey,
				Consumed:  false,
				CreatedAt: now,
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// FetchKeyBundles returns device-scoped bundles. For each device, consumes at most one OPK
// when available (same semantics as the pre-multi-device server).
func (r *GormRepo) FetchKeyBundles(actorDID, filterDeviceID string) ([]domain.KeyBundle, error) {
	var iks []IdentityKeyModel
	q := r.db.Where("actor_did = ?", actorDID).Order("published_at_unix_ms DESC")
	if filterDeviceID != "" {
		q = q.Where("device_id = ?", filterDeviceID)
	}
	if err := q.Find(&iks).Error; err != nil {
		return nil, err
	}
	if len(iks) == 0 {
		return nil, gorm.ErrRecordNotFound
	}

	var out []domain.KeyBundle
	err := r.db.Transaction(func(tx *gorm.DB) error {
		for _, ik := range iks {
			var spk SignedPreKeyModel
			if err := tx.Where("actor_did = ? AND device_id = ?", ik.ActorDID, ik.DeviceID).
				Order("created_at DESC").First(&spk).Error; err != nil {
				return err
			}
			var opks []domain.OneTimePreKey
			var opk OneTimePreKeyModel
			err := tx.Where("actor_did = ? AND device_id = ? AND consumed = ?", ik.ActorDID, ik.DeviceID, false).
				Order("id ASC").
				First(&opk).Error
			if err == nil {
				if err := tx.Model(&OneTimePreKeyModel{}).
					Where("id = ?", opk.ID).
					Update("consumed", true).Error; err != nil {
					return err
				}
				opks = append(opks, domain.OneTimePreKey{
					ID:        opk.OPKID,
					PublicKey: opk.PublicKey,
					Consumed:  true,
				})
			} else if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			out = append(out, domain.KeyBundle{
				ActorDID:          ik.ActorDID,
				DeviceID:          ik.DeviceID,
				IdentityKeyPub:    ik.IdentityKeyPub,
				KeyFingerprint:    ik.KeyFingerprint,
				PublishedAtUnixMs: ik.PublishedAtUnixMs,
				SupportedVersions: decodeSupportedVersions(ik.SupportedVersions),
				SignedPreKey: domain.SignedPreKey{
					ID:        spk.SPKID,
					PublicKey: spk.PublicKey,
					Signature: spk.Signature,
					CreatedAt: spk.CreatedAt,
				},
				OneTimePreKeys: opks,
				CreatedAt:      ik.CreatedAt,
				UpdatedAt:      ik.UpdatedAt,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
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
	out := make([]uint32, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.ParseUint(strings.TrimSpace(part), 10, 32)
		if err != nil {
			continue
		}
		out = append(out, uint32(parsed))
	}
	if len(out) == 0 {
		return []uint32{0}
	}
	return out
}

func (r *GormRepo) CountAvailableOPKs(actorDID, deviceID string) (int64, error) {
	var n int64
	err := r.db.Model(&OneTimePreKeyModel{}).
		Where("actor_did = ? AND device_id = ? AND consumed = ?", actorDID, deviceID, false).
		Count(&n).Error
	return n, err
}
