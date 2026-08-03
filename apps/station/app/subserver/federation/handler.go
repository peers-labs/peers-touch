package federation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
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
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	return s.projectionSvc.ListFederations(ctx, stationPeerID, actorID)
}

func (s *subServer) handleCreateFederation(ctx context.Context, req *pb.CreateFederationRequest) (*pb.CreateFederationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorID := subject.ID
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

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
		StationURL:    localStationURL(),
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
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	_, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, actorID)
	if err != nil {
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, actorID)
		if err != nil {
			return nil, err
		}
	}

	fed, _ := s.federationSvc.GetFederation(ctx, req.FederationId)
	isLocalSequencer := fed != nil && fed.SequencerStationPeerID == stationPeerID

	if isLocalSequencer {
		membership, err := s.federationSvc.ApproveJoin(ctx, &application.ApproveJoinInput{
			FederationID:          req.FederationId,
			JoiningStationPeerID:  stationPeerID,
			JoiningStationName:    node.GetService().Name(),
			JoiningStationURL:     localStationURL(),
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

	if req.FederationEndpoint == "" {
		return nil, errors.New("federation_endpoint is required for remote join")
	}

	remoteEndpoint := req.FederationEndpoint
	if !strings.HasPrefix(remoteEndpoint, "http://") &&
		!strings.HasPrefix(remoteEndpoint, "https://") {
		remoteEndpoint = fmt.Sprintf("http://%s", remoteEndpoint)
	}

	proposalReq := &pb.SubmitProposalRequest{
		FederationId:         req.FederationId,
		ProposedEventType:    pb.EventType_STATION_JOIN_APPROVED,
		ActorId:              actorID,
		ActorFederatedHandle: actorID,
		StationPeerId:        stationPeerID,
		JoiningStationUrl:    localStationURL(),
		JoiningStationName:   node.GetService().Name(),
	}

	log.Infof(ctx, "[federation] submitting join proposal to remote sequencer %s for federation %s", remoteEndpoint, req.FederationId)

	resp, err := s.govClient.SubmitProposal(ctx, remoteEndpoint, "", proposalReq)
	if err != nil {
		return nil, fmt.Errorf("remote join failed: %w", err)
	}

	status := "pending"
	if resp.Decision == pb.ProposalDecision_DECISION_ACCEPTED {
		if err := s.federationSvc.BootstrapReplica(
			ctx,
			&application.BootstrapFederationReplicaInput{
				FederationID:       req.FederationId,
				LocalActorID:       actorID,
				LocalStationPeerID: stationPeerID,
				Events:             resp.BootstrapEvents,
			},
		); err != nil {
			return nil, fmt.Errorf("bootstrap accepted Federation: %w", err)
		}
		status = "active"
	}

	return &pb.JoinFederationResponse{
		Status:     status,
		ProposalId: resp.ProposalId,
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
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

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

func (s *subServer) handleDeleteFederation(ctx context.Context, req *pb.DeleteFederationRequest) (*pb.DeleteFederationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}

	actorID := subject.ID
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	fed, err := s.federationSvc.GetFederation(ctx, req.FederationId)
	if err != nil {
		return nil, err
	}
	if fed == nil {
		return nil, errors.New("federation not found")
	}
	if fed.SequencerStationPeerID != stationPeerID {
		return nil, errors.New("only the sequencer station can delete a federation")
	}
	if fed.CreatedByActorID != actorID {
		return nil, errors.New("only the federation owner can delete it")
	}

	_, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, actorID)
	if err != nil {
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, actorID)
		if err != nil {
			return nil, err
		}
	}

	err = s.federationSvc.DeleteFederation(ctx, &application.DeleteFederationInput{
		FederationID:      req.FederationId,
		ActorID:           actorID,
		ActorHandle:       actorID,
		StationPeerID:     stationPeerID,
		ActorPrivateKey:   actorPriv,
		StationPrivateKey: actorPriv,
	})
	if err != nil {
		return nil, err
	}

	return &pb.DeleteFederationResponse{Success: true}, nil
}
