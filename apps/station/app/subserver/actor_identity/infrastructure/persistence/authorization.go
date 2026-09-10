package persistence

import (
	"crypto/ed25519"
	"errors"
	"sort"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
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
