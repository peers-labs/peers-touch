package infrastructure

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	messaging "github.com/peers-labs/peers-touch/station/app/subserver/messaging/domain"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	federationresolver "github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	actordb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFederationPeerTrustResolverAuthenticatesActorRoute(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&actordb.Actor{}); err != nil {
		t.Fatal(err)
	}
	const (
		actorPTID   = "ptid:bob"
		actorHandle = "@bob@remote.invalid"
		homeStation = "station:remote"
	)
	if err := db.Create(&actordb.Actor{
		PTID:              actorPTID,
		Namespace:         "peers",
		PreferredUsername: "bob",
		Email:             "bob@remote.invalid",
		PasswordHash:      "not-used",
		FederatedHandle:   actorHandle,
		HomeStationPeerID: homeStation,
		Origin:            "remote_cached",
	}).Error; err != nil {
		t.Fatal(err)
	}
	key, err := authfed.MintLocalKey(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	trustResolver, err := newFederationPeerTrustResolver(
		db,
		peerKeys,
		func(_ context.Context, handle string) (*federationresolver.Resolved, error) {
			if handle != actorHandle {
				t.Fatalf("handle = %q, want %q", handle, actorHandle)
			}
			if err := peerKeys.UpsertTOFU(context.Background(), authfed.PeerKey{
				StationID: homeStation,
				Kid:       key.Kid,
				PubPEM:    key.PubPEM,
			}); err != nil {
				return nil, err
			}
			return &federationresolver.Resolved{
				Envelope: &profilepb.ActorProfileEnvelope{
					HomeStationPeerId: homeStation,
					Profile: &actormodel.ActorProfile{
						PeersTouch: &actormodel.PeersTouchInfo{
							NetworkId: actorPTID,
						},
					},
				},
				Locator: &locatorpb.ActorLocatorRecord{
					HomeStationPeerId: homeStation,
					SigningKeyKid:     key.Kid,
					SigningKeyPem:     key.PubPEM,
				},
			}, nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	if err := trustResolver.EnsurePeerTrust(
		context.Background(),
		homeStation,
		actorPTID,
	); err != nil {
		t.Fatal(err)
	}
}

func TestFederationPeerTrustResolverRejectsActorIdentityMismatch(t *testing.T) {
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&actordb.Actor{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&actordb.Actor{
		PTID:              "ptid:bob",
		Namespace:         "peers",
		PreferredUsername: "bob",
		Email:             "bob@remote.invalid",
		PasswordHash:      "not-used",
		FederatedHandle:   "@bob@remote.invalid",
		HomeStationPeerID: "station:remote",
		Origin:            "remote_cached",
	}).Error; err != nil {
		t.Fatal(err)
	}
	peerKeys := authfed.NewInMemoryPeerKeyStore()
	trustResolver, err := newFederationPeerTrustResolver(
		db,
		peerKeys,
		func(context.Context, string) (*federationresolver.Resolved, error) {
			return &federationresolver.Resolved{
				Envelope: &profilepb.ActorProfileEnvelope{
					HomeStationPeerId: "station:remote",
					Profile: &actormodel.ActorProfile{
						PeersTouch: &actormodel.PeersTouchInfo{
							NetworkId: "ptid:mallory",
						},
					},
				},
				Locator: &locatorpb.ActorLocatorRecord{
					HomeStationPeerId: "station:remote",
				},
			}, nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}

	err = trustResolver.EnsurePeerTrust(
		context.Background(),
		"station:remote",
		"ptid:bob",
	)
	if !errors.Is(err, messaging.ErrEndpointManifestConflict) {
		t.Fatalf("error = %v, want ErrEndpointManifestConflict", err)
	}
}
