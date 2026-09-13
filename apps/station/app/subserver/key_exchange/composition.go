package key_exchange

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/infrastructure"
	httpinterface "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/interface/http"
	"gorm.io/gorm"
)

type canonicalCompositionConfig struct {
	database       *gorm.DB
	devices        application.DeviceDirectory
	actorHomes     application.ActorHomeStationDirectory
	deviceInbox    application.DeviceInboxPort
	federation     application.FederationPort
	clock          application.Clock
	ids            application.IDGenerator
	localStationID string
}

type canonicalComposition struct {
	store   *infrastructure.CanonicalStore
	service *application.CanonicalService
	api     *httpinterface.CanonicalAPI
}

func newCanonicalComposition(
	ctx context.Context,
	config canonicalCompositionConfig,
) (*canonicalComposition, error) {
	store, err := infrastructure.NewCanonicalStore(config.database)
	if err != nil {
		return nil, err
	}
	if err := store.Migrate(ctx); err != nil {
		return nil, err
	}
	service, err := application.NewCanonicalService(
		store,
		store,
		config.devices,
		config.actorHomes,
		config.deviceInbox,
		config.federation,
		config.clock,
		config.ids,
		config.localStationID,
	)
	if err != nil {
		return nil, err
	}
	api, err := httpinterface.NewCanonicalAPI(service)
	if err != nil {
		return nil, err
	}

	return &canonicalComposition{
		store:   store,
		service: service,
		api:     api,
	}, nil
}
