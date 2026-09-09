package infrastructure

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errMLSStateContended = errors.New("key exchange MLS state contended")

type MLSKeyPackageModel struct {
	ID             uint       `gorm:"column:id;primaryKey"`
	ActorPTID      string     `gorm:"column:ptid;size:255;index:idx_kp_ptid;uniqueIndex:uidx_mls_kp_payload"`
	DeviceID       string     `gorm:"column:device_id;size:255;index:idx_kp_device;uniqueIndex:uidx_mls_kp_payload"`
	HomeStationID  string     `gorm:"column:station_id;size:255;not null"`
	Data           []byte     `gorm:"column:data;type:bytea;not null"`
	DataSHA256     []byte     `gorm:"column:data_sha256;type:bytea;not null;uniqueIndex:uidx_mls_kp_payload"`
	CreatedAt      time.Time  `gorm:"column:created_at;not null"`
	ConsumedAt     *time.Time `gorm:"column:consumed_at;index"`
	ReservedPlanID string     `gorm:"column:reserved_plan_id;size:128;not null;default:'';index"`
	ReservedUntil  *time.Time `gorm:"column:reserved_until;index"`
}

func (*MLSKeyPackageModel) TableName() string {
	return "mls_key_packages"
}

type FederatedMLSKeyPackageClaimModel struct {
	AuthorityStationID string    `gorm:"column:authority_station_id;size:255;primaryKey"`
	AuthorityPlanID    string    `gorm:"column:authority_plan_id;size:128;primaryKey"`
	TargetPTID         string    `gorm:"column:target_ptid;size:255;primaryKey"`
	TargetDeviceID     string    `gorm:"column:target_device_id;size:128;primaryKey"`
	HomeStationID      string    `gorm:"column:home_station_id;size:255;not null"`
	PackageID          string    `gorm:"column:package_id;size:64;not null"`
	KeyPackage         []byte    `gorm:"column:key_package;type:bytea;not null"`
	KeyPackageSHA256   []byte    `gorm:"column:key_package_sha256;type:bytea;not null"`
	PlanExpiresAt      time.Time `gorm:"column:plan_expires_at;not null;index"`
	ClaimedAt          time.Time `gorm:"column:claimed_at;not null"`
}

func (*FederatedMLSKeyPackageClaimModel) TableName() string {
	return "federated_mls_key_package_claims"
}

type CanonicalStore struct {
	db *gorm.DB
}

func NewCanonicalStore(db *gorm.DB) (*CanonicalStore, error) {
	if db == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.new_canonical_store",
			"database",
			"is required",
		)
	}
	return &CanonicalStore{db: db}, nil
}

// Migrate installs the canonical Direct and MLS public-material schemas.
func (s *CanonicalStore) Migrate(ctx context.Context) error {
	if err := s.db.WithContext(ctx).AutoMigrate(
		&IdentityKeyModel{},
		&SignedPreKeyModel{},
		&OneTimePreKeyModel{},
		&MLSKeyPackageModel{},
		&FederatedMLSKeyPackageClaimModel{},
	); err != nil {
		return domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.migrate",
			err,
		)
	}
	for _, statement := range []string{
		"CREATE UNIQUE INDEX IF NOT EXISTS " +
			"uidx_ke_signed_pre_key_owner ON " +
			"key_exchange_signed_pre_keys(actor_ptid, device_id)",
		"CREATE UNIQUE INDEX IF NOT EXISTS " +
			"uidx_mls_key_package_plan_target ON " +
			"mls_key_packages(reserved_plan_id, ptid, device_id) " +
			"WHERE reserved_plan_id <> '' AND consumed_at IS NULL",
	} {
		if err := s.db.WithContext(ctx).Exec(statement).Error; err != nil {
			return domain.WrapError(
				domain.ErrorCodeInternal,
				"key_exchange.migrate",
				err,
			)
		}
	}
	return nil
}

func (s *CanonicalStore) UploadDirectBundle(
	ctx context.Context,
	bundle domain.DirectKeyBundle,
	publishedAt time.Time,
) error {
	publishedAt = publishedAt.UTC()
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveDevicesForMutation(
			tx,
			[]domain.Endpoint{bundle.Device},
			"key_exchange.store.upload_direct_bundle",
		); err != nil {
			return err
		}

		if err := upsertCanonicalIdentityKey(
			tx,
			bundle,
			publishedAt,
		); err != nil {
			return err
		}
		if err := upsertCanonicalSignedPreKey(tx, bundle, publishedAt); err != nil {
			return err
		}
		return insertCanonicalDirectOneTimePreKeys(
			tx,
			bundle.Device,
			bundle.OneTimePreKeys,
			publishedAt,
		)
	})
}

func (s *CanonicalStore) FetchDirectBundles(
	ctx context.Context,
	actorPTID string,
	activeDeviceIDs []string,
) ([]domain.DirectKeyBundle, error) {
	if len(activeDeviceIDs) == 0 {
		return nil, domain.NewError(
			domain.ErrorCodeNotFound,
			"key_exchange.store.fetch_direct_bundles",
			"active_device_ids",
			"contains no active device",
		)
	}

	var bundles []domain.DirectKeyBundle
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		endpoints := make([]domain.Endpoint, 0, len(activeDeviceIDs))
		for _, deviceID := range activeDeviceIDs {
			endpoints = append(endpoints, domain.Endpoint{
				ActorPTID: actorPTID,
				DeviceID:  deviceID,
			})
		}
		if err := requireActiveDevicesForMutation(
			tx,
			endpoints,
			"key_exchange.store.fetch_direct_bundles",
		); err != nil {
			return err
		}

		var identities []IdentityKeyModel
		if err := tx.
			Where("actor_ptid = ? AND device_id IN ?", actorPTID, activeDeviceIDs).
			Order("published_at_unix_ms DESC, device_id ASC").
			Find(&identities).Error; err != nil {
			return storeFailure("fetch Direct identity keys", err)
		}
		if len(identities) == 0 {
			return domain.NewError(
				domain.ErrorCodeNotFound,
				"key_exchange.store.fetch_direct_bundles",
				"actor_ptid",
				"has no active Direct key bundle",
			)
		}

		bundles = make([]domain.DirectKeyBundle, 0, len(identities))
		for _, identity := range identities {
			var signedPreKey SignedPreKeyModel
			if err := tx.
				Where(
					"actor_ptid = ? AND device_id = ?",
					identity.ActorPtid,
					identity.DeviceID,
				).
				Order("created_at DESC, id DESC").
				First(&signedPreKey).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return domain.NewError(
						domain.ErrorCodeStaleMaterial,
						"key_exchange.store.fetch_direct_bundles",
						"signed_pre_key",
						"is missing for an identity key",
					)
				}
				return storeFailure("fetch Direct signed pre-key", err)
			}

			oneTimePreKey, err := consumeDirectOneTimePreKey(
				tx,
				domain.Endpoint{
					ActorPTID: identity.ActorPtid,
					DeviceID:  identity.DeviceID,
				},
			)
			if err != nil {
				return err
			}
			keys := make([]domain.DirectOneTimePreKey, 0, 1)
			if oneTimePreKey != nil {
				keys = append(keys, *oneTimePreKey)
			}
			bundles = append(bundles, domain.DirectKeyBundle{
				Device: domain.Endpoint{
					ActorPTID: identity.ActorPtid,
					DeviceID:  identity.DeviceID,
				},
				IdentityKeyPublic:     append([]byte(nil), identity.IdentityKeyPub...),
				SignedPreKeyID:        signedPreKey.SPKID,
				SignedPreKeyPublic:    append([]byte(nil), signedPreKey.PublicKey...),
				SignedPreKeySignature: append([]byte(nil), signedPreKey.Signature...),
				OneTimePreKeys:        keys,
				PublishedAt:           time.UnixMilli(identity.PublishedAtUnixMs).UTC(),
				SupportedWireVersions: decodeSupportedVersions(identity.SupportedVersions),
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return bundles, nil
}

func (s *CanonicalStore) ReplenishDirectOneTimePreKeys(
	ctx context.Context,
	device domain.Endpoint,
	keys []domain.DirectOneTimePreKey,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveDevicesForMutation(
			tx,
			[]domain.Endpoint{device},
			"key_exchange.store.replenish_direct_one_time_pre_keys",
		); err != nil {
			return err
		}

		var identityCount int64
		if err := tx.Model(&IdentityKeyModel{}).
			Where(
				"actor_ptid = ? AND device_id = ?",
				device.ActorPTID,
				device.DeviceID,
			).
			Count(&identityCount).Error; err != nil {
			return storeFailure("check Direct bundle identity", err)
		}
		if identityCount != 1 {
			return domain.NewError(
				domain.ErrorCodeNotFound,
				"key_exchange.store.replenish_direct_one_time_pre_keys",
				"device",
				"has no Direct bundle",
			)
		}
		return insertCanonicalDirectOneTimePreKeys(
			tx,
			device,
			keys,
			time.Now().UTC(),
		)
	})
}

func (s *CanonicalStore) CountDirectOneTimePreKeys(
	ctx context.Context,
	device domain.Endpoint,
) (int64, error) {
	var count int64
	if err := s.db.WithContext(ctx).
		Model(&OneTimePreKeyModel{}).
		Where(
			"actor_ptid = ? AND device_id = ? AND consumed = ?",
			device.ActorPTID,
			device.DeviceID,
			false,
		).
		Count(&count).Error; err != nil {
		return 0, storeFailure("count Direct one-time pre-keys", err)
	}
	return count, nil
}

func (s *CanonicalStore) UploadMLSKeyPackage(
	ctx context.Context,
	device domain.Endpoint,
	homeStationID string,
	keyPackage []byte,
	uploadedAt time.Time,
) (domain.MLSKeyPackage, error) {
	hash := sha256.Sum256(keyPackage)
	var persisted MLSKeyPackageModel
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveDevicesForMutation(
			tx,
			[]domain.Endpoint{device},
			"key_exchange.store.upload_mls_key_package",
		); err != nil {
			return err
		}

		err := tx.Where(
			"ptid = ? AND device_id = ? AND data_sha256 = ?",
			device.ActorPTID,
			device.DeviceID,
			hash[:],
		).First(&persisted).Error
		switch {
		case err == nil:
			if !bytes.Equal(persisted.Data, keyPackage) {
				return domain.NewError(
					domain.ErrorCodeConflict,
					"key_exchange.store.upload_mls_key_package",
					"key_package",
					"hash conflicts with different persisted bytes",
				)
			}
			if persisted.ConsumedAt != nil {
				return domain.NewError(
					domain.ErrorCodeStaleMaterial,
					"key_exchange.store.upload_mls_key_package",
					"key_package",
					"was already consumed and cannot be republished",
				)
			}
			if persisted.HomeStationID != homeStationID {
				return domain.NewError(
					domain.ErrorCodeConflict,
					"key_exchange.store.upload_mls_key_package",
					"home_station_peer_id",
					"conflicts with the persisted package owner",
				)
			}
			return nil
		case !errors.Is(err, gorm.ErrRecordNotFound):
			return storeFailure("lookup MLS KeyPackage upload", err)
		}

		persisted = MLSKeyPackageModel{
			ActorPTID:     device.ActorPTID,
			DeviceID:      device.DeviceID,
			HomeStationID: homeStationID,
			Data:          append([]byte(nil), keyPackage...),
			DataSHA256:    append([]byte(nil), hash[:]...),
			CreatedAt:     uploadedAt.UTC(),
		}
		if err := tx.Create(&persisted).Error; err != nil {
			return storeFailure("persist MLS KeyPackage", err)
		}
		return nil
	})
	if err != nil {
		return domain.MLSKeyPackage{}, err
	}
	return mlsKeyPackageFromModel(persisted)
}

func (s *CanonicalStore) FetchAndConsumeMLSKeyPackage(
	ctx context.Context,
	actorPTID string,
	activeDeviceIDs []string,
	consumedAt time.Time,
) (*domain.MLSKeyPackage, error) {
	if len(activeDeviceIDs) == 0 {
		return nil, nil
	}
	var consumed *domain.MLSKeyPackage
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		endpoints := make([]domain.Endpoint, 0, len(activeDeviceIDs))
		for _, deviceID := range activeDeviceIDs {
			endpoints = append(endpoints, domain.Endpoint{
				ActorPTID: actorPTID,
				DeviceID:  deviceID,
			})
		}
		if err := requireActiveDevicesForMutation(
			tx,
			endpoints,
			"key_exchange.store.fetch_mls_key_package",
		); err != nil {
			return err
		}

		keyPackage, err := selectAvailableMLSKeyPackage(
			tx,
			actorPTID,
			activeDeviceIDs,
			"",
			consumedAt,
		)
		if err != nil {
			if domain.IsCode(err, domain.ErrorCodeNotFound) {
				return nil
			}
			return err
		}
		result := tx.Model(&MLSKeyPackageModel{}).
			Where(
				"id = ? AND consumed_at IS NULL "+
					"AND (reserved_plan_id = '' OR reserved_until <= ?)",
				keyPackage.ID,
				consumedAt.UTC(),
			).
			Updates(map[string]any{
				"consumed_at":      consumedAt.UTC(),
				"reserved_plan_id": "",
				"reserved_until":   nil,
			})
		if result.Error != nil {
			return storeFailure("consume MLS KeyPackage", result.Error)
		}
		if result.RowsAffected != 1 {
			return domain.NewError(
				domain.ErrorCodeStaleMaterial,
				"key_exchange.store.fetch_mls_key_package",
				"key_package",
				"was consumed or reserved concurrently",
			)
		}
		consumedAtUTC := consumedAt.UTC()
		keyPackage.ConsumedAt = &consumedAtUTC
		value, err := mlsKeyPackageFromModel(keyPackage)
		if err != nil {
			return err
		}
		consumed = &value
		return nil
	})
	if err != nil {
		return nil, err
	}
	return consumed, nil
}

func (s *CanonicalStore) CountMLSKeyPackages(
	ctx context.Context,
	device domain.Endpoint,
) (int64, error) {
	var count int64
	if err := s.db.WithContext(ctx).
		Model(&MLSKeyPackageModel{}).
		Where(
			"ptid = ? AND device_id = ? AND consumed_at IS NULL",
			device.ActorPTID,
			device.DeviceID,
		).
		Count(&count).Error; err != nil {
		return 0, storeFailure("count MLS KeyPackages", err)
	}
	return count, nil
}

func (s *CanonicalStore) ReserveMLSKeyPackage(
	ctx context.Context,
	planID string,
	target domain.Endpoint,
	homeStationID string,
	reservedAt time.Time,
	expiresAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	var reservation domain.MLSKeyPackageReservation
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveDevicesForMutation(
			tx,
			[]domain.Endpoint{target},
			"key_exchange.store.reserve_mls_key_package",
		); err != nil {
			return err
		}

		replay, found, err := findMLSReservation(tx, planID, target, true)
		if err != nil {
			return err
		}
		if found {
			value, err := replayMLSReservation(
				replay,
				planID,
				target,
				homeStationID,
				reservedAt,
				expiresAt,
			)
			if err != nil {
				return err
			}
			reservation = value

			return nil
		}

		keyPackage, err := selectAvailableMLSKeyPackage(
			tx,
			target.ActorPTID,
			[]string{target.DeviceID},
			homeStationID,
			reservedAt,
		)
		if err != nil {
			if domain.IsCode(err, domain.ErrorCodeNotFound) {
				contended, lookupErr := hasActiveMLSReservationForTarget(
					tx,
					target,
					reservedAt,
				)
				if lookupErr != nil {
					return lookupErr
				}
				if contended {
					return domain.NewError(
						domain.ErrorCodeStaleMaterial,
						"key_exchange.store.reserve_mls_key_package",
						"reservation",
						"lost to a different persisted reservation",
					)
				}
			}

			return err
		}
		result := tx.Model(&MLSKeyPackageModel{}).
			Where(
				"id = ? AND consumed_at IS NULL "+
					"AND (reserved_plan_id = '' OR reserved_until <= ?)",
				keyPackage.ID,
				reservedAt.UTC(),
			).
			Updates(map[string]any{
				"reserved_plan_id": planID,
				"reserved_until":   expiresAt.UTC(),
			})
		if result.Error != nil {
			return storeFailure("reserve MLS KeyPackage", result.Error)
		}
		if result.RowsAffected != 1 {
			return errMLSStateContended
		}
		keyPackage.ReservedPlanID = planID
		expiresAtUTC := expiresAt.UTC()
		keyPackage.ReservedUntil = &expiresAtUTC
		value, err := reservationFromMLSModel(
			keyPackage,
			planID,
			expiresAt,
			false,
		)
		if err != nil {
			return err
		}
		reservation = value
		return nil
	})
	if err != nil {
		if isMLSStateContention(err) {
			replayed, replayErr := s.reconcileMLSReservation(
				ctx,
				planID,
				target,
				homeStationID,
				reservedAt,
				expiresAt,
			)
			if replayErr == nil {
				return replayed, nil
			}
			if !domain.IsCode(replayErr, domain.ErrorCodeNotFound) {
				return domain.MLSKeyPackageReservation{}, replayErr
			}

			return domain.MLSKeyPackageReservation{}, domain.NewError(
				domain.ErrorCodeStaleMaterial,
				"key_exchange.store.reserve_mls_key_package",
				"key_package",
				"lost a concurrent reservation race without an exact winner",
			)
		}

		return domain.MLSKeyPackageReservation{}, err
	}
	return reservation, nil
}

func (s *CanonicalStore) ConsumeMLSKeyPackages(
	ctx context.Context,
	reservations []domain.MLSKeyPackageReservation,
	consumedAt time.Time,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveReservationTargets(
			tx,
			reservations,
			"key_exchange.store.consume_mls_key_packages",
		); err != nil {
			return err
		}

		for _, reservation := range reservations {
			packageID, err := parseMLSKeyPackageID(
				"key_exchange.store.consume_mls_key_packages",
				reservation.PackageID,
			)
			if err != nil {
				return err
			}
			result := tx.Model(&MLSKeyPackageModel{}).
				Where(
					"id = ? AND ptid = ? AND device_id = ? "+
						"AND data_sha256 = ? AND reserved_plan_id = ? "+
						"AND reserved_until > ? AND consumed_at IS NULL",
					packageID,
					reservation.Target.ActorPTID,
					reservation.Target.DeviceID,
					reservation.PackageHash[:],
					reservation.PlanID,
					consumedAt.UTC(),
				).
				Updates(map[string]any{
					"consumed_at":      consumedAt.UTC(),
					"reserved_plan_id": "",
					"reserved_until":   nil,
				})
			if result.Error != nil {
				return storeFailure("consume reserved MLS KeyPackage", result.Error)
			}
			if result.RowsAffected != 1 {
				return domain.NewError(
					domain.ErrorCodeStaleMaterial,
					"key_exchange.store.consume_mls_key_packages",
					"reservation",
					"is stale, expired, or already consumed",
				)
			}
		}
		return nil
	})
}

func (s *CanonicalStore) ReleaseMLSKeyPackages(
	ctx context.Context,
	reservations []domain.MLSKeyPackageReservation,
	_ time.Time,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveReservationTargets(
			tx,
			reservations,
			"key_exchange.store.release_mls_key_packages",
		); err != nil {
			return err
		}

		for _, reservation := range reservations {
			packageID, err := parseMLSKeyPackageID(
				"key_exchange.store.release_mls_key_packages",
				reservation.PackageID,
			)
			if err != nil {
				return err
			}
			result := tx.Model(&MLSKeyPackageModel{}).
				Where(
					"id = ? AND ptid = ? AND device_id = ? "+
						"AND data_sha256 = ? AND reserved_plan_id = ? "+
						"AND consumed_at IS NULL",
					packageID,
					reservation.Target.ActorPTID,
					reservation.Target.DeviceID,
					reservation.PackageHash[:],
					reservation.PlanID,
				).
				Updates(map[string]any{
					"reserved_plan_id": "",
					"reserved_until":   nil,
				})
			if result.Error != nil {
				return storeFailure("release reserved MLS KeyPackage", result.Error)
			}
			if result.RowsAffected != 1 {
				return domain.NewError(
					domain.ErrorCodeStaleMaterial,
					"key_exchange.store.release_mls_key_packages",
					"reservation",
					"is stale or already terminal",
				)
			}
		}
		return nil
	})
}

func (s *CanonicalStore) ClaimMLSKeyPackageIrreversibly(
	ctx context.Context,
	claim domain.MLSKeyPackageClaim,
	homeStationID string,
	claimedAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	var reservation domain.MLSKeyPackageReservation
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := requireActiveDevicesForMutation(
			tx,
			[]domain.Endpoint{claim.Target},
			"key_exchange.store.claim_mls_key_package",
		); err != nil {
			return err
		}

		existing, found, err := findFederatedMLSClaim(tx, claim, true)
		if err != nil {
			return err
		}
		if found {
			value, err := replayFederatedMLSClaim(
				existing,
				claim,
				homeStationID,
			)
			if err != nil {
				return err
			}
			reservation = value
			return nil
		}

		keyPackage, err := selectAvailableMLSKeyPackage(
			tx,
			claim.Target.ActorPTID,
			[]string{claim.Target.DeviceID},
			homeStationID,
			claimedAt,
		)
		if err != nil {
			if domain.IsCode(err, domain.ErrorCodeNotFound) {
				contended, lookupErr := hasFederatedMLSClaimForTarget(
					tx,
					claim.Target,
				)
				if lookupErr != nil {
					return lookupErr
				}
				if contended {
					return domain.NewError(
						domain.ErrorCodeStaleMaterial,
						"key_exchange.store.claim_mls_key_package",
						"claim",
						"lost to a different persisted claim",
					)
				}
			}

			return err
		}
		result := tx.Model(&MLSKeyPackageModel{}).
			Where(
				"id = ? AND station_id = ? AND consumed_at IS NULL "+
					"AND (reserved_plan_id = '' OR reserved_until <= ?)",
				keyPackage.ID,
				homeStationID,
				claimedAt.UTC(),
			).
			Updates(map[string]any{
				"consumed_at":      claimedAt.UTC(),
				"reserved_plan_id": "",
				"reserved_until":   nil,
			})
		if result.Error != nil {
			return storeFailure("consume claimed MLS KeyPackage", result.Error)
		}
		if result.RowsAffected != 1 {
			return errMLSStateContended
		}

		claimRecord := FederatedMLSKeyPackageClaimModel{
			AuthorityStationID: claim.AuthorityStationID,
			AuthorityPlanID:    claim.AuthorityPlanID,
			TargetPTID:         claim.Target.ActorPTID,
			TargetDeviceID:     claim.Target.DeviceID,
			HomeStationID:      homeStationID,
			PackageID:          strconv.FormatUint(uint64(keyPackage.ID), 10),
			KeyPackage:         append([]byte(nil), keyPackage.Data...),
			KeyPackageSHA256:   append([]byte(nil), keyPackage.DataSHA256...),
			PlanExpiresAt:      claim.PlanExpiresAt.UTC(),
			ClaimedAt:          claimedAt.UTC(),
		}
		if err := tx.Create(&claimRecord).Error; err != nil {
			return storeFailure("persist MLS KeyPackage claim receipt", err)
		}
		value, err := reservationFromClaimModel(claimRecord)
		if err != nil {
			return err
		}
		reservation = value
		return nil
	})
	if err != nil {
		if isMLSStateContention(err) {
			replayed, replayErr := s.reconcileFederatedMLSClaim(
				ctx,
				claim,
				homeStationID,
			)
			if replayErr == nil {
				return replayed, nil
			}
			if !domain.IsCode(replayErr, domain.ErrorCodeNotFound) {
				return domain.MLSKeyPackageReservation{}, replayErr
			}

			return domain.MLSKeyPackageReservation{}, domain.NewError(
				domain.ErrorCodeStaleMaterial,
				"key_exchange.store.claim_mls_key_package",
				"key_package",
				"lost a concurrent claim race without an exact winner",
			)
		}

		return domain.MLSKeyPackageReservation{}, err
	}
	return reservation, nil
}

func (s *CanonicalStore) reconcileMLSReservation(
	ctx context.Context,
	planID string,
	target domain.Endpoint,
	homeStationID string,
	reservedAt time.Time,
	expiresAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	replay, found, err := findMLSReservation(
		s.db.WithContext(ctx),
		planID,
		target,
		false,
	)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if !found {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeNotFound,
			"key_exchange.store.reserve_mls_key_package",
			"reservation",
			"has no persisted concurrent winner",
		)
	}

	return replayMLSReservation(
		replay,
		planID,
		target,
		homeStationID,
		reservedAt,
		expiresAt,
	)
}

func (s *CanonicalStore) reconcileFederatedMLSClaim(
	ctx context.Context,
	claim domain.MLSKeyPackageClaim,
	homeStationID string,
) (domain.MLSKeyPackageReservation, error) {
	existing, found, err := findFederatedMLSClaim(
		s.db.WithContext(ctx),
		claim,
		false,
	)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	if !found {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeNotFound,
			"key_exchange.store.claim_mls_key_package",
			"claim",
			"has no persisted concurrent winner",
		)
	}

	return replayFederatedMLSClaim(existing, claim, homeStationID)
}

func findMLSReservation(
	db *gorm.DB,
	planID string,
	target domain.Endpoint,
	lock bool,
) (MLSKeyPackageModel, bool, error) {
	var replay MLSKeyPackageModel
	query := db
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.
		Where(
			"ptid = ? AND device_id = ? AND reserved_plan_id = ? "+
				"AND consumed_at IS NULL",
			target.ActorPTID,
			target.DeviceID,
			planID,
		).
		Order("created_at ASC, id ASC").
		First(&replay).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return MLSKeyPackageModel{}, false, nil
	}
	if err != nil {
		return MLSKeyPackageModel{}, false,
			storeFailure("lookup MLS KeyPackage reservation", err)
	}

	return replay, true, nil
}

func replayMLSReservation(
	replay MLSKeyPackageModel,
	planID string,
	target domain.Endpoint,
	homeStationID string,
	reservedAt time.Time,
	expiresAt time.Time,
) (domain.MLSKeyPackageReservation, error) {
	if replay.ActorPTID != target.ActorPTID ||
		replay.DeviceID != target.DeviceID ||
		replay.HomeStationID != homeStationID ||
		replay.ReservedUntil == nil ||
		!replay.ReservedUntil.Equal(expiresAt.UTC()) {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeConflict,
			"key_exchange.store.reserve_mls_key_package",
			"reservation",
			"conflicts with the persisted reservation",
		)
	}
	if !replay.ReservedUntil.After(reservedAt.UTC()) {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodePlanExpired,
			"key_exchange.store.reserve_mls_key_package",
			"authority_plan_id",
			"already expired",
		)
	}

	return reservationFromMLSModel(replay, planID, expiresAt, false)
}

func hasActiveMLSReservationForTarget(
	db *gorm.DB,
	target domain.Endpoint,
	at time.Time,
) (bool, error) {
	var count int64
	if err := db.Model(&MLSKeyPackageModel{}).
		Where(
			"ptid = ? AND device_id = ? AND consumed_at IS NULL "+
				"AND reserved_plan_id <> '' AND reserved_until > ?",
			target.ActorPTID,
			target.DeviceID,
			at.UTC(),
		).
		Count(&count).Error; err != nil {
		return false, storeFailure("lookup competing MLS KeyPackage reservation", err)
	}

	return count > 0, nil
}

func requireActiveReservationTargets(
	tx *gorm.DB,
	reservations []domain.MLSKeyPackageReservation,
	operation string,
) error {
	endpoints := make([]domain.Endpoint, 0, len(reservations))
	for _, reservation := range reservations {
		endpoints = append(endpoints, reservation.Target)
	}

	return requireActiveDevicesForMutation(tx, endpoints, operation)
}

func requireActiveDevicesForMutation(
	tx *gorm.DB,
	endpoints []domain.Endpoint,
	operation string,
) error {
	if len(endpoints) == 0 {
		return nil
	}

	devices := make([]actoridentitypersistence.DeviceLocator, 0, len(endpoints))
	for _, endpoint := range endpoints {
		devices = append(devices, actoridentitypersistence.DeviceLocator{
			PTID:     endpoint.ActorPTID,
			DeviceID: endpoint.DeviceID,
		})
	}
	err := actoridentitypersistence.RequireActiveDevicesForMutation(tx, devices)
	if err == nil {
		return nil
	}

	switch actoridentitydomain.CodeOf(err) {
	case actoridentitydomain.ErrorCodeInvalidArgument:
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"device",
			"is invalid",
		)
	case actoridentitydomain.ErrorCodeUnauthorized:
		return domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"device",
			"is not an active verified actor device",
		)
	default:
		return domain.WrapError(domain.ErrorCodeInternal, operation, err)
	}
}

func isMLSStateContention(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errMLSStateContended) ||
		errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}

	var sqlState interface {
		SQLState() string
	}
	if errors.As(err, &sqlState) {
		switch sqlState.SQLState() {
		case "23505", "40001", "40P01":
			return true
		}
	}

	message := err.Error()

	return strings.Contains(message, "SQLSTATE 23505") ||
		strings.Contains(message, "UNIQUE constraint failed")
}

func upsertCanonicalIdentityKey(
	tx *gorm.DB,
	bundle domain.DirectKeyBundle,
	publishedAt time.Time,
) error {
	var existing IdentityKeyModel
	err := tx.Where(
		"actor_ptid = ? AND device_id = ?",
		bundle.Device.ActorPTID,
		bundle.Device.DeviceID,
	).First(&existing).Error
	fingerprint := sha256.Sum256(bundle.IdentityKeyPublic)
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		if err := tx.Create(&IdentityKeyModel{
			ActorPtid:         bundle.Device.ActorPTID,
			DeviceID:          bundle.Device.DeviceID,
			IdentityKeyPub:    append([]byte(nil), bundle.IdentityKeyPublic...),
			KeyFingerprint:    hex.EncodeToString(fingerprint[:]),
			PublishedAtUnixMs: publishedAt.UnixMilli(),
			SupportedVersions: encodeSupportedVersions(
				bundle.SupportedWireVersions,
			),
			CreatedAt: publishedAt,
			UpdatedAt: publishedAt,
		}).Error; err != nil {
			return storeFailure("persist Direct identity key", err)
		}
		return nil
	case err != nil:
		return storeFailure("lookup Direct identity key", err)
	case !bytes.Equal(existing.IdentityKeyPub, bundle.IdentityKeyPublic):
		return domain.NewError(
			domain.ErrorCodeConflict,
			"key_exchange.store.upload_direct_bundle",
			"identity_key_public",
			"cannot replace the identity key for an enrolled device",
		)
	default:
		if err := tx.Model(&IdentityKeyModel{}).
			Where(
				"actor_ptid = ? AND device_id = ?",
				bundle.Device.ActorPTID,
				bundle.Device.DeviceID,
			).
			Updates(map[string]any{
				"key_fingerprint":      hex.EncodeToString(fingerprint[:]),
				"published_at_unix_ms": publishedAt.UnixMilli(),
				"supported_versions": encodeSupportedVersions(
					bundle.SupportedWireVersions,
				),
				"updated_at": publishedAt,
			}).Error; err != nil {
			return storeFailure("update Direct identity key", err)
		}
		return nil
	}
}

func upsertCanonicalSignedPreKey(
	tx *gorm.DB,
	bundle domain.DirectKeyBundle,
	publishedAt time.Time,
) error {
	var existing SignedPreKeyModel
	err := tx.Where(
		"actor_ptid = ? AND device_id = ?",
		bundle.Device.ActorPTID,
		bundle.Device.DeviceID,
	).Order("created_at DESC, id DESC").First(&existing).Error
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		if err := tx.Create(&SignedPreKeyModel{
			ActorPtid: bundle.Device.ActorPTID,
			DeviceID:  bundle.Device.DeviceID,
			SPKID:     bundle.SignedPreKeyID,
			PublicKey: append([]byte(nil), bundle.SignedPreKeyPublic...),
			Signature: append([]byte(nil), bundle.SignedPreKeySignature...),
			CreatedAt: publishedAt,
		}).Error; err != nil {
			return storeFailure("persist Direct signed pre-key", err)
		}
		return nil
	case err != nil:
		return storeFailure("lookup Direct signed pre-key", err)
	case bundle.SignedPreKeyID < existing.SPKID:
		return domain.NewError(
			domain.ErrorCodeStaleMaterial,
			"key_exchange.store.upload_direct_bundle",
			"signed_pre_key_id",
			"is older than the published signed pre-key",
		)
	case bundle.SignedPreKeyID == existing.SPKID:
		if !bytes.Equal(existing.PublicKey, bundle.SignedPreKeyPublic) ||
			!bytes.Equal(existing.Signature, bundle.SignedPreKeySignature) {
			return domain.NewError(
				domain.ErrorCodeConflict,
				"key_exchange.store.upload_direct_bundle",
				"signed_pre_key_id",
				"is already bound to different key material",
			)
		}
		return nil
	default:
		if err := tx.Model(&SignedPreKeyModel{}).
			Where("id = ?", existing.ID).
			Updates(map[string]any{
				"spk_id":     bundle.SignedPreKeyID,
				"public_key": append([]byte(nil), bundle.SignedPreKeyPublic...),
				"signature":  append([]byte(nil), bundle.SignedPreKeySignature...),
				"created_at": publishedAt,
			}).Error; err != nil {
			return storeFailure("update Direct signed pre-key", err)
		}
		return nil
	}
}

func insertCanonicalDirectOneTimePreKeys(
	tx *gorm.DB,
	device domain.Endpoint,
	keys []domain.DirectOneTimePreKey,
	createdAt time.Time,
) error {
	for _, key := range keys {
		var existing OneTimePreKeyModel
		err := tx.Where(
			"actor_ptid = ? AND device_id = ? AND opk_id = ?",
			device.ActorPTID,
			device.DeviceID,
			key.KeyID,
		).First(&existing).Error
		switch {
		case err == nil:
			if !bytes.Equal(existing.PublicKey, key.PublicKey) {
				return domain.NewError(
					domain.ErrorCodeConflict,
					"key_exchange.store.upload_direct_one_time_pre_keys",
					"one_time_pre_keys",
					"a key ID is already bound to different material",
				)
			}
		case errors.Is(err, gorm.ErrRecordNotFound):
			if err := tx.Create(&OneTimePreKeyModel{
				ActorPtid: device.ActorPTID,
				DeviceID:  device.DeviceID,
				OPKID:     key.KeyID,
				PublicKey: append([]byte(nil), key.PublicKey...),
				Consumed:  false,
				CreatedAt: createdAt.UTC(),
			}).Error; err != nil {
				return storeFailure("persist Direct one-time pre-key", err)
			}
		default:
			return storeFailure("lookup Direct one-time pre-key", err)
		}
	}
	return nil
}

func consumeDirectOneTimePreKey(
	tx *gorm.DB,
	device domain.Endpoint,
) (*domain.DirectOneTimePreKey, error) {
	for {
		var candidate OneTimePreKeyModel
		err := tx.Clauses(clause.Locking{
			Strength: "UPDATE",
			Options:  "SKIP LOCKED",
		}).
			Where(
				"actor_ptid = ? AND device_id = ? AND consumed = ?",
				device.ActorPTID,
				device.DeviceID,
				false,
			).
			Order("id ASC").
			First(&candidate).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, storeFailure("select Direct one-time pre-key", err)
		}
		result := tx.Model(&OneTimePreKeyModel{}).
			Where("id = ? AND consumed = ?", candidate.ID, false).
			Update("consumed", true)
		if result.Error != nil {
			return nil, storeFailure("consume Direct one-time pre-key", result.Error)
		}
		if result.RowsAffected == 0 {
			continue
		}
		return &domain.DirectOneTimePreKey{
			KeyID:     candidate.OPKID,
			PublicKey: append([]byte(nil), candidate.PublicKey...),
		}, nil
	}
}

func selectAvailableMLSKeyPackage(
	tx *gorm.DB,
	actorPTID string,
	activeDeviceIDs []string,
	homeStationID string,
	at time.Time,
) (MLSKeyPackageModel, error) {
	var keyPackage MLSKeyPackageModel
	query := tx.Clauses(clause.Locking{
		Strength: "UPDATE",
		Options:  "SKIP LOCKED",
	}).
		Where(
			"ptid = ? AND device_id IN ? AND consumed_at IS NULL "+
				"AND (reserved_plan_id = '' OR reserved_until <= ?)",
			actorPTID,
			activeDeviceIDs,
			at.UTC(),
		)
	if strings.TrimSpace(homeStationID) != "" {
		query = query.Where("station_id = ?", homeStationID)
	}
	if err := query.
		Order("created_at ASC, id ASC").
		First(&keyPackage).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return MLSKeyPackageModel{}, domain.NewError(
				domain.ErrorCodeNotFound,
				"key_exchange.store.select_mls_key_package",
				"key_package",
				"is unavailable",
			)
		}
		return MLSKeyPackageModel{},
			storeFailure("select available MLS KeyPackage", err)
	}
	if _, err := mlsKeyPackageFromModel(keyPackage); err != nil {
		return MLSKeyPackageModel{}, err
	}
	return keyPackage, nil
}

func findFederatedMLSClaim(
	db *gorm.DB,
	claim domain.MLSKeyPackageClaim,
	lock bool,
) (FederatedMLSKeyPackageClaimModel, bool, error) {
	var existing FederatedMLSKeyPackageClaimModel
	query := db
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.
		Where(
			"authority_station_id = ? AND authority_plan_id = ? "+
				"AND target_ptid = ? AND target_device_id = ?",
			claim.AuthorityStationID,
			claim.AuthorityPlanID,
			claim.Target.ActorPTID,
			claim.Target.DeviceID,
		).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return FederatedMLSKeyPackageClaimModel{}, false, nil
	}
	if err != nil {
		return FederatedMLSKeyPackageClaimModel{}, false,
			storeFailure("lookup MLS KeyPackage claim receipt", err)
	}
	return existing, true, nil
}

func hasFederatedMLSClaimForTarget(
	db *gorm.DB,
	target domain.Endpoint,
) (bool, error) {
	var count int64
	if err := db.Model(&FederatedMLSKeyPackageClaimModel{}).
		Where(
			"target_ptid = ? AND target_device_id = ?",
			target.ActorPTID,
			target.DeviceID,
		).
		Count(&count).Error; err != nil {
		return false, storeFailure("lookup competing MLS KeyPackage claim", err)
	}

	return count > 0, nil
}

func replayFederatedMLSClaim(
	existing FederatedMLSKeyPackageClaimModel,
	claim domain.MLSKeyPackageClaim,
	homeStationID string,
) (domain.MLSKeyPackageReservation, error) {
	if existing.HomeStationID != homeStationID ||
		!existing.PlanExpiresAt.Equal(claim.PlanExpiresAt.UTC()) {
		return domain.MLSKeyPackageReservation{}, domain.NewError(
			domain.ErrorCodeConflict,
			"key_exchange.store.claim_mls_key_package",
			"claim",
			"conflicts with the persisted exact-once receipt",
		)
	}
	return reservationFromClaimModel(existing)
}

func reservationFromClaimModel(
	claim FederatedMLSKeyPackageClaimModel,
) (domain.MLSKeyPackageReservation, error) {
	hash, err := fixedSHA256(claim.KeyPackageSHA256)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	reservation := domain.MLSKeyPackageReservation{
		PlanID: claim.AuthorityPlanID,
		Target: domain.Endpoint{
			ActorPTID: claim.TargetPTID,
			DeviceID:  claim.TargetDeviceID,
		},
		PackageID:            claim.PackageID,
		KeyPackage:           append([]byte(nil), claim.KeyPackage...),
		PackageHash:          hash,
		HomeStation:          claim.HomeStationID,
		PlanExpiresAt:        claim.PlanExpiresAt.UTC(),
		IrreversiblyConsumed: true,
	}
	if err := reservation.Validate(
		"key_exchange.store.claim_mls_key_package",
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	return reservation, nil
}

func reservationFromMLSModel(
	keyPackage MLSKeyPackageModel,
	planID string,
	expiresAt time.Time,
	consumed bool,
) (domain.MLSKeyPackageReservation, error) {
	value, err := mlsKeyPackageFromModel(keyPackage)
	if err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	reservation := domain.MLSKeyPackageReservation{
		PlanID:               planID,
		Target:               value.Device,
		PackageID:            value.PackageID,
		KeyPackage:           append([]byte(nil), value.KeyPackage...),
		PackageHash:          value.PackageHash,
		HomeStation:          value.HomeStation,
		PlanExpiresAt:        expiresAt.UTC(),
		IrreversiblyConsumed: consumed,
	}
	if err := reservation.Validate(
		"key_exchange.store.mls_key_package_reservation",
	); err != nil {
		return domain.MLSKeyPackageReservation{}, err
	}
	return reservation, nil
}

func mlsKeyPackageFromModel(
	value MLSKeyPackageModel,
) (domain.MLSKeyPackage, error) {
	hash, err := fixedSHA256(value.DataSHA256)
	if err != nil {
		return domain.MLSKeyPackage{}, err
	}
	keyPackage := domain.MLSKeyPackage{
		PackageID: strconv.FormatUint(uint64(value.ID), 10),
		Device: domain.Endpoint{
			ActorPTID: value.ActorPTID,
			DeviceID:  value.DeviceID,
		},
		HomeStation:  value.HomeStationID,
		KeyPackage:   append([]byte(nil), value.Data...),
		PackageHash:  hash,
		CreatedAt:    value.CreatedAt.UTC(),
		ConsumedAt:   cloneTime(value.ConsumedAt),
		ReservedPlan: value.ReservedPlanID,
		ReservedTill: cloneTime(value.ReservedUntil),
	}
	if err := keyPackage.Validate(
		"key_exchange.store.mls_key_package",
	); err != nil {
		return domain.MLSKeyPackage{}, err
	}
	return keyPackage, nil
}

func fixedSHA256(value []byte) ([sha256.Size]byte, error) {
	var hash [sha256.Size]byte
	if len(value) != sha256.Size {
		return hash, domain.NewError(
			domain.ErrorCodeConflict,
			"key_exchange.store.verify_key_package",
			"key_package_sha256",
			"must contain exactly 32 bytes",
		)
	}
	copy(hash[:], value)
	return hash, nil
}

func parseMLSKeyPackageID(operation string, value string) (uint64, error) {
	parsed, err := strconv.ParseUint(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed == 0 {
		return 0, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"package_id",
			"must identify a persisted local package",
		)
	}
	return parsed, nil
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := value.UTC()
	return &cloned
}

func storeFailure(operation string, err error) error {
	if err == nil {
		return nil
	}
	if domain.CodeOf(err) != "" {
		return err
	}
	return domain.WrapError(
		domain.ErrorCodeInternal,
		"key_exchange.store."+strings.ReplaceAll(operation, " ", "_"),
		err,
	)
}
