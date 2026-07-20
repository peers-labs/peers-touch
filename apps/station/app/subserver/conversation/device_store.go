package conversation

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DeviceRecord represents a registered device for an actor.
type DeviceRecord struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	Ptid      string    `gorm:"column:ptid;size:255;index:idx_device_actor;uniqueIndex:idx_device_actor_device"`
	DeviceID  string    `gorm:"column:device_id;size:255;uniqueIndex:idx_device_actor_device"`
	Label     string    `gorm:"column:label;size:255"`
	PublicKey []byte    `gorm:"column:public_key;type:bytea"`
	Revoked   bool      `gorm:"column:revoked"`
	CreatedAt time.Time `gorm:"column:created_at"`
	RevokedAt *time.Time `gorm:"column:revoked_at"`
}

func (*DeviceRecord) TableName() string { return "actor_devices" }

// DeviceStore manages the device registry for actors on this Station.
type DeviceStore struct {
	db *gorm.DB
}

func NewDeviceStore(db *gorm.DB) *DeviceStore {
	return &DeviceStore{db: db}
}

func (s *DeviceStore) AutoMigrate() error {
	return s.db.AutoMigrate(&DeviceRecord{})
}

// Register adds or updates a device for an actor.
func (s *DeviceStore) Register(ctx context.Context, ptid, deviceID, label string, publicKey []byte) error {
	record := &DeviceRecord{
		Ptid:      ptid,
		DeviceID:  deviceID,
		Label:     label,
		PublicKey:  publicKey,
		Revoked:   false,
		CreatedAt: time.Now(),
	}
	return s.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "ptid"}, {Name: "device_id"}},
			DoUpdates: clause.AssignmentColumns([]string{"label", "public_key", "revoked"}),
		}).
		Create(record).Error
}

// ListActive returns all non-revoked devices for an actor.
func (s *DeviceStore) ListActive(ctx context.Context, ptid string) ([]DeviceRecord, error) {
	var records []DeviceRecord
	err := s.db.WithContext(ctx).
		Where("ptid = ? AND revoked = ?", ptid, false).
		Order("created_at ASC").
		Find(&records).Error
	return records, err
}

// Revoke marks a device as revoked. Revoked devices cannot decrypt future messages.
func (s *DeviceStore) Revoke(ctx context.Context, ptid, deviceID string) error {
	now := time.Now()
	return s.db.WithContext(ctx).
		Model(&DeviceRecord{}).
		Where("ptid = ? AND device_id = ?", ptid, deviceID).
		Updates(map[string]any{
			"revoked":    true,
			"revoked_at": now,
		}).Error
}

// Count returns the number of active devices for an actor.
func (s *DeviceStore) Count(ctx context.Context, ptid string) (int64, error) {
	var count int64
	err := s.db.WithContext(ctx).
		Model(&DeviceRecord{}).
		Where("ptid = ? AND revoked = ?", ptid, false).
		Count(&count).Error
	return count, err
}
