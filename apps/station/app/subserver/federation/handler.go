package federation

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
)

type ListFederationsRequest struct{}

func (s *subServer) handleListFederations(ctx context.Context, _ *ListFederationsRequest) (*pb.ListFederationsResponse, error) {
	// TODO: extract actor_id and station_peer_id from JWT context
	actorID := "placeholder"
	stationPeerID := "placeholder"

	return s.projectionSvc.ListFederations(ctx, stationPeerID, actorID)
}

func (s *subServer) handleCreateFederation(ctx context.Context, req *pb.CreateFederationRequest) (*pb.CreateFederationResponse, error) {
	// TODO: extract from JWT context
	actorID := "placeholder"
	actorHandle := "placeholder"
	stationPeerID := "placeholder"
	stationName := "placeholder"
	stationURL := "placeholder"

	policyType := req.PolicyType
	if policyType == "" {
		policyType = "single_admin"
	}

	fed, err := s.federationSvc.CreateFederation(ctx, &application.CreateFederationInput{
		Name:          req.Name,
		Description:   req.Description,
		PolicyType:    policyType,
		ActorID:       actorID,
		ActorHandle:   actorHandle,
		StationPeerID: stationPeerID,
		StationName:   stationName,
		StationURL:    stationURL,
	})
	if err != nil {
		return nil, err
	}

	return &pb.CreateFederationResponse{
		FederationId: fed.FederationID,
		Federation: &pb.FederationSummary{
			FederationId: fed.FederationID,
			Name:         fed.Name,
			Description:  fed.Description,
			Status:       fed.Status,
			PolicyType:   fed.PolicyType,
		},
	}, nil
}

func (s *subServer) handleListMemberStations(ctx context.Context, req *pb.ListMemberStationsRequest) (*pb.ListMemberStationsResponse, error) {
	return s.projectionSvc.ListMemberStations(ctx, req.FederationId)
}

func (s *subServer) handleJoinFederation(_ context.Context, _ *pb.JoinFederationRequest) (*pb.JoinFederationResponse, error) {
	return nil, errors.New("join federation not yet implemented")
}

func (s *subServer) handleLeaveFederation(_ context.Context, _ *pb.LeaveFederationRequest) (*pb.LeaveFederationResponse, error) {
	return nil, errors.New("leave federation not yet implemented")
}
