package infrastructure

import (
	"context"
	"fmt"
	"strconv"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type MlsKeyPackageModel struct {
	ID             uint       `gorm:"column:id;primaryKey"`
	PTID           string     `gorm:"column:ptid;size:255;index:idx_kp_ptid;uniqueIndex:uidx_mls_kp_payload"`
	DeviceID       string     `gorm:"column:device_id;size:255;index:idx_kp_device;uniqueIndex:uidx_mls_kp_payload"`
	StationID      string     `gorm:"column:station_id;size:255"`
	Data           []byte     `gorm:"column:data;type:bytea"`
	DataSHA256     []byte     `gorm:"column:data_sha256;type:bytea;uniqueIndex:uidx_mls_kp_payload"`
	CreatedAt      time.Time  `gorm:"column:created_at"`
	ReservedPlanID string     `gorm:"column:reserved_plan_id;size:64;not null;default:'';index"`
	ReservedUntil  *time.Time `gorm:"column:reserved_until;index"`
}

func (*MlsKeyPackageModel) TableName() string {
	return "mls_key_packages"
}

type MlsKeyPackageStore struct {
	db *gorm.DB
}

func NewMlsKeyPackageStore(db *gorm.DB) *MlsKeyPackageStore {
	return &MlsKeyPackageStore{db: db}
}

func (s *MlsKeyPackageStore) AutoMigrate() error {
	return s.db.AutoMigrate(&MlsKeyPackageModel{})
}

func (s *MlsKeyPackageStore) Reserve(
	ctx context.Context,
	planID string,
	endpoint *chat.CryptoEndpoint,
	reservedAt time.Time,
	reservedUntil time.Time,
) (*chat.ReservedMessagingMlsKeyPackage, error) {
	if planID == "" ||
		endpoint == nil ||
		endpoint.Ptid == "" ||
		endpoint.DeviceId == "" ||
		reservedAt.IsZero() ||
		!reservedUntil.After(reservedAt) {
		return nil, fmt.Errorf("messaging: MLS KeyPackage reservation is incomplete")
	}
	var keyPackage MlsKeyPackageModel
	reservedAt = reservedAt.UTC()
	err := s.db.WithContext(ctx).
		Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
		Where(
			"ptid = ? AND device_id = ? AND (reserved_plan_id = '' OR reserved_until <= ?)",
			endpoint.Ptid,
			endpoint.DeviceId,
			reservedAt,
		).
		Order("created_at ASC, id ASC").
		First(&keyPackage).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, messaging.ErrNotFound
		}
		return nil, err
	}
	if len(keyPackage.Data) == 0 || len(keyPackage.DataSHA256) != 32 {
		return nil, fmt.Errorf("messaging: MLS KeyPackage material is invalid")
	}
	result := s.db.WithContext(ctx).
		Model(&MlsKeyPackageModel{}).
		Where(
			"id = ? AND (reserved_plan_id = '' OR reserved_until <= ?)",
			keyPackage.ID,
			reservedAt,
		).
		Updates(map[string]any{
			"reserved_plan_id": planID,
			"reserved_until":   reservedUntil.UTC(),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, messaging.ErrAuthorityPlanStale
	}
	return &chat.ReservedMessagingMlsKeyPackage{
		Target:           endpoint,
		PackageId:        strconv.FormatUint(uint64(keyPackage.ID), 10),
		KeyPackage:       append([]byte(nil), keyPackage.Data...),
		KeyPackageSha256: append([]byte(nil), keyPackage.DataSHA256...),
	}, nil
}

func (s *MlsKeyPackageStore) ConsumeReservations(
	ctx context.Context,
	planID string,
) error {
	if planID == "" {
		return fmt.Errorf("messaging: MLS KeyPackage reservation plan is required")
	}
	return s.db.WithContext(ctx).
		Where("reserved_plan_id = ?", planID).
		Delete(&MlsKeyPackageModel{}).Error
}

func (s *MlsKeyPackageStore) ReleaseReservations(
	ctx context.Context,
	planID string,
) error {
	if planID == "" {
		return fmt.Errorf("messaging: MLS KeyPackage reservation plan is required")
	}
	return s.db.WithContext(ctx).
		Model(&MlsKeyPackageModel{}).
		Where("reserved_plan_id = ?", planID).
		Updates(map[string]any{
			"reserved_plan_id": "",
			"reserved_until":   nil,
		}).Error
}
