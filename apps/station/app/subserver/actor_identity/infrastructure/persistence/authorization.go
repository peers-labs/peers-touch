package persistence

import (
	"bytes"
	"crypto/ed25519"
	"errors"
	"sort"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// DeviceLocator identifies one actor-owned device without exposing storage IDs.
type DeviceLocator struct {
	PTID     string
	DeviceID string
}

// RequireActiveDeviceForMutation locks and verifies one active actor-device row.
//
// The caller must pass the same transaction that performs the protected
// mutation. The row lock serializes that mutation with Actor Identity revoke.
func RequireActiveDeviceForMutation(
	tx *gorm.DB,
	device DeviceLocator,
) error {
	return RequireActiveDevicesForMutation(tx, []DeviceLocator{device})
}

// LockActiveDeviceProfileVersionForMutation returns Actor Identity-owned
// endpoint epoch authority while holding the exact device row through commit.
func LockActiveDeviceProfileVersionForMutation(
	tx *gorm.DB,
	device DeviceLocator,
) (uint64, error) {
	const operation = "actor_identity.lock_active_device_profile_for_mutation"

	if tx == nil {
		return 0, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"transaction",
			"is required",
		)
	}
	if err := domain.ValidatePTID(operation, device.PTID); err != nil {
		return 0, err
	}
	if err := domain.ValidateDeviceID(operation, device.DeviceID); err != nil {
		return 0, err
	}

	var record ActorDeviceModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("id", "profile_version").
		Where(
			"ptid = ? AND device_id = ? AND revoked = ? "+
				"AND revoked_at IS NULL AND verification_source <> ? "+
				"AND length(public_key) = ? AND profile_version > ?",
			device.PTID,
			device.DeviceID,
			false,
			0,
			ed25519.PublicKeySize,
			0,
		).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"device",
			"is not an active verified actor device",
		)
	}
	if err != nil {
		return 0, domain.WrapError(
			domain.ErrorCodePersistence,
			operation,
			err,
		)
	}

	return uint64(record.ProfileVersion), nil
}

// RequireActiveDevicesForMutation locks active actor-device rows in stable order.
func RequireActiveDevicesForMutation(
	tx *gorm.DB,
	devices []DeviceLocator,
) error {
	const operation = "actor_identity.require_active_devices_for_mutation"

	if tx == nil {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"transaction",
			"is required",
		)
	}
	if len(devices) == 0 {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"devices",
			"must contain at least one actor device",
		)
	}

	canonical := append([]DeviceLocator(nil), devices...)
	sort.Slice(canonical, func(left int, right int) bool {
		if canonical[left].PTID == canonical[right].PTID {
			return canonical[left].DeviceID < canonical[right].DeviceID
		}

		return canonical[left].PTID < canonical[right].PTID
	})

	var previous DeviceLocator
	for index, device := range canonical {
		if err := domain.ValidatePTID(operation, device.PTID); err != nil {
			return err
		}
		if err := domain.ValidateDeviceID(operation, device.DeviceID); err != nil {
			return err
		}
		if index > 0 && device == previous {
			continue
		}

		var record ActorDeviceModel
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Select("id").
			Where(
				"ptid = ? AND device_id = ? AND revoked = ? "+
					"AND verification_source <> ? AND length(public_key) = ?",
				device.PTID,
				device.DeviceID,
				false,
				0,
				ed25519.PublicKeySize,
			).
			First(&record).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return domain.NewError(
				domain.ErrorCodeUnauthorized,
				operation,
				"device",
				"is not an active verified actor device",
			)
		}
		if err != nil {
			return domain.WrapError(
				domain.ErrorCodePersistence,
				operation,
				err,
			)
		}
		previous = device
	}

	return nil
}

// RequireVerifiedActorDeviceSigningKeyForMutation locks the exact
// actor_devices row and compares it with an Actor Identity-resolved snapshot.
// The caller must keep tx open through the protected cross-domain commit.
func RequireVerifiedActorDeviceSigningKeyForMutation(
	tx *gorm.DB,
	expected *actormodel.VerifiedActorDeviceSigningKey,
) error {
	const operation = "actor_identity.require_verified_device_signing_key_for_mutation"

	if tx == nil {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"transaction",
			"is required",
		)
	}
	if expected == nil {
		return domain.NewError(
			domain.ErrorCodeInvalidArgument,
			operation,
			"device_signing_key",
			"is required",
		)
	}
	if err := domain.ValidatePTID(operation, expected.GetActorPtid()); err != nil {
		return err
	}
	if err := domain.ValidateDeviceID(
		operation,
		expected.GetActorDeviceId(),
	); err != nil {
		return err
	}
	if strings.TrimSpace(expected.GetSigningKeyId()) == "" ||
		expected.GetSigningKeyId() != strings.TrimSpace(expected.GetSigningKeyId()) ||
		len(expected.GetEd25519PublicKey()) != ed25519.PublicKeySize ||
		expected.GetProfileVersion() <= 0 ||
		expected.GetRevokedAtUnixMs() != 0 ||
		!trustedSigningKeySource(expected.GetVerificationSource()) {
		return domain.NewError(
			domain.ErrorCodeInvalidProof,
			operation,
			"device_signing_key",
			"is not an active verified snapshot",
		)
	}

	var current ActorDeviceModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"ptid = ? AND device_id = ?",
			expected.GetActorPtid(),
			expected.GetActorDeviceId(),
		).
		First(&current).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"device",
			"is not an active verified actor device",
		)
	}
	if err != nil {
		return domain.WrapError(
			domain.ErrorCodePersistence,
			operation,
			err,
		)
	}
	if current.Revoked || current.RevokedAt != nil {
		return domain.NewError(
			domain.ErrorCodeUnauthorized,
			operation,
			"device",
			"was revoked",
		)
	}
	if current.SigningKeyID != expected.GetSigningKeyId() ||
		!bytes.Equal(current.PublicKey, expected.GetEd25519PublicKey()) ||
		current.ProfileVersion != expected.GetProfileVersion() ||
		current.VerificationSource != int32(expected.GetVerificationSource()) {
		return domain.NewError(
			domain.ErrorCodeIdentityConflict,
			operation,
			"device_signing_key",
			"changed after it was resolved",
		)
	}

	return nil
}
