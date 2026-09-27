package key_exchange

import (
	"context"
	"testing"

	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
)

type recordingActorSigningKeySubserver struct {
	server.Subserver

	actorPTID                 string
	expectedHomeStationPeerID string
	deviceID                  string
	signingKeyID              string
}

func (s *recordingActorSigningKeySubserver) ResolveVerifiedActorDeviceSigningKey(
	_ context.Context,
	_ federationdelivery.Transaction,
	actorPTID string,
	expectedHomeStationPeerID string,
	deviceID string,
	signingKeyID string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	s.actorPTID = actorPTID
	s.expectedHomeStationPeerID = expectedHomeStationPeerID
	s.deviceID = deviceID
	s.signingKeyID = signingKeyID

	return &actormodel.VerifiedActorDeviceSigningKey{}, nil
}

func (*recordingActorSigningKeySubserver) ResolveRetainedActorDeviceSigningKey(
	context.Context,
	federationdelivery.Transaction,
	string,
	string,
	string,
) (*actormodel.VerifiedActorDeviceSigningKey, error) {
	return nil, nil
}

func TestActorSigningKeyResolverBindsLocalHomeStation(t *testing.T) {
	option.GetOptions(
		option.WithRootCtx(context.Background()),
		server.WithAddress(""),
	)
	options := server.GetOptions()
	previous, hadPrevious := options.SubserverInstances["actor_identity"]
	provider := &recordingActorSigningKeySubserver{}
	options.SubserverInstances["actor_identity"] = provider
	t.Cleanup(func() {
		if hadPrevious {
			options.SubserverInstances["actor_identity"] = previous
			return
		}
		delete(options.SubserverInstances, "actor_identity")
	})

	resolver := actorSigningKeyResolver{localStationID: "station-local"}
	if _, err := resolver.ResolveVerifiedActorDeviceSigningKey(
		context.Background(),
		nil,
		" actor-alice ",
		" device-one ",
		" signing-key-one ",
	); err != nil {
		t.Fatal(err)
	}

	if provider.actorPTID != "actor-alice" ||
		provider.expectedHomeStationPeerID != "station-local" ||
		provider.deviceID != "device-one" ||
		provider.signingKeyID != "signing-key-one" {
		t.Fatalf(
			"Actor Identity request = actor %q, home %q, device %q, key %q",
			provider.actorPTID,
			provider.expectedHomeStationPeerID,
			provider.deviceID,
			provider.signingKeyID,
		)
	}
}
