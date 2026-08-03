package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
)

type EventAppendedHook func(ctx context.Context, event *pb.LedgerEvent)

type LedgerService struct {
	federationRepo domain.FederationRepository
	eventRepo      domain.LedgerEventRepository
	membershipRepo domain.MembershipRepository
	hashSvc        *domain.HashService
	sigSvc         *domain.SignatureService
	policyRegistry *policy.Registry
	onAppended     EventAppendedHook
}

func NewLedgerService(
	federationRepo domain.FederationRepository,
	eventRepo domain.LedgerEventRepository,
	membershipRepo domain.MembershipRepository,
	hashSvc *domain.HashService,
	sigSvc *domain.SignatureService,
	policyRegistry *policy.Registry,
) *LedgerService {
	return &LedgerService{
		federationRepo: federationRepo,
		eventRepo:      eventRepo,
		membershipRepo: membershipRepo,
		hashSvc:        hashSvc,
		sigSvc:         sigSvc,
		policyRegistry: policyRegistry,
	}
}

func (s *LedgerService) SetOnAppended(hook EventAppendedHook) {
	s.onAppended = hook
}

type AppendEventInput struct {
	FederationID      string
	EventType         pb.EventType
	PayloadBytes      []byte
	ActorID           string
	ActorHandle       string
	StationPeerID     string
	ActorPrivateKey   ed25519.PrivateKey
	StationPrivateKey ed25519.PrivateKey
}

func (s *LedgerService) AppendEvent(ctx context.Context, input *AppendEventInput) (*pb.LedgerEvent, error) {
	fed, err := s.federationRepo.GetByID(ctx, input.FederationID)
	if err != nil {
		return nil, err
	}

	membership, err := s.membershipRepo.GetByStation(ctx, input.FederationID, input.StationPeerID)
	if err != nil {
		return nil, err
	}
	if membership == nil {
		return nil, policy.ErrNotActiveMember
	}

	p, ok := s.policyRegistry.Get(policy.Type(fed.PolicyType))
	if !ok {
		return nil, ErrPolicyNotSupported
	}

	memberAdapter := &membershipAdapter{record: membership}
	fedAdapter := &federationAdapter{record: fed}
	if err := p.ValidateAppend(ctx, fedAdapter, memberAdapter); err != nil {
		return nil, err
	}

	payloadHash, err := s.hashSvc.ComputePayloadHash(&pb.EventHashInput{PayloadHash: input.PayloadBytes})
	if err != nil {
		return nil, err
	}

	headEvent, err := s.eventRepo.GetHead(ctx, input.FederationID)
	if err != nil {
		return nil, err
	}
	var newSeq uint64
	var prevHash []byte
	if headEvent == nil {
		newSeq = 0
		prevHash = make([]byte, 32)
	} else {
		newSeq = headEvent.Seq + 1
		prevHash = headEvent.EventHash
	}

	eventHashInput := &pb.EventHashInput{
		FederationId:  input.FederationID,
		Seq:           newSeq,
		PrevHash:      prevHash,
		EventTypeName: input.EventType.String(),
		PayloadHash:   payloadHash,
	}
	eventHash, err := s.hashSvc.ComputeEventHash(eventHashInput)
	if err != nil {
		return nil, err
	}

	now := time.Now().UnixMilli()

	actorSigInput := &pb.ActorSignatureInput{
		FederationId:         input.FederationID,
		ActorId:              input.ActorID,
		ActorFederatedHandle: input.ActorHandle,
		EventTypeName:        input.EventType.String(),
		PayloadHash:          payloadHash,
		TimestampUnixMs:      now,
	}
	actorSig, err := s.sigSvc.SignActor(input.ActorPrivateKey, actorSigInput)
	if err != nil {
		return nil, err
	}

	stationSigInput := &pb.StationSignatureInput{
		FederationId:  input.FederationID,
		StationPeerId: input.StationPeerID,
		EventTypeName: input.EventType.String(),
		PayloadHash:   payloadHash,
		Seq:           newSeq,
		PrevHash:      prevHash,
		EventHash:     eventHash,
	}
	stationSig, err := s.sigSvc.SignStation(input.StationPrivateKey, stationSigInput)
	if err != nil {
		return nil, err
	}

	seqSigInput := &pb.SequencerSignatureInput{
		FederationId: input.FederationID,
		Seq:          newSeq,
		EventHash:    eventHash,
	}
	seqSig, err := s.sigSvc.SignSequencer(input.StationPrivateKey, seqSigInput)
	if err != nil {
		return nil, err
	}

	event := &pb.LedgerEvent{
		EventId:                generateEventID(),
		FederationId:           input.FederationID,
		Seq:                    newSeq,
		PrevHash:               prevHash,
		EventHash:              eventHash,
		EventType:              input.EventType,
		PayloadBytes:           input.PayloadBytes,
		PayloadHash:            payloadHash,
		ActorId:                input.ActorID,
		ActorFederatedHandle:   input.ActorHandle,
		StationPeerId:          input.StationPeerID,
		SequencerStationPeerId: fed.SequencerStationPeerID,
		ActorSignature:         actorSig,
		StationSignature:       stationSig,
		SequencerSignature:     seqSig,
		CreatedAtUnixMs:        now,
	}

	if err := s.eventRepo.Append(ctx, event); err != nil {
		return nil, err
	}

	if err := s.federationRepo.UpdateHead(ctx, input.FederationID, eventHash, newSeq); err != nil {
		return nil, err
	}

	if s.onAppended != nil {
		s.onAppended(ctx, event)
	}

	return event, nil
}

func generateEventID() string {
	return "evt_" + ulid.Make().String()
}

func (s *LedgerService) FetchEvents(ctx context.Context, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error) {
	return s.eventRepo.ListRange(ctx, federationID, fromSeq, limit)
}

func (s *LedgerService) ImportBootstrapEvents(
	ctx context.Context,
	federationID string,
	events []*pb.LedgerEvent,
) error {
	if err := s.ValidateBootstrapEvents(federationID, events); err != nil {
		return err
	}
	if head, err := s.eventRepo.GetHead(ctx, federationID); err != nil {
		return err
	} else if head != nil {
		last := events[len(events)-1]
		if head.Seq == last.Seq && bytes.Equal(head.EventHash, last.EventHash) {
			return nil
		}
		return fmt.Errorf("federation bootstrap conflicts with existing ledger")
	}
	for _, event := range events {
		if err := s.eventRepo.Append(ctx, event); err != nil {
			return err
		}
	}
	last := events[len(events)-1]
	return s.federationRepo.UpdateHead(
		ctx,
		federationID,
		last.EventHash,
		last.Seq,
	)
}

func (s *LedgerService) ValidateBootstrapEvents(
	federationID string,
	events []*pb.LedgerEvent,
) error {
	if federationID == "" || len(events) == 0 {
		return fmt.Errorf("federation bootstrap events are required")
	}
	prevHash := make([]byte, 32)
	for index, event := range events {
		if event == nil ||
			event.FederationId != federationID ||
			event.Seq != uint64(index) ||
			!bytes.Equal(event.PrevHash, prevHash) {
			return fmt.Errorf("federation bootstrap chain is discontinuous at index %d", index)
		}
		valid, err := s.hashSvc.VerifyEventHash(event, event.PayloadHash)
		if err != nil {
			return err
		}
		if !valid {
			return fmt.Errorf("federation bootstrap event hash is invalid at index %d", index)
		}
		prevHash = event.EventHash
	}
	return nil
}

type membershipAdapter struct{ record *domain.MembershipRecord }

func (a *membershipAdapter) GetStationPeerID() string { return a.record.StationPeerID }
func (a *membershipAdapter) GetRole() string          { return a.record.Role }
func (a *membershipAdapter) GetStatus() string        { return a.record.Status }

type federationAdapter struct{ record *domain.FederationRecord }

func (a *federationAdapter) GetSequencerStationPeerID() string {
	return a.record.SequencerStationPeerID
}
func (a *federationAdapter) GetPolicyType() policy.Type { return policy.Type(a.record.PolicyType) }
