package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strconv"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type FederatedMlsKeyPackageClaimModel struct {
	AuthorityStationID string    `gorm:"column:authority_station_id;size:255;primaryKey"`
	AuthorityPlanID    string    `gorm:"column:authority_plan_id;size:64;primaryKey"`
	TargetPTID         string    `gorm:"column:target_ptid;size:255;primaryKey"`
	TargetDeviceID     string    `gorm:"column:target_device_id;size:255;primaryKey"`
	HomeStationID      string    `gorm:"column:home_station_id;size:255;not null"`
	PackageID          string    `gorm:"column:package_id;size:64;not null"`
	KeyPackage         []byte    `gorm:"column:key_package;type:bytea;not null"`
	KeyPackageSHA256   []byte    `gorm:"column:key_package_sha256;type:bytea;not null"`
	PlanExpiresAt      time.Time `gorm:"column:plan_expires_at;not null;index"`
	ClaimedAt          time.Time `gorm:"column:claimed_at;not null"`
}

func (*FederatedMlsKeyPackageClaimModel) TableName() string {
	return "federated_mls_key_package_claims"
}

type FederatedMlsKeyPackageClaimStore struct {
	db *gorm.DB
}

func NewFederatedMlsKeyPackageClaimStore(
	db *gorm.DB,
) (*FederatedMlsKeyPackageClaimStore, error) {
	if db == nil {
		return nil, fmt.Errorf("messaging: federated MLS KeyPackage claim database is required")
	}
	return &FederatedMlsKeyPackageClaimStore{db: db}, nil
}

func (s *FederatedMlsKeyPackageClaimStore) AutoMigrate() error {
	return s.db.AutoMigrate(&FederatedMlsKeyPackageClaimModel{})
}

func (s *FederatedMlsKeyPackageClaimStore) ClaimIrreversibly(
	ctx context.Context,
	request *chat.ClaimFederatedMlsKeyPackageRequest,
	homeStationID string,
	claimedAt time.Time,
) (*chat.ClaimFederatedMlsKeyPackageResponse, error) {
	if request == nil ||
		request.AuthorityPlanId == "" ||
		request.AuthorityStationId == "" ||
		request.AuthorityStationId == homeStationID ||
		request.Target == nil ||
		request.Target.Ptid == "" ||
		request.Target.DeviceId == "" ||
		request.PlanExpiresAt == nil ||
		homeStationID == "" ||
		claimedAt.IsZero() {
		return nil, fmt.Errorf("messaging: federated MLS KeyPackage claim is incomplete")
	}
	claimedAt = claimedAt.UTC().Truncate(time.Microsecond)
	expiresAt := request.PlanExpiresAt.AsTime().UTC().Truncate(time.Microsecond)
	if !expiresAt.After(claimedAt.Add(-messaging.FederationClockSkewBudget)) {
		return nil, messaging.ErrAuthorityPlanExpired
	}

	var response *chat.ClaimFederatedMlsKeyPackageResponse
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing FederatedMlsKeyPackageClaimModel
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"authority_station_id = ? AND authority_plan_id = ? "+
					"AND target_ptid = ? AND target_device_id = ?",
				request.AuthorityStationId,
				request.AuthorityPlanId,
				request.Target.Ptid,
				request.Target.DeviceId,
			).
			First(&existing).Error
		switch {
		case err == nil:
			actualHash := sha256.Sum256(existing.KeyPackage)
			if existing.HomeStationID != homeStationID ||
				!existing.PlanExpiresAt.Equal(expiresAt) ||
				len(existing.KeyPackage) == 0 ||
				len(existing.KeyPackageSHA256) != sha256.Size ||
				!bytes.Equal(actualHash[:], existing.KeyPackageSHA256) {
				return messaging.ErrMlsKeyPackageClaimConflict
			}
			response = federatedMlsKeyPackageClaimResponse(existing)
			return nil
		case !errors.Is(err, gorm.ErrRecordNotFound):
			return err
		}

		var keyPackage MlsKeyPackageModel
		if err := tx.Clauses(clause.Locking{
			Strength: "UPDATE",
			Options:  "SKIP LOCKED",
		}).
			Where(
				"ptid = ? AND device_id = ? AND station_id = ? "+
					"AND (reserved_plan_id = '' OR reserved_until <= ?)",
				request.Target.Ptid,
				request.Target.DeviceId,
				homeStationID,
				claimedAt,
			).
			Order("created_at ASC, id ASC").
			First(&keyPackage).Error; err != nil {
			return mapNotFound(err)
		}
		if len(keyPackage.Data) == 0 || len(keyPackage.DataSHA256) != sha256.Size {
			return fmt.Errorf("messaging: MLS KeyPackage material is invalid")
		}
		actualHash := sha256.Sum256(keyPackage.Data)
		if !bytes.Equal(actualHash[:], keyPackage.DataSHA256) {
			return fmt.Errorf("messaging: MLS KeyPackage hash is invalid")
		}
		deleted := tx.
			Where(
				"id = ? AND station_id = ? "+
					"AND (reserved_plan_id = '' OR reserved_until <= ?)",
				keyPackage.ID,
				homeStationID,
				claimedAt,
			).
			Delete(&MlsKeyPackageModel{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected != 1 {
			return messaging.ErrAuthorityPlanStale
		}
		claim := FederatedMlsKeyPackageClaimModel{
			AuthorityStationID: request.AuthorityStationId,
			AuthorityPlanID:    request.AuthorityPlanId,
			TargetPTID:         request.Target.Ptid,
			TargetDeviceID:     request.Target.DeviceId,
			HomeStationID:      homeStationID,
			PackageID:          strconv.FormatUint(uint64(keyPackage.ID), 10),
			KeyPackage:         append([]byte(nil), keyPackage.Data...),
			KeyPackageSHA256:   append([]byte(nil), keyPackage.DataSHA256...),
			PlanExpiresAt:      expiresAt,
			ClaimedAt:          claimedAt,
		}
		if err := tx.Create(&claim).Error; err != nil {
			return err
		}
		response = federatedMlsKeyPackageClaimResponse(claim)
		return nil
	})
	return response, err
}

func federatedMlsKeyPackageClaimResponse(
	claim FederatedMlsKeyPackageClaimModel,
) *chat.ClaimFederatedMlsKeyPackageResponse {
	return &chat.ClaimFederatedMlsKeyPackageResponse{
		Target: &chat.CryptoEndpoint{
			Ptid:     claim.TargetPTID,
			DeviceId: claim.TargetDeviceID,
		},
		PackageId:            claim.PackageID,
		KeyPackage:           append([]byte(nil), claim.KeyPackage...),
		KeyPackageSha256:     append([]byte(nil), claim.KeyPackageSHA256...),
		HomeStationId:        claim.HomeStationID,
		IrreversiblyConsumed: true,
	}
}

var _ messaging.FederatedMlsKeyPackageClaimRepository = (*FederatedMlsKeyPackageClaimStore)(nil)
