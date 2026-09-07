package infrastructure

import (
	"context"
	"crypto/ed25519"
	"errors"

	actoridentitypersistence "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/domain"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"gorm.io/gorm"
)

// DeviceDirectory resolves canonical active-device routing from Actor Identity.
type DeviceDirectory struct {
	db *gorm.DB
}

// NewDeviceDirectory constructs a read adapter over the actor_devices truth store.
func NewDeviceDirectory(db *gorm.DB) (*DeviceDirectory, error) {
	if db == nil {
		return nil, domain.NewError(
			domain.ErrorCodeInvalidArgument,
			"key_exchange.new_device_directory",
			"database",
			"is required",
		)
	}
	return &DeviceDirectory{db: db}, nil
}

// ResolveActiveDevice returns one verified route or a typed absence.
func (d *DeviceDirectory) ResolveActiveDevice(
	ctx context.Context,
	endpoint domain.Endpoint,
) (domain.DeviceRoute, error) {
	var record actoridentitypersistence.ActorDeviceModel
	err := d.activeQuery(ctx).
		Where("ptid = ? AND device_id = ?", endpoint.ActorPTID, endpoint.DeviceID).
		First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.DeviceRoute{}, domain.NewError(
			domain.ErrorCodeNotFound,
			"key_exchange.resolve_active_device",
			"device",
			"is not active",
		)
	}
	if err != nil {
		return domain.DeviceRoute{}, domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.resolve_active_device",
			err,
		)
	}
	return deviceRoute(record)
}

// ListActiveDevices returns stable device-ID ordering for one PTID.
func (d *DeviceDirectory) ListActiveDevices(
	ctx context.Context,
	actorPTID string,
) ([]domain.DeviceRoute, error) {
	var records []actoridentitypersistence.ActorDeviceModel
	if err := d.activeQuery(ctx).
		Where("ptid = ?", actorPTID).
		Order("device_id ASC").
		Find(&records).Error; err != nil {
		return nil, domain.WrapError(
			domain.ErrorCodeInternal,
			"key_exchange.list_active_devices",
			err,
		)
	}
	routes := make([]domain.DeviceRoute, 0, len(records))
	for _, record := range records {
		route, err := deviceRoute(record)
		if err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}
	return routes, nil
}

func (d *DeviceDirectory) activeQuery(ctx context.Context) *gorm.DB {
	return d.db.WithContext(ctx).
		Model(&actoridentitypersistence.ActorDeviceModel{}).
		Where(
			"revoked = ? AND verification_source <> ? AND length(public_key) = ?",
			false,
			int32(actormodel.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED),
			ed25519.PublicKeySize,
		)
}

func deviceRoute(
	record actoridentitypersistence.ActorDeviceModel,
) (domain.DeviceRoute, error) {
	route := domain.DeviceRoute{
		Endpoint: domain.Endpoint{
			ActorPTID: record.PTID,
			DeviceID:  record.DeviceID,
		},
		HomeStationID: record.HomeStationPeerID,
	}
	if err := route.Validate("key_exchange.device_route"); err != nil {
		return domain.DeviceRoute{}, err
	}
	return route, nil
}

var _ application.DeviceDirectory = (*DeviceDirectory)(nil)
