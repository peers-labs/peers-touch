package conversation

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// KeyPackage represents an opaque MLS KeyPackage uploaded by a device.
// KeyPackages are one-time-use: they are consumed (deleted) when fetched
// for group creation or member addition.
type KeyPackage struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	Ptid      string    `gorm:"column:ptid;size:255;index:idx_kp_ptid"`
	DeviceID  string    `gorm:"column:device_id;size:255;index:idx_kp_device"`
	StationID string    `gorm:"column:station_id;size:255"`
	Data      []byte    `gorm:"column:data;type:bytea"`
	CreatedAt time.Time `gorm:"column:created_at"`
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
	return s.db.AutoMigrate(&KeyPackage{})
}

// Upload stores a new KeyPackage for the given actor/device.
func (s *KeyPackageStore) Upload(ctx context.Context, ptid, deviceID, stationID string, data []byte) error {
	kp := &KeyPackage{
		Ptid:      ptid,
		DeviceID:  deviceID,
		StationID: stationID,
		Data:      data,
		CreatedAt: time.Now(),
	}
	return s.db.WithContext(ctx).Create(kp).Error
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
