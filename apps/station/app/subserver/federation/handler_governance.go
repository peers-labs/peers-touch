package federation

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net/url"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/proto"
)

func (s *subServer) handleFetchHead(ctx context.Context, req *pb.FetchHeadRequest) (*pb.FetchHeadResponse, error) {
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}
	fed, err := s.federationSvc.GetFederation(ctx, req.FederationId)
	if err != nil {
		return nil, err
	}
	if fed == nil {
		return nil, ErrFederationNotFound
	}

	return &pb.FetchHeadResponse{
		FederationId:           fed.FederationID,
		HeadHash:               fed.HeadHash,
		HeadSeq:                fed.HeadSeq,
		SequencerStationPeerId: fed.SequencerStationPeerID,
	}, nil
}

func (s *subServer) handleFetchEvents(ctx context.Context, req *pb.FetchEventsRequest) (*pb.FetchEventsResponse, error) {
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}
	limit := req.Limit
	if limit == 0 || limit > 100 {
		limit = 100
	}

	events, err := s.ledgerSvc.FetchEvents(ctx, req.FederationId, req.FromSeq, limit)
	if err != nil {
		return nil, err
	}

	hasMore := uint32(len(events)) == limit
	var nextSeq uint64
	if len(events) > 0 {
		nextSeq = events[len(events)-1].Seq + 1
	}

	return &pb.FetchEventsResponse{
		Events:  events,
		HasMore: hasMore,
		NextSeq: nextSeq,
	}, nil
}

var ErrFederationNotFound = errFedNotFound{}

type errFedNotFound struct{}

func (e errFedNotFound) Error() string { return "federation not found" }

func (s *subServer) handleSubmitProposal(ctx context.Context, req *pb.SubmitProposalRequest) (*pb.SubmitProposalResponse, error) {
	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}
	if req.StationPeerId == "" {
		return nil, errors.New("station_peer_id is required")
	}
	if req.ActorPtid == "" {
		return nil, errors.New("actor_ptid is required")
	}
	if req.ActorFederatedHandle == "" {
		return nil, errors.New("actor_federated_handle is required")
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil ||
		claims.Issuer != req.StationPeerId ||
		claims.Subject != req.StationPeerId {
		return nil, server.Forbidden(
			"authenticated source Station does not match the governance proposal",
		)
	}

	fed, err := s.federationSvc.GetFederation(ctx, req.FederationId)
	if err != nil {
		return nil, err
	}
	if fed == nil {
		return nil, ErrFederationNotFound
	}

	localPeerID := localStationPeerID()
	if localPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}
	if fed.SequencerStationPeerID != localPeerID {
		return nil, errors.New("this station is not the sequencer for this federation")
	}

	actorKeySvc := s.actorKeySvc
	sequencerActorPTID := fed.CreatedByActorPTID
	_, seqPriv, keyErr := actorKeySvc.GenerateKeyPair(ctx, sequencerActorPTID)
	if keyErr != nil {
		seqPriv, keyErr = actorKeySvc.GetPrivateKey(ctx, sequencerActorPTID)
		if keyErr != nil {
			return nil, errors.New("sequencer key not available")
		}
	}

	switch req.ProposedEventType {
	case pb.EventType_STATION_JOIN_APPROVED:
		if req.JoiningStationName == "" {
			return nil, errors.New("joining_station_name is required")
		}
		joiningURL, err := url.ParseRequestURI(req.JoiningStationUrl)
		if err != nil || joiningURL.Scheme == "" || joiningURL.Host == "" {
			return nil, errors.New("joining_station_url must be an absolute HTTP endpoint")
		}

		membership, err := s.federationSvc.ApproveJoin(ctx, &application.ApproveJoinInput{
			FederationID:                 req.FederationId,
			JoiningStationPeerID:         req.StationPeerId,
			JoiningStationName:           req.JoiningStationName,
			JoiningStationURL:            req.JoiningStationUrl,
			ApproverActorPTID:            sequencerActorPTID,
			ApproverActorFederatedHandle: sequencerActorPTID,
			ApproverStationPeerID:        localPeerID,
			ActorPrivateKey:              seqPriv,
			StationPrivateKey:            seqPriv,
		})
		if err != nil {
			return nil, err
		}

		events, err := s.ledgerSvc.FetchEvents(ctx, req.FederationId, 0, 1000)
		if err != nil {
			return nil, err
		}
		if len(events) == 0 {
			return nil, errors.New("accepted Federation has no bootstrap ledger")
		}

		return &pb.SubmitProposalResponse{
			ProposalId:      membership.ApprovedByEventID,
			Decision:        pb.ProposalDecision_DECISION_ACCEPTED,
			AcceptedEvent:   events[len(events)-1],
			BootstrapEvents: events,
		}, nil

	case pb.EventType_STATION_LEFT:
		return s.handleAuthenticatedLeaveProposal(
			ctx,
			req,
			claims.Issuer,
			sequencerActorPTID,
			localPeerID,
			seqPriv,
		)

	default:
		return nil, errors.New("unsupported proposal event type")
	}
}

func (s *subServer) handleAuthenticatedLeaveProposal(
	ctx context.Context,
	req *pb.SubmitProposalRequest,
	sourceStationPeerID string,
	sequencerActorPTID string,
	localPeerID string,
	sequencerPrivateKey ed25519.PrivateKey,
) (*pb.SubmitProposalResponse, error) {
	if sourceStationPeerID == "" || sourceStationPeerID != req.StationPeerId {
		return nil, server.Forbidden(
			"authenticated source Station does not match the leave proposal",
		)
	}
	if len(req.PayloadBytes) == 0 {
		return nil, errors.New("payload_bytes is required")
	}
	payloadHash := sha256.Sum256(req.PayloadBytes)
	if len(req.PayloadHash) != sha256.Size ||
		subtle.ConstantTimeCompare(payloadHash[:], req.PayloadHash) != 1 {
		return nil, errors.New("payload_hash does not match payload_bytes")
	}

	payload := &pb.StationLeftPayload{}
	if err := proto.Unmarshal(req.PayloadBytes, payload); err != nil {
		return nil, errors.New("invalid STATION_LEFT payload")
	}
	if payload.LeavingStationPeerId != req.StationPeerId {
		return nil, errors.New("leaving station does not match proposal station")
	}
	if payload.LeavingActorPtid != req.ActorPtid ||
		payload.LeavingActorFederatedHandle != req.ActorFederatedHandle {
		return nil, errors.New("leaving actor does not match proposal actor")
	}

	event, err := s.federationSvc.ApproveLeave(ctx, &application.ApproveLeaveInput{
		FederationID:                 req.FederationId,
		LeavingStationPeerID:         payload.LeavingStationPeerId,
		LeavingActorPTID:             payload.LeavingActorPtid,
		LeavingActorFederatedHandle:  payload.LeavingActorFederatedHandle,
		Reason:                       payload.Reason,
		ApproverActorPTID:            sequencerActorPTID,
		ApproverActorFederatedHandle: sequencerActorPTID,
		ApproverStationPeerID:        localPeerID,
		ActorPrivateKey:              sequencerPrivateKey,
		StationPrivateKey:            sequencerPrivateKey,
	})
	if err != nil {
		return nil, err
	}

	return &pb.SubmitProposalResponse{
		ProposalId:    event.EventId,
		Decision:      pb.ProposalDecision_DECISION_ACCEPTED,
		AcceptedEvent: event,
	}, nil
}
