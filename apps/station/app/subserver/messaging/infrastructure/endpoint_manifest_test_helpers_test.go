package infrastructure_test

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/application"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/messaging/infrastructure"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
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
		endpoints, err := directory.ListActiveEndpoints(ctx, actorPTID)
		if err != nil {
			return nil, err
		}
		if len(endpoints) == 0 {
			return nil, messaging.ErrNotFound
		}
		homeStationID, err := directory.HomeStationID(ctx, endpoints[0])
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

func testMixedEndpointManifestResolver(
	t *testing.T,
	db *gorm.DB,
	now time.Time,
) messaging.EndpointManifestResolver {
	t.Helper()
	local := testEndpointManifestResolver(t, db, now)
	repository, err := infrastructure.NewEndpointManifestRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	privateKey := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))

	return messaging.EndpointManifestResolveFunc(func(
		ctx context.Context,
		actorPTID string,
	) (*chat.FederatedEndpointManifest, error) {
		if actorPTID != "ptid:bob" {
			return local.ResolveEndpointManifest(ctx, actorPTID)
		}
		manifest := &chat.FederatedEndpointManifest{
			FormatVersion:    application.EndpointManifestFormatVersion,
			ManifestId:       "manifest:bob:1",
			ActorPtid:        actorPTID,
			HomeStationId:    "station:remote",
			DirectoryVersion: 1,
			ActiveEndpoints: []*chat.FederatedEndpointManifestEntry{{
				Endpoint: &chat.CryptoEndpoint{
					Ptid:     actorPTID,
					DeviceId: "bob-desktop",
				},
				SigningKeyId:         "key:bob-desktop",
				PublicMaterialSha256: [][]byte{bytes.Repeat([]byte{7}, 32)},
			}},
			IssuedAt:               timestamppb.New(now),
			ExpiresAt:              timestamppb.New(now.Add(5 * time.Minute)),
			ActorIdentityPublicKey: bytes.Repeat([]byte{2}, 32),
			ActorProfileVersion:    1,
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
