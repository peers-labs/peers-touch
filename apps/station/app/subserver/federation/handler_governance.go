package federation

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"

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
		return nil, server.NotFound(ErrFederationNotFound.Error())
	}
	if fed.Status != "active" && fed.Status != "archived" {
		return nil, server.Conflict(
			"Federation ledger is unavailable in its current state",
		)
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
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil {
		return nil, server.Unauthorized(
			"Federation Station authentication required",
		)
	}
	if claims.Scope != FederationGovernanceProposalScope ||
		claims.Issuer != req.StationPeerId ||
		claims.Subject != req.StationPeerId {
		return nil, server.Forbidden(
			"Federation Station identity mismatch",
		)
	}

	fed, err := s.federationSvc.GetFederation(ctx, req.FederationId)
	if err != nil {
		return nil, err
	}
	if fed == nil {
		return nil, server.NotFound(ErrFederationNotFound.Error())
	}

	localPeerID := localStationPeerID()
	if localPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}
	if fed.SequencerStationPeerID != localPeerID {
		return nil, errors.New("this station is not the sequencer for this federation")
	}

	proposalID := ""
	var acceptedEvent *pb.LedgerEvent
	var bootstrapEvents []*pb.LedgerEvent
	switch req.ProposedEventType {
	case pb.EventType_STATION_JOIN_APPROVED:
		if req.JoiningStationName == "" {
			return nil, errors.New("joining_station_name is required")
		}
		joiningURL, parseErr := url.ParseRequestURI(req.JoiningStationUrl)
		if parseErr != nil || joiningURL.Scheme == "" || joiningURL.Host == "" {
			return nil, errors.New("joining_station_url must be an absolute HTTP endpoint")
		}
		existing, existingErr := s.membershipRepo.GetByStation(
			ctx,
			req.FederationId,
			req.StationPeerId,
		)
		if existingErr != nil {
			return nil, existingErr
		}
		if existing != nil && existing.Status == "active" {
			if existing.StationName != req.JoiningStationName ||
				strings.TrimRight(existing.StationURL, "/") !=
					strings.TrimRight(req.JoiningStationUrl, "/") {
				return nil, errors.New(
					"active Station join conflicts with existing routing",
				)
			}
			proposalID = existing.ApprovedByEventID
			break
		}
		membership, approveErr := s.federationSvc.ApproveJoinAsSequencer(
			ctx,
			req.FederationId,
			req.StationPeerId,
			req.JoiningStationName,
			req.JoiningStationUrl,
		)
		if approveErr != nil {
			return nil, approveErr
		}
		proposalID = membership.ApprovedByEventID
		bootstrapEvents, err = s.ledgerSvc.FetchAllEvents(
			ctx,
			req.FederationId,
		)
		if err != nil {
			return nil, err
		}
		if len(bootstrapEvents) == 0 {
			return nil, errors.New(
				"accepted Federation has no bootstrap ledger",
			)
		}
		acceptedEvent = bootstrapEvents[len(bootstrapEvents)-1]
	case pb.EventType_STATION_LEFT:
		payload := &pb.StationLeftPayload{}
		if err := proto.Unmarshal(req.PayloadBytes, payload); err != nil {
			return nil, errors.New("STATION_LEFT proposal payload is invalid")
		}
		if payload.LeavingStationPeerId != req.StationPeerId ||
			payload.LeavingActorPtid != req.ActorPtid ||
			payload.LeavingActorFederatedHandle != req.ActorFederatedHandle {
			return nil, errors.New("STATION_LEFT proposal identity mismatch")
		}
		existing, existingErr := s.membershipRepo.GetByStation(
			ctx,
			req.FederationId,
			req.StationPeerId,
		)
		if existingErr != nil {
			return nil, existingErr
		}
		if existing != nil && existing.Status == "left" {
			bootstrapEvents, err = s.ledgerSvc.FetchAllEvents(
				ctx,
				req.FederationId,
			)
			if err != nil {
				return nil, err
			}
			acceptedEvent, err = latestStationLeftEvent(
				bootstrapEvents,
				req.StationPeerId,
			)
			if err != nil {
				return nil, err
			}
			proposalID = acceptedEvent.EventId
			break
		}
		acceptedEvent, err = s.federationSvc.ApproveLeaveAsSequencer(
			ctx,
			req.FederationId,
			payload.LeavingActorPtid,
			payload.LeavingActorFederatedHandle,
			payload.LeavingStationPeerId,
			payload.Reason,
		)
		if err != nil {
			return nil, err
		}
		proposalID = acceptedEvent.EventId
	default:
		return nil, errors.New("proposed event type is unsupported")
	}
	if bootstrapEvents == nil {
		bootstrapEvents, err = s.ledgerSvc.FetchAllEvents(
			ctx,
			req.FederationId,
		)
		if err != nil {
			return nil, err
		}
		if len(bootstrapEvents) == 0 {
			return nil, errors.New(
				"accepted Federation has no bootstrap ledger",
			)
		}
	}
	if acceptedEvent == nil {
		acceptedEvent = bootstrapEvents[len(bootstrapEvents)-1]
	}

	return &pb.SubmitProposalResponse{
		ProposalId:      proposalID,
		Decision:        pb.ProposalDecision_DECISION_ACCEPTED,
		AcceptedEvent:   acceptedEvent,
		BootstrapEvents: bootstrapEvents,
	}, nil
}

func latestStationLeftEvent(
	events []*pb.LedgerEvent,
	stationPeerID string,
) (*pb.LedgerEvent, error) {
	for index := len(events) - 1; index >= 0; index-- {
		event := events[index]
		if event == nil || event.EventType != pb.EventType_STATION_LEFT {
			continue
		}
		payload := &pb.StationLeftPayload{}
		if err := proto.Unmarshal(event.PayloadBytes, payload); err != nil {
			return nil, fmt.Errorf(
				"decode accepted STATION_LEFT event: %w",
				err,
			)
		}
		if payload.LeavingStationPeerId == stationPeerID {
			return event, nil
		}
	}
	return nil, errors.New("accepted STATION_LEFT event is missing")
}
