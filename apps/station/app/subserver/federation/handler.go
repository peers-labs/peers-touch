package federation

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
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

func (s *subServer) governanceActor(
	ctx context.Context,
) (string, error) {
	if s.stationRoleRepo == nil {
		return "", server.InternalError(
			"Station governance authorization is unavailable",
		)
	}
	actorPTID, err := s.stationRoleRepo.InitialOwnerPTID(ctx)
	if err != nil {
		return "", server.InternalErrorWithCause(
			"resolve Station Federation governance signer",
			err,
		)
	}
	return actorPTID, nil
}

// ensureDefaultFederation materializes the Station's local social domain on
// first authenticated need, so a single Station supports local friend requests
// and catalog lookup without manual federation setup. It is idempotent and
// best-effort: provisioning problems must not break the context read path; the
// caller simply returns whatever (possibly empty) projection exists.
func (s *subServer) ensureDefaultFederation(ctx context.Context) {
	if s.federationSvc == nil || s.stationRoleRepo == nil {
		return
	}
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return
	}
	s.defaultFedMu.Lock()
	defer s.defaultFedMu.Unlock()
	founderPTID, err := s.stationRoleRepo.InitialOwnerPTID(ctx)
	if err != nil {
		log.Warnf(ctx, "[federation] resolve default federation founder: %v", err)
		return
	}
	if _, _, err := s.federationSvc.EnsureDefaultFederation(ctx, &application.EnsureDefaultFederationInput{
		StationPeerID:    stationPeerID,
		StationName:      node.GetService().Name(),
		StationURL:       localStationURL(),
		FounderActorPTID: founderPTID,
	}); err != nil {
		log.Warnf(ctx, "[federation] ensure default federation: %v", err)
	}
}

func (s *subServer) handleListFederations(ctx context.Context, _ *ListFederationsRequest) (*pb.ListFederationsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	s.ensureDefaultFederation(ctx)
	actorPTID := subject.ID
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	return s.projectionSvc.ListFederations(ctx, stationPeerID, actorPTID)
}

func (s *subServer) CreateFederation(ctx context.Context, req *pb.CreateFederationRequest) (*pb.CreateFederationResponse, error) {
	actorPTID, err := s.governanceActor(ctx)
	if err != nil {
		return nil, err
	}
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
		ActorFederatedHandle: actorPTID,
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

func (s *subServer) JoinFederation(ctx context.Context, req *pb.JoinFederationRequest) (*pb.JoinFederationResponse, error) {
	actorPTID, err := s.governanceActor(ctx)
	if err != nil {
		return nil, err
	}
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}

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
		membership, err := s.federationSvc.ApproveJoin(ctx, &application.ApproveJoinInput{
			FederationID:                 req.FederationId,
			JoiningStationPeerID:         stationPeerID,
			JoiningStationName:           node.GetService().Name(),
			JoiningStationURL:            localStationURL(),
			ApproverActorPTID:            actorPTID,
			ApproverActorFederatedHandle: actorPTID,
			ApproverStationPeerID:        stationPeerID,
			ActorPrivateKey:              actorPriv,
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
		ActorPtid:            actorPTID,
		ActorFederatedHandle: actorPTID,
		StationPeerId:        stationPeerID,
		JoiningStationUrl:    localStationURL(),
		JoiningStationName:   node.GetService().Name(),
	}

	log.Infof(ctx, "[federation] submitting join proposal to remote sequencer %s for federation %s", remoteEndpoint, req.FederationId)

	sequencerIdentity, err := s.govClient.ResolveStationIdentity(
		ctx,
		remoteEndpoint,
	)
	if err != nil {
		return nil, remoteGovernanceError("join identity", err)
	}
	resp, err := s.govClient.SubmitProposal(
		ctx,
		remoteEndpoint,
		sequencerIdentity.StationPeerID,
		proposalReq,
	)
	if err != nil {
		return nil, remoteGovernanceError("join", err)
	}

	status := "pending"
	if resp.Decision == pb.ProposalDecision_DECISION_ACCEPTED {
		if err := s.federationSvc.BootstrapReplica(
			ctx,
			&application.BootstrapFederationReplicaInput{
				FederationID:                   req.FederationId,
				LocalActorPTID:                 actorPTID,
				LocalStationPeerID:             stationPeerID,
				ExpectedSequencerStationPeerID: sequencerIdentity.StationPeerID,
				ExpectedSequencerStationPublicKey: append(
					[]byte(nil),
					sequencerIdentity.FederationSigningPublicKey...,
				),
				Events: resp.BootstrapEvents,
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

func (s *subServer) LeaveFederation(ctx context.Context, req *pb.LeaveFederationRequest) (*pb.LeaveFederationResponse, error) {
	actorPTID, err := s.governanceActor(ctx)
	if err != nil {
		return nil, err
	}
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}

	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	fed, err := s.federationSvc.GetFederation(ctx, req.FederationId)
	if err != nil {
		return nil, err
	}
	if fed == nil {
		return nil, server.NotFound("Federation not found")
	}
	if fed.SequencerStationPeerID == stationPeerID {
		return nil, server.Conflict(
			"sequencer Station must hand over before leaving the Federation",
		)
	}

	sequencer, err := s.membershipRepo.GetByStation(
		ctx,
		req.FederationId,
		fed.SequencerStationPeerID,
	)
	if err != nil {
		return nil, err
	}
	if sequencer == nil || sequencer.Status != "active" ||
		strings.TrimSpace(sequencer.StationURL) == "" {
		return nil, server.NewHandlerError(
			http.StatusServiceUnavailable,
			"active Federation sequencer endpoint is unavailable",
		)
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
	response, err := s.govClient.SubmitProposal(
		ctx,
		strings.TrimRight(sequencer.StationURL, "/"),
		fed.SequencerStationPeerID,
		&pb.SubmitProposalRequest{
			FederationId:         req.FederationId,
			ProposedEventType:    pb.EventType_STATION_LEFT,
			PayloadBytes:         payloadBytes,
			ActorPtid:            actorPTID,
			ActorFederatedHandle: actorPTID,
			StationPeerId:        stationPeerID,
		},
	)
	if err != nil {
		return nil, remoteGovernanceError("leave", err)
	}
	if response.Decision != pb.ProposalDecision_DECISION_ACCEPTED ||
		response.AcceptedEvent == nil ||
		len(response.BootstrapEvents) == 0 {
		return nil, errors.New("remote leave was not accepted")
	}
	acceptedSeq := response.AcceptedEvent.Seq
	if acceptedSeq >= uint64(len(response.BootstrapEvents)) {
		return nil, errors.New(
			"remote leave response omits the accepted event sequence",
		)
	}
	acceptedInChain := response.BootstrapEvents[acceptedSeq]
	if acceptedInChain == nil ||
		acceptedInChain.EventId != response.AcceptedEvent.EventId ||
		!bytes.Equal(
			acceptedInChain.EventHash,
			response.AcceptedEvent.EventHash,
		) {
		return nil, errors.New(
			"remote leave response accepted event does not match its ledger sequence",
		)
	}
	if err := s.ledgerSvc.ImportBootstrapEvents(
		ctx,
		req.FederationId,
		response.BootstrapEvents,
	); err != nil {
		return nil, fmt.Errorf(
			"import accepted Federation leave ledger: %w",
			err,
		)
	}

	return &pb.LeaveFederationResponse{Success: true}, nil
}

func (s *subServer) DeleteFederation(ctx context.Context, req *pb.DeleteFederationRequest) (*pb.DeleteFederationResponse, error) {
	actorPTID, err := s.governanceActor(ctx)
	if err != nil {
		return nil, err
	}
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}

	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

	fed, err := s.federationSvc.GetFederation(ctx, req.FederationId)
	if err != nil {
		return nil, err
	}
	if fed == nil {
		return nil, server.NotFound("Federation not found")
	}
	if fed.SequencerStationPeerID != stationPeerID {
		return nil, server.Forbidden(
			"only the sequencer Station can delete a Federation",
		)
	}
	if fed.CreatedByActorPTID != actorPTID {
		return nil, server.Forbidden(
			"only the Federation owner can delete it",
		)
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
	})
	if err != nil {
		return nil, err
	}

	return &pb.DeleteFederationResponse{Success: true}, nil
}

func remoteGovernanceError(operation string, err error) error {
	switch {
	case errors.Is(err, ErrRemoteFederationNotFound):
		return server.NotFound("Federation not found")
	case errors.Is(err, ErrRemoteGovernanceUnavailable):
		return server.NewHandlerErrorWithCause(
			http.StatusServiceUnavailable,
			"Federation sequencer unavailable",
			err,
		)
	case errors.Is(err, ErrRemoteGovernanceRejected):
		return server.BadRequestWithCause(
			"Federation governance proposal rejected",
			err,
		)
	case errors.Is(err, ErrRemoteGovernanceForbidden):
		return server.NewHandlerErrorWithCause(
			http.StatusForbidden,
			"Federation governance proposal forbidden",
			err,
		)
	case errors.Is(err, ErrRemoteGovernanceConflict):
		return server.NewHandlerErrorWithCause(
			http.StatusConflict,
			"Federation governance proposal conflicts with current state",
			err,
		)
	default:
		return server.InternalErrorWithCause(
			fmt.Sprintf("remote Federation %s failed", operation),
			err,
		)
	}
}
