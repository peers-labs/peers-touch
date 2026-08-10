package infrastructure_test

import (
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/gorm"
)

func testEndpointManifestResolver(
	t *testing.T,
	db *gorm.DB,
	now time.Time,
) messaging.EndpointManifestResolver {
	t.Helper()
	repository, err := infrastructure.NewEndpointManifestRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	privateKey := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	directory := infrastructure.NewDeviceDirectory(db)
	return messaging.EndpointManifestResolveFunc(func(
		ctx context.Context,
		actorPTID string,
	) (*chat.FederatedEndpointManifest, error) {
		homeStationID, err := directory.ActorHomeStationID(ctx, actorPTID)
		if err != nil {
			return nil, err
		}
		manifest, err := repository.BuildLocalManifestSnapshot(
			ctx,
			actorPTID,
			homeStationID,
			now,
		)
		if err != nil {
			return nil, err
		}
		if err := application.SignEndpointManifest(
			manifest,
			"test-station-key",
			privateKey,
		); err != nil {
			return nil, err
		}
		manifestBytes, manifestHash, err := application.EndpointManifestSHA256(manifest)
		if err != nil {
			return nil, err
		}
		if err := repository.SaveVerifiedManifest(
			ctx,
			manifest,
			manifestBytes,
			manifestHash,
		); err != nil {
			return nil, err
		}
		return manifest, nil
	})
}
