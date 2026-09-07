package persistence

import (
	"context"
	"crypto/ed25519"

	"github.com/peers-labs/peers-touch/station/app/subserver/recovery/application/ports"
	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
)

// ActorDeviceAuthorizer verifies Recovery access against canonical Actor stores.
type ActorDeviceAuthorizer struct {
	db *gorm.DB
}

// NewActorDeviceAuthorizer constructs the production Recovery authorization adapter.
func NewActorDeviceAuthorizer(db *gorm.DB) *ActorDeviceAuthorizer {
	return &ActorDeviceAuthorizer{db: db}
}

// IsActorAuthorizedForRecovery permits a fresh device to restore only an existing actor.
func (a *ActorDeviceAuthorizer) IsActorAuthorizedForRecovery(
	ctx context.Context,
	ptid string,
) (bool, error) {
	var count int64
	err := a.db.WithContext(ctx).
		Model(&modeldb.Actor{}).
		Where("ptid = ?", ptid).
		Count(&count).Error
	return count == 1, err
}

// IsDeviceAuthorizedForRecovery requires one active, locally verified actor device.
func (a *ActorDeviceAuthorizer) IsDeviceAuthorizedForRecovery(
	ctx context.Context,
	ptid string,
	deviceID string,
) (bool, error) {
	var count int64
	err := a.db.WithContext(ctx).
		Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where(
			"ptid = ? AND device_id = ? AND revoked = ? "+
				"AND verification_source <> ? AND length(public_key) = ?",
			ptid,
			deviceID,
			false,
			int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED),
			ed25519.PublicKeySize,
		).
		Count(&count).Error
	return count == 1, err
}

var _ ports.ActorDeviceAuthorizer = (*ActorDeviceAuthorizer)(nil)
