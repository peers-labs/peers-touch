package domain

import (
	"context"
	"crypto/subtle"
	"errors"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"google.golang.org/protobuf/proto"
)

var (
	ErrForkDetected   = errors.New("fork detected: prev_hash mismatch")
	ErrSeqDiscontinuity = errors.New("sequence discontinuity")
)

type ReplayService struct {
	eventRepo LedgerEventRepository
	hashSvc   *HashService
	sigSvc    *SignatureService
}

func NewReplayService(eventRepo LedgerEventRepository, hashSvc *HashService, sigSvc *SignatureService) *ReplayService {
	return &ReplayService{eventRepo: eventRepo, hashSvc: hashSvc, sigSvc: sigSvc}
}

type MaterializedState struct {
	FederationID            string
	HeadHash                []byte
	HeadSeq                 uint64
	SequencerStationPeerID  string
	PolicyType              string
	ActiveMemberStations    []string
	Status                  string
}

func (r *ReplayService) ReplayFromGenesis(ctx context.Context, federationID string) (*MaterializedState, error) {
	events, err := r.eventRepo.ListAll(ctx, federationID)
	if err != nil {
		return nil, err
	}
	if len(events) == 0 {
		return nil, errors.New("no events found for federation")
	}

	state := &MaterializedState{
		FederationID: federationID,
		Status:       "active",
	}

	var prevHash []byte
	for i, event := range events {
		if i == 0 {
			prevHash = make([]byte, 32)
		}

		if subtle.ConstantTimeCompare(event.PrevHash, prevHash) != 1 {
			return nil, ErrForkDetected
		}
		if event.Seq != uint64(i) {
			return nil, ErrSeqDiscontinuity
		}

		r.applyEvent(state, event)
		prevHash = event.EventHash
	}

	state.HeadHash = prevHash
	state.HeadSeq = uint64(len(events) - 1)
	return state, nil
}

func (r *ReplayService) applyEvent(state *MaterializedState, event *pb.LedgerEvent) {
	switch event.EventType {
	case pb.EventType_FEDERATION_CREATED:
		state.SequencerStationPeerID = event.SequencerStationPeerId
		state.PolicyType = "single_admin"
		state.ActiveMemberStations = append(state.ActiveMemberStations, event.StationPeerId)

	case pb.EventType_STATION_JOIN_APPROVED:
		var payload pb.StationJoinApprovedPayload
		if err := proto.Unmarshal(event.PayloadBytes, &payload); err == nil {
			state.ActiveMemberStations = append(state.ActiveMemberStations, payload.ApprovedStationPeerId)
		}

	case pb.EventType_STATION_LEFT, pb.EventType_STATION_REMOVED:
		state.ActiveMemberStations = removeStation(state.ActiveMemberStations, event.StationPeerId)

	case pb.EventType_SEQUENCER_CHANGED:
		state.SequencerStationPeerID = event.SequencerStationPeerId
	}
}

func removeStation(stations []string, peerID string) []string {
	result := make([]string, 0, len(stations))
	for _, s := range stations {
		if s != peerID {
			result = append(result, s)
		}
	}
	return result
}
