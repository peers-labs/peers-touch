package social

import (
	"context"
	"crypto/ed25519"
	"errors"
	"net/http"
	"path/filepath"
	"testing"
	"time"

	actoridentityapp "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/application"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	sharedfederation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type privateEndpointIdentityActors struct {
	privateContentActorCapabilities
	manifest      *actormodel.ActorEndpointManifest
	validationErr error
}

type privateEndpointIdentityRouteGuard struct{}

func (privateEndpointIdentityRouteGuard) ResolveActiveStationURL(
	context.Context, string,
) (string, error) {
	return "", errors.New("endpoint identity test must not resolve a remote Station")
}

func (a privateEndpointIdentityActors) ResolveActorHomeStationPeerID(
	context.Context, string,
) (string, error) {
	return a.manifest.GetHomeStationPeerId(), nil
}

func (a privateEndpointIdentityActors) GetEndpointManifest(
	context.Context, string, *actormodel.GetActorEndpointManifestRequest,
) (*actormodel.GetActorEndpointManifestResponse, error) {
	return &actormodel.GetActorEndpointManifestResponse{
		Manifest: proto.Clone(a.manifest).(*actormodel.ActorEndpointManifest),
	}, nil
}

func (a privateEndpointIdentityActors) ValidateEndpointManifest(
	manifest *actormodel.ActorEndpointManifest,
	actorPTID, homeStation string,
	now time.Time,
) error {
	if a.validationErr != nil {
		return a.validationErr
	}
	return actoridentityapp.ValidateEndpointManifest(manifest, actorPTID, homeStation, now)
}

func (a privateEndpointIdentityActors) AcceptVerifiedEndpointManifest(
	context.Context, *actormodel.ActorEndpointManifest,
) error {
	return nil
}

func privateEndpointIdentityDirectory(t *testing.T) *privateContentRecipientDirectory {
	t.Helper()
	database, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "station.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDatabase.Close() })
	runtime, err := sharedfederation.NewRuntime(context.Background(), sharedfederation.RuntimeConfig{
		Database:           database,
		LocalStationPeerID: "station-local",
		KeyCache:           authfed.NewKeyCache(authfed.NewInMemoryKeyStore()),
		PeerKeys:           authfed.NewInMemoryPeerKeyStore(),
		Clock:              delivery.SystemClock{},
		HTTPClient:         &http.Client{},
		StationURLResolver: privateEndpointIdentityRouteGuard{},
		Dispatcher: delivery.DispatcherConfig{
			WorkerID: "endpoint-identity-test", BatchSize: 10,
			LeaseDuration: time.Minute, IdleDelay: time.Millisecond,
			RetryBackoff: delivery.RetryBackoff{Initial: time.Second, Maximum: time.Minute},
		},
		PeerEndpointResolver: func(sharedfederation.PeerRoute) (server.EndpointHandler, error) {
			return nil, errors.New("endpoint identity test must not call a remote peer")
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.November, 9, 6, 0, 0, 0, time.UTC)
	actor := &actormodel.ActorRef{
		Ptid: "ptid:v1:actor:peers:p:bob:1220d112c4e53405d2df5b04355bc8cbde006d6f11db84bba1414bddd0d98ca55d2f",
		Acct: "bob@p.t", Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
	}
	privateKey := ed25519.NewKeyFromSeed(make([]byte, ed25519.SeedSize))
	manifest := &actormodel.ActorEndpointManifest{
		FormatVersion: actoridentityapp.EndpointManifestFormatVersion,
		ManifestId:    "endpoint-identity-test",
		Actor:         actor, HomeStationPeerId: runtime.LocalStationPeerID(),
		DirectoryVersion: 1, ActorProfileVersion: 1,
		ActorIdentityPublicKey: privateKey.Public().(ed25519.PublicKey),
		IssuedAt:               timestamppb.New(now), ExpiresAt: timestamppb.New(now.Add(time.Minute)),
		ActiveEndpoints: []*actormodel.ActorEndpointManifestEntry{{
			Endpoint: &actormodel.ActorDeviceRef{
				Actor: proto.Clone(actor).(*actormodel.ActorRef), DeviceId: "bob-device",
			},
			SigningKeyId: "device-key", PublicMaterialSha256: [][]byte{make([]byte, 32)},
		}},
	}
	if err := actoridentityapp.SignEndpointManifest(manifest, "station-key", privateKey); err != nil {
		t.Fatal(err)
	}
	return &privateContentRecipientDirectory{
		actors: privateEndpointIdentityActors{manifest: manifest}, runtime: runtime,
		now: func() time.Time { return now },
	}
}

func TestPrivateActiveEndpointIdentityIgnoresAccountHint(t *testing.T) {
	directory := privateEndpointIdentityDirectory(t)
	actors := directory.actors.(privateEndpointIdentityActors)
	canonical := actors.manifest.GetActiveEndpoints()[0].GetEndpoint()
	tests := []struct {
		name       string
		acct       string
		deviceID   string
		kind       actormodel.ActorKind
		wantDenied bool
	}{
		{name: "canonical", acct: canonical.GetActor().GetAcct(), deviceID: "bob-device", kind: actormodel.ActorKind_ACTOR_KIND_PERSON},
		{name: "point-read identity", deviceID: "bob-device", kind: actormodel.ActorKind_ACTOR_KIND_PERSON},
		{name: "different routing hint", acct: "bob@another.example", deviceID: "bob-device", kind: actormodel.ActorKind_ACTOR_KIND_PERSON},
		{name: "unknown device", deviceID: "other-device", kind: actormodel.ActorKind_ACTOR_KIND_PERSON, wantDenied: true},
		{name: "missing device", kind: actormodel.ActorKind_ACTOR_KIND_PERSON, wantDenied: true},
		{name: "missing kind", deviceID: "bob-device", wantDenied: true},
		{name: "different kind", deviceID: "bob-device", kind: actormodel.ActorKind_ACTOR_KIND_GROUP, wantDenied: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			endpoint := &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: canonical.GetActor().GetPtid(), Acct: test.acct, Kind: test.kind,
				},
				DeviceId: test.deviceID,
			}
			err := directory.ValidateActiveEndpoint(context.Background(), endpoint)
			if test.wantDenied {
				if !errors.Is(err, application.ErrPrivateContentInactiveEndpoint) {
					t.Fatalf("unverified endpoint error = %v", err)
				}
			} else if err != nil {
				t.Fatalf("active actor/device identity rejected: %v", err)
			}
		})
	}
}

func TestPrivateActiveEndpointPreservesManifestValidationFailure(t *testing.T) {
	directory := privateEndpointIdentityDirectory(t)
	actors := directory.actors.(privateEndpointIdentityActors)
	actors.validationErr = errors.New("endpoint manifest signature verification failed")
	directory.actors = actors
	endpoint := actors.manifest.GetActiveEndpoints()[0].GetEndpoint()
	if err := directory.ValidateActiveEndpoint(context.Background(), endpoint); !errors.Is(err, actors.validationErr) {
		t.Fatalf("manifest verification failure was not preserved: %v", err)
	}
}

func TestPrivateActiveEndpointRejectsNonlocalHome(t *testing.T) {
	directory := privateEndpointIdentityDirectory(t)
	actors := directory.actors.(privateEndpointIdentityActors)
	actors.manifest.HomeStationPeerId = "station-remote"
	directory.actors = actors
	endpoint := actors.manifest.GetActiveEndpoints()[0].GetEndpoint()
	if err := directory.ValidateActiveEndpoint(context.Background(), endpoint); !errors.Is(err, application.ErrPrivateContentInactiveEndpoint) {
		t.Fatalf("nonlocal endpoint was not rejected: %v", err)
	}
}
