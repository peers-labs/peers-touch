package federation

import (
	"context"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
)

// Governance RPC handlers — called by remote member stations to sync ledger.

func (s *subServer) handleFetchHead(ctx context.Context, req *pb.FetchHeadRequest) (*pb.FetchHeadResponse, error) {
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
