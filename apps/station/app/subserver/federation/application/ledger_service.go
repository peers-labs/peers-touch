package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/subtle"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"google.golang.org/protobuf/proto"
)

type EventAppendedHook func(ctx context.Context, event *pb.LedgerEvent)

type LedgerService struct {
	federationRepo domain.FederationRepository
	eventRepo      domain.LedgerEventRepository
	eventCommitter domain.LedgerEventCommitter
	membershipRepo domain.MembershipRepository
	stationKeys    domain.StationSigningKeyProvider
	hashSvc        *domain.HashService
	sigSvc         *domain.SignatureService
	policyRegistry *policy.Registry
	onAppended     EventAppendedHook
}

func NewLedgerService(
	federationRepo domain.FederationRepository,
	eventRepo domain.LedgerEventRepository,
	eventCommitter domain.LedgerEventCommitter,
	membershipRepo domain.MembershipRepository,
	stationKeys domain.StationSigningKeyProvider,
	hashSvc *domain.HashService,
	sigSvc *domain.SignatureService,
	policyRegistry *policy.Registry,
) *LedgerService {
	return &LedgerService{
		federationRepo: federationRepo,
		eventRepo:      eventRepo,
		eventCommitter: eventCommitter,
		membershipRepo: membershipRepo,
		stationKeys:    stationKeys,
		hashSvc:        hashSvc,
		sigSvc:         sigSvc,
		policyRegistry: policyRegistry,
	}
}

func (s *LedgerService) SetOnAppended(hook EventAppendedHook) {
	s.onAppended = hook
}

type AppendEventInput struct {
	FederationID         string
	EventType            pb.EventType
	PayloadBytes         []byte
	ActorPTID            string
	ActorFederatedHandle string
	StationPeerID        string
	ActorPrivateKey      ed25519.PrivateKey
}

func (s *LedgerService) AppendEvent(ctx context.Context, input *AppendEventInput) (*pb.LedgerEvent, error) {
	return s.appendEvent(ctx, input, domain.LedgerProjectionMutation{})
}

func (s *LedgerService) AppendEventWithProjection(
	ctx context.Context,
	input *AppendEventInput,
	mutation domain.LedgerProjectionMutation,
) (*pb.LedgerEvent, error) {
	return s.appendEvent(ctx, input, mutation)
}

func (s *LedgerService) appendEvent(
	ctx context.Context,
	input *AppendEventInput,
	mutation domain.LedgerProjectionMutation,
) (*pb.LedgerEvent, error) {
	fed, err := s.federationRepo.GetByID(ctx, input.FederationID)
	if err != nil {
		return nil, err
	}
	if fed == nil {
		return nil, fmt.Errorf("federation not found")
	}
	if fed.Status != "active" {
		return nil, fmt.Errorf(
			"federation is not active: %s",
			fed.Status,
		)
	}
	if s.stationKeys == nil {
		return nil, fmt.Errorf("Station signing key provider is unavailable")
	}
	stationKey, err := s.stationKeys.Current(ctx)
	if err != nil {
		return nil, fmt.Errorf("load Station signing key: %w", err)
	}
	if stationKey == nil ||
		len(stationKey.PublicKey) != ed25519.PublicKeySize ||
		len(stationKey.PrivateKey) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("Station signing key is incomplete")
	}
	if input.EventType != pb.EventType_FEDERATION_CREATED {
		genesisEvent, err := s.eventRepo.GetBySeq(
			ctx,
			input.FederationID,
			0,
		)
		if err != nil {
			return nil, err
		}
		genesis, _, pinnedStationPublicKey, err := validatedGenesisTrust(
			input.FederationID,
			genesisEvent,
			nil,
		)
		if err != nil {
			return nil, err
		}
		if genesis.SequencerStationPeerId == input.StationPeerID &&
			subtle.ConstantTimeCompare(
				pinnedStationPublicKey,
				stationKey.PublicKey,
			) != 1 {
			return nil, fmt.Errorf(
				"Station signing key rotation requires a Federation ledger key-rotation event",
			)
		}
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
		ActorPtid:            input.ActorPTID,
		ActorFederatedHandle: input.ActorFederatedHandle,
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
	stationSig, err := s.sigSvc.SignStation(
		stationKey.PrivateKey,
		stationSigInput,
	)
	if err != nil {
		return nil, err
	}

	seqSigInput := &pb.SequencerSignatureInput{
		FederationId: input.FederationID,
		Seq:          newSeq,
		EventHash:    eventHash,
	}
	seqSig, err := s.sigSvc.SignSequencer(
		stationKey.PrivateKey,
		seqSigInput,
	)
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
		ActorPtid:              input.ActorPTID,
		ActorFederatedHandle:   input.ActorFederatedHandle,
		StationPeerId:          input.StationPeerID,
		SequencerStationPeerId: fed.SequencerStationPeerID,
		ActorSignature:         actorSig,
		StationSignature:       stationSig,
		SequencerSignature:     seqSig,
		CreatedAtUnixMs:        now,
	}

	if s.eventCommitter == nil {
		return nil, fmt.Errorf("ledger event committer is unavailable")
	}
	if err := s.eventCommitter.Commit(ctx, event, mutation); err != nil {
		return nil, err
	}

	if s.onAppended != nil {
		s.onAppended(ctx, event)
	}

	return event, nil
}

func (s *LedgerService) CommitRemoteEvent(
	ctx context.Context,
	event *pb.LedgerEvent,
	mutation domain.LedgerProjectionMutation,
) error {
	if s.eventCommitter == nil {
		return fmt.Errorf("ledger event committer is unavailable")
	}
	return s.eventCommitter.Commit(ctx, event, mutation)
}

func ProjectionMutationForEvent(
	event *pb.LedgerEvent,
) (domain.LedgerProjectionMutation, error) {
	if event == nil {
		return domain.LedgerProjectionMutation{}, fmt.Errorf(
			"Federation event is required",
		)
	}
	switch event.EventType {
	case pb.EventType_STATION_JOIN_APPROVED:
		payload := &pb.StationJoinApprovedPayload{}
		if err := proto.Unmarshal(event.PayloadBytes, payload); err != nil {
			return domain.LedgerProjectionMutation{}, err
		}
		if payload.ApprovedStationPeerId == "" ||
			payload.ApprovedStationName == "" ||
			payload.ApprovedStationUrl == "" {
			return domain.LedgerProjectionMutation{}, fmt.Errorf(
				"Federation join projection is incomplete",
			)
		}
		role := payload.Role
		if role == "" {
			role = "member_station"
		}
		return domain.LedgerProjectionMutation{
			Membership: &domain.MembershipRecord{
				FederationID:      event.FederationId,
				StationPeerID:     payload.ApprovedStationPeerId,
				StationName:       payload.ApprovedStationName,
				StationURL:        payload.ApprovedStationUrl,
				Role:              role,
				Status:            "active",
				ApprovedByEventID: event.EventId,
			},
		}, nil
	case pb.EventType_STATION_LEFT:
		payload := &pb.StationLeftPayload{}
		if err := proto.Unmarshal(event.PayloadBytes, payload); err != nil {
			return domain.LedgerProjectionMutation{}, err
		}
		if payload.LeavingStationPeerId == "" {
			return domain.LedgerProjectionMutation{}, fmt.Errorf(
				"Federation leave projection is incomplete",
			)
		}
		return domain.LedgerProjectionMutation{
			MembershipStationPeerID: payload.LeavingStationPeerId,
			MembershipStatus:        "left",
		}, nil
	case pb.EventType_STATION_SUSPENDED:
		payload := &pb.StationSuspendedPayload{}
		if err := proto.Unmarshal(event.PayloadBytes, payload); err != nil {
			return domain.LedgerProjectionMutation{}, err
		}
		if payload.TargetStationPeerId == "" {
			return domain.LedgerProjectionMutation{}, fmt.Errorf(
				"Federation suspension projection is incomplete",
			)
		}
		return domain.LedgerProjectionMutation{
			MembershipStationPeerID: payload.TargetStationPeerId,
			MembershipStatus:        "suspended",
		}, nil
	case pb.EventType_STATION_REMOVED:
		payload := &pb.StationRemovedPayload{}
		if err := proto.Unmarshal(event.PayloadBytes, payload); err != nil {
			return domain.LedgerProjectionMutation{}, err
		}
		if payload.TargetStationPeerId == "" {
			return domain.LedgerProjectionMutation{}, fmt.Errorf(
				"Federation removal projection is incomplete",
			)
		}
		return domain.LedgerProjectionMutation{
			MembershipStationPeerID: payload.TargetStationPeerId,
			MembershipStatus:        "removed",
		}, nil
	case pb.EventType_FEDERATION_ARCHIVED:
		payload := &pb.FederationArchivedPayload{}
		if err := proto.Unmarshal(event.PayloadBytes, payload); err != nil {
			return domain.LedgerProjectionMutation{}, err
		}
		if payload.ArchivedByActorPtid == "" {
			return domain.LedgerProjectionMutation{}, fmt.Errorf(
				"Federation archive projection is incomplete",
			)
		}
		return domain.LedgerProjectionMutation{
			FederationStatus: "archived",
		}, nil
	default:
		return domain.LedgerProjectionMutation{}, nil
	}
}

func generateEventID() string {
	return "evt_" + ulid.Make().String()
}

func (s *LedgerService) FetchEvents(ctx context.Context, federationID string, fromSeq uint64, limit uint32) ([]*pb.LedgerEvent, error) {
	return s.eventRepo.ListRange(ctx, federationID, fromSeq, limit)
}

func (s *LedgerService) FetchAllEvents(
	ctx context.Context,
	federationID string,
) ([]*pb.LedgerEvent, error) {
	return s.eventRepo.ListAll(ctx, federationID)
}

func (s *LedgerService) HasExactEvent(
	ctx context.Context,
	event *pb.LedgerEvent,
) (bool, error) {
	if event == nil {
		return false, nil
	}
	stored, err := s.eventRepo.GetBySeq(
		ctx,
		event.FederationId,
		event.Seq,
	)
	if err != nil || stored == nil {
		return false, err
	}
	return bytes.Equal(stored.EventHash, event.EventHash), nil
}

func (s *LedgerService) ImportBootstrapEvents(
	ctx context.Context,
	federationID string,
	events []*pb.LedgerEvent,
) error {
	if err := s.ValidateBootstrapEvents(federationID, events); err != nil {
		return err
	}
	start := 0
	if head, err := s.eventRepo.GetHead(ctx, federationID); err != nil {
		return err
	} else if head != nil {
		if head.Seq >= uint64(len(events)) {
			return fmt.Errorf("federation bootstrap is behind the existing ledger")
		}
		matching := events[head.Seq]
		if !bytes.Equal(head.EventHash, matching.EventHash) {
			return fmt.Errorf("federation bootstrap conflicts with existing ledger")
		}
		if head.Seq == uint64(len(events)-1) {
			return nil
		}
		start = int(head.Seq) + 1
	}
	for _, event := range events[start:] {
		mutation, err := ProjectionMutationForEvent(event)
		if err != nil {
			return err
		}
		if s.eventCommitter == nil {
			return fmt.Errorf("ledger event committer is unavailable")
		}
		if err := s.eventCommitter.Commit(
			ctx,
			event,
			mutation,
		); err != nil {
			return err
		}
		if s.onAppended != nil {
			s.onAppended(ctx, event)
		}
	}
	return nil
}

func (s *LedgerService) ValidateBootstrapEvents(
	federationID string,
	events []*pb.LedgerEvent,
) error {
	return s.validateBootstrapEvents(federationID, nil, events)
}

func (s *LedgerService) ValidateBootstrapEventsFromSequencer(
	federationID string,
	expectedSequencerPublicKey []byte,
	events []*pb.LedgerEvent,
) error {
	if len(expectedSequencerPublicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("expected sequencer public key is invalid")
	}
	return s.validateBootstrapEvents(
		federationID,
		expectedSequencerPublicKey,
		events,
	)
}

func (s *LedgerService) validateBootstrapEvents(
	federationID string,
	expectedSequencerPublicKey []byte,
	events []*pb.LedgerEvent,
) error {
	if federationID == "" || len(events) == 0 {
		return fmt.Errorf("federation bootstrap events are required")
	}
	genesis, actorPublicKey, stationPublicKey, err := validatedGenesisTrust(
		federationID,
		events[0],
		expectedSequencerPublicKey,
	)
	if err != nil {
		return err
	}
	prevHash := make([]byte, 32)
	for index, event := range events {
		if event == nil ||
			event.FederationId != federationID ||
			event.Seq != uint64(index) ||
			!bytes.Equal(event.PrevHash, prevHash) ||
			event.SequencerStationPeerId !=
				genesis.SequencerStationPeerId ||
			event.StationPeerId != genesis.SequencerStationPeerId {
			return fmt.Errorf("federation bootstrap chain is discontinuous at index %d", index)
		}
		if err := s.validateRemoteEventWithKey(
			event,
			actorPublicKey,
			stationPublicKey,
		); err != nil {
			return fmt.Errorf(
				"federation bootstrap event %d is invalid: %w",
				index,
				err,
			)
		}
		prevHash = event.EventHash
	}
	return nil
}

func (s *LedgerService) ValidateRemoteEvent(
	ctx context.Context,
	event *pb.LedgerEvent,
) error {
	if event == nil {
		return fmt.Errorf("remote Federation event is required")
	}
	genesisEvent, err := s.eventRepo.GetBySeq(
		ctx,
		event.FederationId,
		0,
	)
	if err != nil {
		return err
	}
	genesis, actorPublicKey, stationPublicKey, err := validatedGenesisTrust(
		event.FederationId,
		genesisEvent,
		nil,
	)
	if err != nil {
		return err
	}
	if event.SequencerStationPeerId != genesis.SequencerStationPeerId ||
		event.StationPeerId != genesis.SequencerStationPeerId {
		return fmt.Errorf("remote Federation event sequencer identity mismatch")
	}
	return s.validateRemoteEventWithKey(
		event,
		actorPublicKey,
		stationPublicKey,
	)
}

func validatedGenesisTrust(
	federationID string,
	event *pb.LedgerEvent,
	expectedStationPublicKey []byte,
) (
	*pb.FederationCreatedPayload,
	ed25519.PublicKey,
	ed25519.PublicKey,
	error,
) {
	if event == nil ||
		event.FederationId != federationID ||
		event.Seq != 0 ||
		event.EventType != pb.EventType_FEDERATION_CREATED {
		return nil, nil, nil, fmt.Errorf(
			"Federation ledger must start with genesis",
		)
	}
	genesis := &pb.FederationCreatedPayload{}
	if err := proto.Unmarshal(event.PayloadBytes, genesis); err != nil {
		return nil, nil, nil, fmt.Errorf(
			"decode Federation genesis: %w",
			err,
		)
	}
	if genesis.FederationId != federationID ||
		genesis.SequencerStationPeerId == "" ||
		genesis.CreatorStationPeerId != genesis.SequencerStationPeerId ||
		len(genesis.CreatorStationPublicKey) != ed25519.PublicKeySize ||
		len(genesis.CreatorActorSigningPublicKey) != ed25519.PublicKeySize {
		return nil, nil, nil, fmt.Errorf(
			"Federation genesis trust identity is incomplete",
		)
	}
	if len(expectedStationPublicKey) != 0 &&
		subtle.ConstantTimeCompare(
			genesis.CreatorStationPublicKey,
			expectedStationPublicKey,
		) != 1 {
		return nil, nil, nil, fmt.Errorf(
			"Federation genesis Station signing key does not match signed Station identity",
		)
	}
	return genesis,
		ed25519.PublicKey(
			append([]byte(nil), genesis.CreatorActorSigningPublicKey...),
		),
		ed25519.PublicKey(
			append([]byte(nil), genesis.CreatorStationPublicKey...),
		),
		nil
}

func (s *LedgerService) validateRemoteEventWithKey(
	event *pb.LedgerEvent,
	actorPublicKey ed25519.PublicKey,
	stationPublicKey ed25519.PublicKey,
) error {
	payloadHash, err := s.hashSvc.ComputePayloadHash(
		&pb.EventHashInput{PayloadHash: event.PayloadBytes},
	)
	if err != nil {
		return err
	}
	if subtle.ConstantTimeCompare(payloadHash, event.PayloadHash) != 1 {
		return fmt.Errorf("payload hash mismatch")
	}
	valid, err := s.hashSvc.VerifyEventHash(event, payloadHash)
	if err != nil {
		return err
	}
	if !valid {
		return fmt.Errorf("event hash mismatch")
	}
	if err := s.sigSvc.VerifyActor(
		actorPublicKey,
		&pb.ActorSignatureInput{
			FederationId:         event.FederationId,
			ActorPtid:            event.ActorPtid,
			ActorFederatedHandle: event.ActorFederatedHandle,
			EventTypeName:        event.EventType.String(),
			PayloadHash:          payloadHash,
			TimestampUnixMs:      event.CreatedAtUnixMs,
		},
		event.ActorSignature,
	); err != nil {
		return err
	}
	if err := s.sigSvc.VerifyStation(
		stationPublicKey,
		&pb.StationSignatureInput{
			FederationId:  event.FederationId,
			StationPeerId: event.StationPeerId,
			EventTypeName: event.EventType.String(),
			PayloadHash:   payloadHash,
			Seq:           event.Seq,
			PrevHash:      event.PrevHash,
			EventHash:     event.EventHash,
		},
		event.StationSignature,
	); err != nil {
		return err
	}
	return s.sigSvc.VerifySequencer(
		stationPublicKey,
		&pb.SequencerSignatureInput{
			FederationId: event.FederationId,
			Seq:          event.Seq,
			EventHash:    event.EventHash,
		},
		event.SequencerSignature,
	)
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
