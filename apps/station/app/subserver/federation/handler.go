package federation

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	log "github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/proto"
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
	actorPTID := subject.ID
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	return s.projectionSvc.ListFederations(ctx, stationPeerID, actorPTID)
}

func (s *subServer) handleCreateFederation(ctx context.Context, req *pb.CreateFederationRequest) (*pb.CreateFederationResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	actorPTID := subject.ID
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
		Name:                 req.Name,
		Description:          req.Description,
		PolicyType:           policyType,
		ActorPTID:            actorPTID,
		ActorFederatedHandle: subject.ID,
		StationPeerID:        stationPeerID,
		StationName:          node.GetService().Name(),
		StationURL:           localStationURL(),
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

	actorPTID := subject.ID
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	_, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, actorPTID)
	if err != nil {
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, actorPTID)
		if err != nil {
			return nil, err
		}
	}

	fed, _ := s.federationSvc.GetFederation(ctx, req.FederationId)
	isLocalSequencer := fed != nil && fed.SequencerStationPeerID == stationPeerID

	if isLocalSequencer {
		membership, approveErr := s.federationSvc.ApproveJoin(ctx, &application.ApproveJoinInput{
			FederationID:                 req.FederationId,
			JoiningStationPeerID:         stationPeerID,
			JoiningStationName:           node.GetService().Name(),
			JoiningStationURL:            localStationURL(),
			ApproverActorPTID:            actorPTID,
			ApproverActorFederatedHandle: actorPTID,
			ApproverStationPeerID:        stationPeerID,
			ActorPrivateKey:              actorPriv,
			StationPrivateKey:            actorPriv,
		})
		if approveErr != nil {
			return nil, approveErr
		}
		return &pb.JoinFederationResponse{
			Status:     membership.Status,
			ProposalId: membership.ApprovedByEventID,
		}, nil
	}

	if req.FederationEndpoint == "" {
		return nil, errors.New("federation_endpoint is required for remote join")
	}
	sequencerStationPeerID := strings.TrimSpace(req.SequencerStationPeerId)
	if sequencerStationPeerID == "" {
		return nil, errors.New("sequencer_station_peer_id is required for remote join")
	}

	remoteEndpoint := req.FederationEndpoint
	if !strings.HasPrefix(remoteEndpoint, "http://") &&
		!strings.HasPrefix(remoteEndpoint, "https://") {
		remoteEndpoint = fmt.Sprintf("http://%s", remoteEndpoint)
	}

	proposalReq := &pb.SubmitProposalRequest{
		FederationId:         req.FederationId,
		ProposedEventType:    pb.EventType_STATION_JOIN_APPROVED,
		ActorPtid:            actorPTID,
		ActorFederatedHandle: actorPTID,
		StationPeerId:        stationPeerID,
		JoiningStationUrl:    localStationURL(),
		JoiningStationName:   node.GetService().Name(),
	}

	log.Infof(ctx, "[federation] submitting join proposal to remote sequencer %s for federation %s", remoteEndpoint, req.FederationId)

	resp, err := s.govClient.SubmitProposal(
		ctx,
		remoteEndpoint,
		sequencerStationPeerID,
		proposalReq,
	)
	if err != nil {
		return nil, fmt.Errorf("remote join failed: %w", err)
	}

	status := "pending"
	if resp.Decision == pb.ProposalDecision_DECISION_ACCEPTED {
		if err := s.federationSvc.BootstrapReplica(
			ctx,
			&application.BootstrapFederationReplicaInput{
				FederationID:       req.FederationId,
				LocalActorPTID:     actorPTID,
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

	actorPTID := subject.ID
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
	if fed.SequencerStationPeerID == stationPeerID {
		return nil, errors.New("sequencer must hand over before leaving the federation")
	}

	localMembership, err := s.membershipRepo.GetByStation(
		ctx,
		req.FederationId,
		stationPeerID,
	)
	if err != nil {
		return nil, err
	}
	if localMembership == nil || localMembership.Status != "active" {
		return nil, errors.New("local Station is not an active federation member")
	}
	if s.actorRoleRepo == nil {
		return nil, server.InternalError("Federation actor-role repository unavailable")
	}
	actorRole, err := s.actorRoleRepo.GetByActor(
		ctx,
		req.FederationId,
		actorPTID,
	)
	if err != nil {
		return nil, err
	}
	if actorRole == nil ||
		actorRole.StationPeerID != stationPeerID ||
		!application.CapabilityForRole(actorRole.Role).CanLeave {
		return nil, server.Forbidden(
			"actor is not authorized to leave this Federation for the local Station",
		)
	}

	sequencerMembership, err := s.membershipRepo.GetByStation(
		ctx,
		req.FederationId,
		fed.SequencerStationPeerID,
	)
	if err != nil {
		return nil, err
	}
	if sequencerMembership == nil || sequencerMembership.Status != "active" {
		return nil, errors.New("federation sequencer is not an active member")
	}
	sequencerEndpoint := strings.TrimRight(
		strings.TrimSpace(sequencerMembership.StationURL),
		"/",
	)
	if sequencerEndpoint == "" {
		return nil, errors.New("federation sequencer endpoint is unavailable")
	}

	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&pb.StationLeftPayload{
			LeavingStationPeerId:        stationPeerID,
			LeavingActorPtid:            actorPTID,
			LeavingActorFederatedHandle: actorPTID,
			Reason:                      req.Reason,
		},
	)
	if err != nil {
		return nil, err
	}
	payloadHash := sha256.Sum256(payloadBytes)

	if s.govClient == nil {
		return nil, server.InternalError("federation governance client unavailable")
	}
	resp, err := s.govClient.SubmitProposal(
		ctx,
		sequencerEndpoint,
		fed.SequencerStationPeerID,
		&pb.SubmitProposalRequest{
			FederationId:         req.FederationId,
			ProposedEventType:    pb.EventType_STATION_LEFT,
			PayloadBytes:         payloadBytes,
			PayloadHash:          payloadHash[:],
			ActorPtid:            actorPTID,
			ActorFederatedHandle: actorPTID,
			StationPeerId:        stationPeerID,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("remote leave failed: %w", err)
	}
	if resp.Decision != pb.ProposalDecision_DECISION_ACCEPTED {
		reason := strings.TrimSpace(resp.RejectionReason)
		if reason == "" {
			reason = "proposal was not accepted"
		}
		return nil, fmt.Errorf("remote leave rejected: %s", reason)
	}
	if resp.AcceptedEvent == nil ||
		resp.AcceptedEvent.FederationId != req.FederationId ||
		resp.AcceptedEvent.EventType != pb.EventType_STATION_LEFT {
		return nil, errors.New("remote leave returned an invalid accepted event")
	}

	if s.syncManager == nil {
		return nil, server.InternalError("federation sync manager unavailable")
	}
	if syncErr := s.syncManager.SyncFederationNow(ctx, req.FederationId); syncErr != nil {
		return nil, fmt.Errorf("sync accepted federation leave: %w", syncErr)
	}
	localMembership, err = s.membershipRepo.GetByStation(
		ctx,
		req.FederationId,
		stationPeerID,
	)
	if err != nil {
		return nil, err
	}
	if localMembership == nil || localMembership.Status != "left" {
		return nil, errors.New("accepted federation leave did not converge locally")
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

	actorPTID := subject.ID
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
	if fed.CreatedByActorPTID != actorPTID {
		return nil, errors.New("only the federation owner can delete it")
	}

	_, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, actorPTID)
	if err != nil {
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, actorPTID)
		if err != nil {
			return nil, err
		}
	}

	err = s.federationSvc.DeleteFederation(ctx, &application.DeleteFederationInput{
		FederationID:         req.FederationId,
		ActorPTID:            actorPTID,
		ActorFederatedHandle: actorPTID,
		StationPeerID:        stationPeerID,
		ActorPrivateKey:      actorPriv,
		StationPrivateKey:    actorPriv,
	})
	if err != nil {
		return nil, err
	}

	return &pb.DeleteFederationResponse{Success: true}, nil
}
