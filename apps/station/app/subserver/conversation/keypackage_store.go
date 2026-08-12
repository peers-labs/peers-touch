package conversation

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// KeyPackage represents an opaque MLS KeyPackage uploaded by a device.
// KeyPackages are one-time-use: they are consumed (deleted) when fetched
// for group creation or member addition.
type KeyPackage struct {
	ID         uint      `gorm:"column:id;primaryKey"`
	Ptid       string    `gorm:"column:ptid;size:255;index:idx_kp_ptid;uniqueIndex:uidx_mls_kp_payload"`
	DeviceID   string    `gorm:"column:device_id;size:255;index:idx_kp_device;uniqueIndex:uidx_mls_kp_payload"`
	StationID  string    `gorm:"column:station_id;size:255"`
	Data       []byte    `gorm:"column:data;type:bytea"`
	DataSHA256 []byte    `gorm:"column:data_sha256;type:bytea;uniqueIndex:uidx_mls_kp_payload"`
	CreatedAt  time.Time `gorm:"column:created_at"`
}

func (*KeyPackage) TableName() string { return "mls_key_packages" }

// KeyPackageStore manages the MLS KeyPackage directory for this Station.
type KeyPackageStore struct {
	db *gorm.DB
}

func NewKeyPackageStore(db *gorm.DB) *KeyPackageStore {
	return &KeyPackageStore{db: db}
}

func (s *KeyPackageStore) AutoMigrate() error {
	if err := s.db.AutoMigrate(&KeyPackage{}); err != nil {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var keyPackages []KeyPackage
		if err := tx.
			Where("data_sha256 IS NULL OR length(data_sha256) <> ?", sha256.Size).
			Order("id ASC").
			Find(&keyPackages).Error; err != nil {
			return err
		}
		for _, keyPackage := range keyPackages {
			if len(keyPackage.Data) == 0 {
				if err := tx.Delete(&KeyPackage{}, keyPackage.ID).Error; err != nil {
					return err
				}
				continue
			}
			hash := sha256.Sum256(keyPackage.Data)
			var duplicateCount int64
			if err := tx.Model(&KeyPackage{}).
				Where(
					"id <> ? AND ptid = ? AND device_id = ? AND data_sha256 = ?",
					keyPackage.ID,
					keyPackage.Ptid,
					keyPackage.DeviceID,
					hash[:],
				).
				Count(&duplicateCount).Error; err != nil {
				return err
			}
			if duplicateCount > 0 {
				if err := tx.Delete(&KeyPackage{}, keyPackage.ID).Error; err != nil {
					return err
				}
				continue
			}
			if err := tx.Model(&KeyPackage{}).
				Where("id = ?", keyPackage.ID).
				Update("data_sha256", hash[:]).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// Upload stores a new KeyPackage for the given actor/device.
func (s *KeyPackageStore) Upload(ctx context.Context, ptid, deviceID, stationID string, data []byte) error {
	hash := sha256.Sum256(data)
	kp := &KeyPackage{
		Ptid:       ptid,
		DeviceID:   deviceID,
		StationID:  stationID,
		Data:       data,
		DataSHA256: hash[:],
		CreatedAt:  time.Now(),
	}
	return s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{
				{Name: "ptid"},
				{Name: "device_id"},
				{Name: "data_sha256"},
			},
			DoNothing: true,
		}).
		Create(kp).Error
}

// FetchAndConsume atomically retrieves and deletes one KeyPackage for the actor.
// Returns nil, nil if no packages are available.
func (s *KeyPackageStore) FetchAndConsume(ctx context.Context, ptid string) (*KeyPackage, error) {
	var kp KeyPackage
	err := s.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
		Where("ptid = ?", ptid).
		Order("created_at ASC").
		First(&kp).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("keypackage: fetch failed: %w", err)
	}

	if err := s.db.WithContext(ctx).Delete(&kp).Error; err != nil {
		return nil, fmt.Errorf("keypackage: consume failed: %w", err)
	}
	return &kp, nil
}

// CountAvailable returns how many KeyPackages are stored for the actor.
func (s *KeyPackageStore) CountAvailable(ctx context.Context, ptid string) (int64, error) {
	var count int64
	err := s.db.WithContext(ctx).
		Model(&KeyPackage{}).
		Where("ptid = ?", ptid).
		Count(&count).Error
	return count, err
}

// FetchForMultiple retrieves one KeyPackage per actor (for Welcome generation).
// Consumed packages are deleted. Returns a map of ptid -> keyPackageData.
// Actors with no available packages are omitted from the result.
func (s *KeyPackageStore) FetchForMultiple(ctx context.Context, ptids []string) (map[string][]byte, error) {
	result := make(map[string][]byte, len(ptids))
	for _, ptid := range ptids {
		keyPackage, err := s.FetchAndConsume(ctx, ptid)
		if err != nil {
			return nil, err
		}
		if keyPackage != nil {
			result[ptid] = keyPackage.Data
		}
	}
	return result, nil
}
