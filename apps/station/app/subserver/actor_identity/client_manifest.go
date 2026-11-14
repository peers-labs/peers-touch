package actor_identity

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	federation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
)

// Identity owns retrieval and continuity pinning. Consumers receive the
// original Home-signed manifest, never a key selected by the Social response.
func (c *actorCapabilities) verifiedManifest(ctx context.Context,
	request *model.GetActorEndpointManifestRequest) (*model.ActorEndpointManifest, error) {
	if request == nil || request.Actor == nil {
		return nil, server.BadRequest("Actor identity is required")
	}
	home, err := c.ResolveActorHomeStationPeerID(ctx, request.Actor.Ptid)
	if err != nil {
		return nil, err
	}
	if home == c.localStationID {
		response, err := c.GetEndpointManifest(ctx, c.localStationID, request)
		if err != nil {
			return nil, err
		}
		return response.Manifest, nil
	}
	provider, ok := server.GetOptions().SubserverInstances["federation"].(federation.RuntimeProvider)
	if !ok || provider == nil || provider.FederationDeliveryRuntime() == nil {
		return nil, fmt.Errorf("Actor Identity Federation runtime unavailable")
	}
	runtime := provider.FederationDeliveryRuntime()
	response := &model.GetActorEndpointManifestResponse{}
	if err := runtime.CallPeer(ctx, federation.PeerCall{
		TargetStationPeerID: home, Route: federation.PeerRouteActorEndpointManifest,
		Subject: c.localStationID,
		Claims: map[string]string{
			federation.ClaimActorPTID: request.Actor.Ptid,
			federation.ClaimSourceStationPeerID: c.localStationID,
			federation.ClaimTargetStationPeerID: home,
		},
		Request: request, Response: response,
	}); err != nil {
		return nil, err
	}
	manifest := response.Manifest
	if err := application.ValidateEndpointManifest(manifest, request.Actor.Ptid, home, time.Now()); err != nil {
		return nil, err
	}
	input := &model.ActorEndpointManifestSigningInput{
		FormatVersion: manifest.FormatVersion, ManifestId: manifest.ManifestId,
		Actor: manifest.Actor, HomeStationPeerId: manifest.HomeStationPeerId,
		DirectoryVersion: manifest.DirectoryVersion, ActiveEndpoints: manifest.ActiveEndpoints,
		IssuedAt: manifest.IssuedAt, ExpiresAt: manifest.ExpiresAt,
		SigningKeyId: manifest.SigningKeyId, ActorIdentityPublicKey: manifest.ActorIdentityPublicKey,
		ActorProfileVersion: manifest.ActorProfileVersion,
	}
	wire, err := proto.MarshalOptions{Deterministic: true}.Marshal(input)
	if err != nil {
		return nil, err
	}
	if err := runtime.VerifyPeerSignature(ctx, home, manifest.SigningKeyId, wire, manifest.StationSignature); err != nil {
		return nil, err
	}
	return manifest, nil
}

func (s *subServer) handleClientEndpointManifest(ctx context.Context,
	request *model.GetActorEndpointManifestRequest) (*model.GetActorEndpointManifestResponse, error) {
	if _, err := authenticatedActor(ctx, false); err != nil {
		return nil, err
	}
	capabilities, err := s.currentCapabilities()
	if err != nil {
		return nil, err
	}
	manifest, err := capabilities.verifiedManifest(ctx, request)
	if err != nil {
		return nil, server.BadRequestWithCause("Actor endpoint manifest unavailable", err)
	}
	database, err := s.dependencies.database(ctx)
	if err != nil {
		return nil, err
	}
	repository, err := persistence.NewRepository(database)
	if err != nil {
		return nil, err
	}
	if err := repository.AcceptVerifiedEndpointManifest(ctx, manifest, s.dependencies.clock().UTC()); err != nil {
		return nil, server.Conflict("Actor identity continuity conflict")
	}
	return &model.GetActorEndpointManifestResponse{Manifest: manifest}, nil
}
