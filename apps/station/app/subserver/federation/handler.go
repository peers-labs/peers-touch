package federation

import (
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

var (
	errNameRequired = errors.New("name is required")
	errNameTooLong  = errors.New("name exceeds 255 characters")
)

type ListFederationsRequest struct{}

func (s *subServer) handleListFederations(ctx context.Context, _ *ListFederationsRequest) (*pb.ListFederationsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorID := subject.ID
	stationPeerID := node.GetService().Options().Id

	return s.projectionSvc.ListFederations(ctx, stationPeerID, actorID)
}

func (s *subServer) handleCreateFederation(ctx context.Context, req *pb.CreateFederationRequest) (*pb.CreateFederationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorID := subject.ID
	stationPeerID := node.GetService().Options().Id

	if req.Name == "" {
		return nil, errNameRequired
	}
	if len(req.Name) > 255 {
		return nil, errNameTooLong
	}

	policyType := req.PolicyType
	if policyType == "" {
		policyType = "single_admin"
	}

	fed, err := s.federationSvc.CreateFederation(ctx, &application.CreateFederationInput{
		Name:          req.Name,
		Description:   req.Description,
		PolicyType:    policyType,
		ActorID:       actorID,
		ActorHandle:   subject.ID,
		StationPeerID: stationPeerID,
		StationName:   node.GetService().Name(),
		StationURL:    "",
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
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}
	return s.projectionSvc.ListMemberStations(ctx, req.FederationId)
}

func (s *subServer) handleJoinFederation(ctx context.Context, req *pb.JoinFederationRequest) (*pb.JoinFederationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}

	actorID := subject.ID
	stationPeerID := node.GetService().Options().Id

	_, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, actorID)
	if err != nil {
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, actorID)
		if err != nil {
			return nil, err
		}
	}

	membership, err := s.federationSvc.ApproveJoin(ctx, &application.ApproveJoinInput{
		FederationID:          req.FederationId,
		JoiningStationPeerID:  stationPeerID,
		JoiningStationName:    node.GetService().Name(),
		JoiningStationURL:     req.FederationEndpoint,
		ApproverActorID:       actorID,
		ApproverActorHandle:   actorID,
		ApproverStationPeerID: stationPeerID,
		ActorPrivateKey:       actorPriv,
		StationPrivateKey:     actorPriv,
	})
	if err != nil {
		return nil, err
	}

	return &pb.JoinFederationResponse{
		Status:     membership.Status,
		ProposalId: membership.ApprovedByEventID,
	}, nil
}

func (s *subServer) handleLeaveFederation(ctx context.Context, req *pb.LeaveFederationRequest) (*pb.LeaveFederationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}

	actorID := subject.ID
	stationPeerID := node.GetService().Options().Id

	_, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, actorID)
	if err != nil {
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, actorID)
		if err != nil {
			return nil, err
		}
	}

	err = s.federationSvc.LeaveFederation(ctx, &application.LeaveFederationInput{
		FederationID:      req.FederationId,
		ActorID:           actorID,
		ActorHandle:       actorID,
		StationPeerID:     stationPeerID,
		Reason:            req.Reason,
		ActorPrivateKey:   actorPriv,
		StationPrivateKey: actorPriv,
	})
	if err != nil {
		return nil, err
	}

	return &pb.LeaveFederationResponse{Success: true}, nil
}
