package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	domainrepository "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain/repository"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const localVerificationSource = int32(
	actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_LOCAL_DEVICE_REGISTRATION,
)

// Repository persists the canonical Actor Identity lifecycle.
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs an Actor Identity repository.
func NewRepository(db *gorm.DB) (*Repository, error) {
	if db == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"actor_identity.new_repository",
			"db",
			"is required",
		)
	}

	return &Repository{db: db}, nil
}

// AutoMigrate creates the canonical Actor Identity tables for Station composition.
func (r *Repository) AutoMigrate() error {
	if err := r.db.AutoMigrate(
		&ActorIdentityModel{},
		&ActorDeviceModel{},
		&ActorEndpointDirectoryVersionModel{},
	); err != nil {
		return domain.WrapError(
			domain.ErrorCodePersistence,
			"actor_identity.migrate",
			err,
		)
	}

	return nil
}

// Enroll atomically establishes actor continuity and activates one verified device.
func (r *Repository) Enroll(
	ctx context.Context,
	enrollment domain.Enrollment,
	enrolledAt time.Time,
) (domain.Device, error) {
	if enrolledAt.IsZero() {
		return domain.Device{}, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"actor_identity.enroll",
			"enrolled_at",
			"is required",
		)
	}

	var enrolled domain.Device
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		identity, err := establishActorIdentity(tx, enrollment, enrolledAt.UTC())
		if err != nil {
			return err
		}

		device, err := establishActorDevice(tx, identity, enrollment, enrolledAt.UTC())
		if err != nil {
			return err
		}
		enrolled = device

		return nil
	})
	if err != nil {
		return domain.Device{}, mapPersistenceError("actor_identity.enroll", err)
	}

	return enrolled.Clone(), nil
}

// List returns verified devices, including terminal revoked records.
func (r *Repository) List(ctx context.Context, ptid string) ([]domain.Device, error) {
	var models []ActorDeviceModel
	if err := r.db.WithContext(ctx).
		Where("ptid = ? AND verification_source = ?", ptid, localVerificationSource).
		Order("id ASC").
		Find(&models).Error; err != nil {
		return nil, mapPersistenceError("actor_identity.list", err)
	}
	if len(models) == 0 {
		return []domain.Device{}, nil
	}

	var identity ActorIdentityModel
	if err := r.db.WithContext(ctx).
		Where("ptid = ?", ptid).
		First(&identity).Error; err != nil {
		return nil, mapPersistenceError("actor_identity.list_identity", err)
	}

	devices := make([]domain.Device, 0, len(models))
	for _, model := range models {
		devices = append(devices, deviceFromModel(model, identity.Fingerprint))
	}

	return devices, nil
}

// Revoke atomically applies an actor-profile fence and terminal revocation.
func (r *Repository) Revoke(
	ctx context.Context,
	ptid string,
	deviceID string,
	observedProfileVersion uint64,
	revokedAt time.Time,
) (domain.Device, error) {
	var revoked domain.Device
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var identity ActorIdentityModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("ptid = ?", ptid).
			First(&identity).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.NewError(
					domain.ErrorCodeDeviceNotFound,
					"actor_identity.revoke",
					"device_id",
					"was not found for the authenticated actor",
				)
			}

			return err
		}

		var model ActorDeviceModel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where(
				"ptid = ? AND device_id = ? AND verification_source = ?",
				ptid,
				deviceID,
				localVerificationSource,
			).
			First(&model).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.NewError(
					domain.ErrorCodeDeviceNotFound,
					"actor_identity.revoke",
					"device_id",
					"was not found for the authenticated actor",
				)
			}

			return err
		}

		current := deviceFromModel(model, identity.Fingerprint)
		next, err := current.Revoke(
			observedProfileVersion,
			uint64(identity.ProfileVersion),
			revokedAt,
		)
		if err != nil {
			return err
		}
		if current.Status == domain.DeviceStatusRevoked {
			revoked = next

			return nil
		}

		result := tx.Model(&ActorDeviceModel{}).
			Where("id = ? AND revoked = ?", model.ID, false).
			Updates(map[string]interface{}{
				"profile_version": int64(next.ProfileVersion),
				"revoked":         true,
				"revoked_at":      next.RevokedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return domain.NewError(
				domain.ErrorCodeDeviceConflict,
				"actor_identity.revoke",
				"device_id",
				"changed during revocation",
			)
		}
		revoked = next

		return nil
	})
	if err != nil {
		return domain.Device{}, mapPersistenceError("actor_identity.revoke", err)
	}

	return revoked.Clone(), nil
}

func establishActorIdentity(
	tx *gorm.DB,
	enrollment domain.Enrollment,
	now time.Time,
) (ActorIdentityModel, error) {
	candidate := ActorIdentityModel{
		PTID:           enrollment.PTID,
		PublicKey:      append([]byte(nil), enrollment.ActorIdentityPublicKey...),
		Fingerprint:    append([]byte(nil), enrollment.ActorIdentityFingerprint...),
		ProfileVersion: int64(enrollment.ProfileVersion),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
		Create(&candidate).Error; err != nil {
		return ActorIdentityModel{}, err
	}

	var identity ActorIdentityModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("ptid = ?", enrollment.PTID).
		First(&identity).Error; err != nil {
		return ActorIdentityModel{}, err
	}
	current := domain.ActorIdentity{
		PTID:           identity.PTID,
		PublicKey:      append([]byte(nil), identity.PublicKey...),
		Fingerprint:    append([]byte(nil), identity.Fingerprint...),
		ProfileVersion: uint64(identity.ProfileVersion),
	}
	if err := current.ValidateEnrollment(enrollment); err != nil {
		return ActorIdentityModel{}, err
	}
	if enrollment.ProfileVersion > uint64(identity.ProfileVersion) {
		result := tx.Model(&ActorIdentityModel{}).
			Where("ptid = ? AND profile_version = ?", identity.PTID, identity.ProfileVersion).
			Updates(map[string]interface{}{
				"profile_version": int64(enrollment.ProfileVersion),
				"updated_at":      now,
			})
		if result.Error != nil {
			return ActorIdentityModel{}, result.Error
		}
		if result.RowsAffected != 1 {
			return ActorIdentityModel{}, domain.NewError(
				domain.ErrorCodeIdentityConflict,
				"actor_identity.enroll",
				"observed_profile_version",
				"changed during enrollment",
			)
		}
		identity.ProfileVersion = int64(enrollment.ProfileVersion)
		identity.UpdatedAt = now
	}

	return identity, nil
}

func establishActorDevice(
	tx *gorm.DB,
	identity ActorIdentityModel,
	enrollment domain.Enrollment,
	now time.Time,
) (domain.Device, error) {
	candidate := ActorDeviceModel{
		PTID:               enrollment.PTID,
		ActorAccount:       enrollment.ActorAccount,
		ActorKind:          enrollment.ActorKind,
		DeviceID:           enrollment.DeviceID,
		Label:              enrollment.Label,
		HomeStationPeerID:  enrollment.HomeStationPeerID,
		SigningKeyID:       enrollment.SigningKeyID,
		PublicKey:          append([]byte(nil), enrollment.DeviceSigningPublicKey...),
		ProfileVersion:     int64(enrollment.ProfileVersion),
		VerificationSource: localVerificationSource,
		Revoked:            false,
		CreatedAt:          now,
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).
		Create(&candidate).Error; err != nil {
		return domain.Device{}, err
	}

	var model ActorDeviceModel
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("ptid = ? AND device_id = ?", enrollment.PTID, enrollment.DeviceID).
		First(&model).Error; err != nil {
		return domain.Device{}, err
	}
	current := deviceFromModel(model, identity.Fingerprint)
	if err := current.ValidateEnrollment(enrollment); err != nil {
		return domain.Device{}, err
	}

	updates := map[string]interface{}{
		"actor_acct":           enrollment.ActorAccount,
		"actor_kind":           enrollment.ActorKind,
		"label":                enrollment.Label,
		"home_station_peer_id": enrollment.HomeStationPeerID,
		"signing_key_id":       enrollment.SigningKeyID,
		"public_key":           append([]byte(nil), enrollment.DeviceSigningPublicKey...),
		"profile_version":      int64(enrollment.ProfileVersion),
		"verification_source":  localVerificationSource,
	}
	result := tx.Model(&ActorDeviceModel{}).
		Where("id = ? AND revoked = ?", model.ID, false).
		Updates(updates)
	if result.Error != nil {
		return domain.Device{}, result.Error
	}
	if result.RowsAffected != 1 {
		return domain.Device{}, domain.NewError(
			domain.ErrorCodeDeviceConflict,
			"actor_identity.enroll",
			"device_id",
			"changed during enrollment",
		)
	}

	model.ActorAccount = enrollment.ActorAccount
	model.ActorKind = enrollment.ActorKind
	model.Label = enrollment.Label
	model.HomeStationPeerID = enrollment.HomeStationPeerID
	model.SigningKeyID = enrollment.SigningKeyID
	model.PublicKey = append([]byte(nil), enrollment.DeviceSigningPublicKey...)
	model.ProfileVersion = int64(enrollment.ProfileVersion)
	model.VerificationSource = localVerificationSource

	return deviceFromModel(model, identity.Fingerprint), nil
}

func deviceFromModel(
	model ActorDeviceModel,
	actorIdentityFingerprint []byte,
) domain.Device {
	status := domain.DeviceStatusActive
	if model.Revoked {
		status = domain.DeviceStatusRevoked
	}

	return domain.Device{
		PTID:                     model.PTID,
		ActorAccount:             model.ActorAccount,
		ActorKind:                model.ActorKind,
		DeviceID:                 model.DeviceID,
		Label:                    model.Label,
		HomeStationPeerID:        model.HomeStationPeerID,
		ActorIdentityFingerprint: append([]byte(nil), actorIdentityFingerprint...),
		DeviceSigningPublicKey:   append([]byte(nil), model.PublicKey...),
		SigningKeyID:             model.SigningKeyID,
		ProfileVersion:           uint64(model.ProfileVersion),
		ActivationSequence:       model.ID,
		Verified:                 model.VerificationSource != 0,
		Status:                   status,
		EnrolledAt:               model.CreatedAt.UTC(),
		RevokedAt:                cloneTime(model.RevokedAt),
	}
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := value.UTC()

	return &cloned
}

func mapPersistenceError(operation string, err error) error {
	if err == nil {
		return nil
	}
	var typed *domain.Error
	if errors.As(err, &typed) {
		return err
	}

	return domain.WrapError(domain.ErrorCodePersistence, operation, err)
}

var _ domainrepository.DeviceRepository = (*Repository)(nil)
