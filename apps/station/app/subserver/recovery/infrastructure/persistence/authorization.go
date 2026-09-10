package persistence

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/domain"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// ActorDeviceAuthorizer reads Actor Identity truth without taking mutation ownership.
type ActorDeviceAuthorizer struct {
	db      *gorm.DB
	devices *touchactor.DeviceStore
}

var _ ports.ActorDeviceAuthorizer = (*ActorDeviceAuthorizer)(nil)

// NewActorDeviceAuthorizer constructs the Recovery authorization adapter.
func NewActorDeviceAuthorizer(db *gorm.DB) (*ActorDeviceAuthorizer, error) {
	if db == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"persistence.new_actor_device_authorizer",
			"database",
			"is required",
		)
	}

	return &ActorDeviceAuthorizer{
		db:      db,
		devices: touchactor.NewDeviceStore(db),
	}, nil
}

// IsActorAuthorizedForRecovery permits a local authenticated actor to restore
// before the replacement device has been enrolled.
func (a *ActorDeviceAuthorizer) IsActorAuthorizedForRecovery(
	ctx context.Context,
	ptid string,
) (bool, error) {
	var count int64
	err := a.db.WithContext(ctx).
		Model(&modeldb.Actor{}).
		Where("ptid = ? AND origin = ?", ptid, touchactor.OriginLocal).
		Count(&count).
		Error
	if err != nil {
		return false, domain.WrapError(
			domain.ErrorCodePersistence,
			"persistence.authorize_recovery_actor",
			"touch_actor",
			"failed to read the actor identity",
			err,
		)
	}

	return count == 1, nil
}

// IsDeviceAuthorizedForRecovery requires one active verified actor-owned device.
func (a *ActorDeviceAuthorizer) IsDeviceAuthorizedForRecovery(
	ctx context.Context,
	ptid string,
	deviceID string,
) (bool, error) {
	authorized, err := a.devices.IsVerifiedActive(ctx, ptid, deviceID)
	if err != nil {
		return false, domain.WrapError(
			domain.ErrorCodePersistence,
			"persistence.authorize_recovery_device",
			"actor_devices",
			"failed to read the actor device",
			err,
		)
	}

	return authorized, nil
}
