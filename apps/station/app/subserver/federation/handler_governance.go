package federation

import (
	"context"
	"errors"
	"net/url"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
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
	if req.JoiningStationName == "" {
		return nil, errors.New("joining_station_name is required")
	}
	joiningURL, err := url.ParseRequestURI(req.JoiningStationUrl)
	if err != nil || joiningURL.Scheme == "" || joiningURL.Host == "" {
		return nil, errors.New("joining_station_url must be an absolute HTTP endpoint")
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

	if req.ProposedEventType != pb.EventType_STATION_JOIN_APPROVED {
		return nil, errors.New("only STATION_JOIN_APPROVED proposals are supported")
	}

	actorKeySvc := s.actorKeySvc
	_, actorPriv, err := actorKeySvc.GenerateKeyPair(ctx, req.ActorId)
	if err != nil {
		actorPriv, err = actorKeySvc.GetPrivateKey(ctx, req.ActorId)
		if err != nil {
			actorPriv = nil
		}
	}

	sequencerActorID := fed.CreatedByActorID
	_, seqPriv, keyErr := actorKeySvc.GenerateKeyPair(ctx, sequencerActorID)
	if keyErr != nil {
		seqPriv, keyErr = actorKeySvc.GetPrivateKey(ctx, sequencerActorID)
		if keyErr != nil {
			return nil, errors.New("sequencer key not available")
		}
	}

	membership, err := s.federationSvc.ApproveJoin(ctx, &application.ApproveJoinInput{
		FederationID:          req.FederationId,
		JoiningStationPeerID:  req.StationPeerId,
		JoiningStationName:    req.JoiningStationName,
		JoiningStationURL:     req.JoiningStationUrl,
		ApproverActorID:       sequencerActorID,
		ApproverActorHandle:   sequencerActorID,
		ApproverStationPeerID: localPeerID,
		ActorPrivateKey:       seqPriv,
		StationPrivateKey:     seqPriv,
	})
	if err != nil {
		return nil, err
	}

	_ = actorPriv
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
}
