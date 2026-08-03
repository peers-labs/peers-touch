package application

import (
	"context"
	"crypto/ed25519"
	"fmt"

	"github.com/oklog/ulid/v2"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"google.golang.org/protobuf/proto"
)

type FederationService struct {
	federationRepo domain.FederationRepository
	membershipRepo domain.MembershipRepository
	actorRoleRepo  domain.ActorRoleRepository
	ledgerSvc      *LedgerService
	actorKeySvc    *domain.ActorKeyService
	replaySvc      *domain.ReplayService
}

func NewFederationService(
	federationRepo domain.FederationRepository,
	membershipRepo domain.MembershipRepository,
	actorRoleRepo domain.ActorRoleRepository,
	ledgerSvc *LedgerService,
	actorKeySvc *domain.ActorKeyService,
	replaySvc *domain.ReplayService,
) *FederationService {
	return &FederationService{
		federationRepo: federationRepo,
		membershipRepo: membershipRepo,
		actorRoleRepo:  actorRoleRepo,
		ledgerSvc:      ledgerSvc,
		actorKeySvc:    actorKeySvc,
		replaySvc:      replaySvc,
	}
}

type CreateFederationInput struct {
	Name          string
	Description   string
	PolicyType    string
	ActorID       string
	ActorHandle   string
	StationPeerID string
	StationName   string
	StationURL    string
}

func (s *FederationService) CreateFederation(ctx context.Context, input *CreateFederationInput) (*domain.FederationRecord, error) {
	federationID := "fed_" + ulid.Make().String()

	actorPub, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, input.ActorID)
	if err != nil {
		existingPub, keyErr := s.actorKeySvc.GetPublicKey(ctx, input.ActorID)
		if keyErr != nil {
			return nil, err
		}
		actorPub = existingPub
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, input.ActorID)
		if err != nil {
			return nil, err
		}
	}

	payload := &pb.FederationCreatedPayload{
		FederationId:                 federationID,
		Name:                         input.Name,
		Description:                  input.Description,
		PolicyType:                   input.PolicyType,
		SequencerStationPeerId:       input.StationPeerID,
		CreatorActorId:               input.ActorID,
		CreatorActorFederatedHandle:  input.ActorHandle,
		CreatorStationPeerId:         input.StationPeerID,
		CreatorStationName:           input.StationName,
		CreatorStationUrl:            input.StationURL,
		CreatorActorSigningPublicKey: actorPub,
	}

	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return nil, err
	}

	record := &domain.FederationRecord{
		FederationID:           federationID,
		Name:                   input.Name,
		Description:            input.Description,
		Status:                 "active",
		PolicyType:             input.PolicyType,
		SequencerStationPeerID: input.StationPeerID,
		GenesisHash:            make([]byte, 32),
		HeadHash:               make([]byte, 32),
		HeadSeq:                0,
		CreatedByActorID:       input.ActorID,
		CreatedByStationPeerID: input.StationPeerID,
	}

	if err := s.federationRepo.Create(ctx, record); err != nil {
		return nil, err
	}

	membership := &domain.MembershipRecord{
		FederationID:  federationID,
		StationPeerID: input.StationPeerID,
		StationName:   input.StationName,
		StationURL:    input.StationURL,
		Role:          "founder",
		Status:        "active",
	}
	if err := s.membershipRepo.Upsert(ctx, membership); err != nil {
		return nil, err
	}

	actorRole := &domain.ActorRoleRecord{
		FederationID:         federationID,
		ActorID:              input.ActorID,
		ActorFederatedHandle: input.ActorHandle,
		StationPeerID:        input.StationPeerID,
		Role:                 "federation_owner",
	}
	if err := s.actorRoleRepo.Upsert(ctx, actorRole); err != nil {
		return nil, err
	}

	// Use a stub station private key for genesis (sequencer = self)
	stationPriv := actorPriv // v1: same station creates genesis

	_, err = s.ledgerSvc.AppendEvent(ctx, &AppendEventInput{
		FederationID:      federationID,
		EventType:         pb.EventType_FEDERATION_CREATED,
		PayloadBytes:      payloadBytes,
		ActorID:           input.ActorID,
		ActorHandle:       input.ActorHandle,
		StationPeerID:     input.StationPeerID,
		ActorPrivateKey:   actorPriv,
		StationPrivateKey: stationPriv,
	})
	if err != nil {
		return nil, err
	}

	updated, err := s.federationRepo.GetByID(ctx, federationID)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *FederationService) Replay(ctx context.Context, federationID string) (*domain.MaterializedState, error) {
	return s.replaySvc.ReplayFromGenesis(ctx, federationID)
}

func (s *FederationService) GetFederation(ctx context.Context, federationID string) (*domain.FederationRecord, error) {
	return s.federationRepo.GetByID(ctx, federationID)
}

type BootstrapFederationReplicaInput struct {
	FederationID       string
	LocalActorID       string
	LocalStationPeerID string
	Events             []*pb.LedgerEvent
}

func (s *FederationService) BootstrapReplica(
	ctx context.Context,
	input *BootstrapFederationReplicaInput,
) error {
	if input == nil ||
		input.FederationID == "" ||
		input.LocalActorID == "" ||
		input.LocalStationPeerID == "" ||
		len(input.Events) == 0 {
		return fmt.Errorf("federation bootstrap input is incomplete")
	}
	if err := s.ledgerSvc.ValidateBootstrapEvents(
		input.FederationID,
		input.Events,
	); err != nil {
		return err
	}
	genesisEvent := input.Events[0]
	if genesisEvent == nil ||
		genesisEvent.Seq != 0 ||
		genesisEvent.EventType != pb.EventType_FEDERATION_CREATED {
		return fmt.Errorf("federation bootstrap must start with genesis")
	}
	genesis := &pb.FederationCreatedPayload{}
	if err := proto.Unmarshal(genesisEvent.PayloadBytes, genesis); err != nil {
		return fmt.Errorf("decode federation genesis: %w", err)
	}
	if genesis.FederationId != input.FederationID ||
		genesis.SequencerStationPeerId == "" ||
		genesis.CreatorStationPeerId == "" ||
		genesis.CreatorStationUrl == "" {
		return fmt.Errorf("federation genesis routing is incomplete")
	}

	memberships := []*domain.MembershipRecord{{
		FederationID:  input.FederationID,
		StationPeerID: genesis.CreatorStationPeerId,
		StationName:   genesis.CreatorStationName,
		StationURL:    genesis.CreatorStationUrl,
		Role:          "founder",
		Status:        "active",
	}}
	localApproved := genesis.CreatorStationPeerId == input.LocalStationPeerID
	for _, event := range input.Events[1:] {
		if event.EventType != pb.EventType_STATION_JOIN_APPROVED {
			continue
		}
		joined := &pb.StationJoinApprovedPayload{}
		if err := proto.Unmarshal(event.PayloadBytes, joined); err != nil {
			return fmt.Errorf("decode Federation join event: %w", err)
		}
		if joined.ApprovedStationPeerId == "" ||
			joined.ApprovedStationUrl == "" ||
			joined.ApprovedStationName == "" {
			return fmt.Errorf("Federation join event routing is incomplete")
		}
		memberships = append(memberships, &domain.MembershipRecord{
			FederationID:      input.FederationID,
			StationPeerID:     joined.ApprovedStationPeerId,
			StationName:       joined.ApprovedStationName,
			StationURL:        joined.ApprovedStationUrl,
			Role:              joined.Role,
			Status:            "active",
			ApprovedByEventID: event.EventId,
		})
		if joined.ApprovedStationPeerId == input.LocalStationPeerID {
			localApproved = true
		}
	}
	if !localApproved {
		return fmt.Errorf("local Station is not approved by the bootstrap ledger")
	}

	existing, err := s.federationRepo.GetByID(ctx, input.FederationID)
	if err != nil {
		return err
	}
	if existing == nil {
		if err := s.federationRepo.Create(ctx, &domain.FederationRecord{
			FederationID:           input.FederationID,
			Name:                   genesis.Name,
			Description:            genesis.Description,
			Status:                 "active",
			PolicyType:             genesis.PolicyType,
			SequencerStationPeerID: genesis.SequencerStationPeerId,
			GenesisHash:            genesisEvent.EventHash,
			HeadHash:               make([]byte, 32),
			HeadSeq:                0,
			CreatedByActorID:       genesis.CreatorActorId,
			CreatedByStationPeerID: genesis.CreatorStationPeerId,
		}); err != nil {
			return err
		}
	} else if existing.SequencerStationPeerID != genesis.SequencerStationPeerId {
		return fmt.Errorf("federation bootstrap conflicts with local sequencer")
	}
	if err := s.ledgerSvc.ImportBootstrapEvents(
		ctx,
		input.FederationID,
		input.Events,
	); err != nil {
		return err
	}
	for _, membership := range memberships {
		if err := s.membershipRepo.Upsert(ctx, membership); err != nil {
			return err
		}
	}
	return s.actorRoleRepo.Upsert(ctx, &domain.ActorRoleRecord{
		FederationID:         input.FederationID,
		ActorID:              input.LocalActorID,
		ActorFederatedHandle: input.LocalActorID,
		StationPeerID:        input.LocalStationPeerID,
		Role:                 "federation_member",
	})
}

type ApproveJoinInput struct {
	FederationID          string
	JoiningStationPeerID  string
	JoiningStationName    string
	JoiningStationURL     string
	ApproverActorID       string
	ApproverActorHandle   string
	ApproverStationPeerID string
	ActorPrivateKey       ed25519.PrivateKey
	StationPrivateKey     ed25519.PrivateKey
}

func (s *FederationService) ApproveJoin(ctx context.Context, input *ApproveJoinInput) (*domain.MembershipRecord, error) {
	payload := &pb.StationJoinApprovedPayload{
		ApprovedStationPeerId:          input.JoiningStationPeerID,
		ApprovedByActorId:              input.ApproverActorID,
		ApprovedByActorFederatedHandle: input.ApproverActorHandle,
		Role:                           "member_station",
		ApprovedStationUrl:             input.JoiningStationURL,
		ApprovedStationName:            input.JoiningStationName,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return nil, err
	}

	event, err := s.ledgerSvc.AppendEvent(ctx, &AppendEventInput{
		FederationID:      input.FederationID,
		EventType:         pb.EventType_STATION_JOIN_APPROVED,
		PayloadBytes:      payloadBytes,
		ActorID:           input.ApproverActorID,
		ActorHandle:       input.ApproverActorHandle,
		StationPeerID:     input.ApproverStationPeerID,
		ActorPrivateKey:   input.ActorPrivateKey,
		StationPrivateKey: input.StationPrivateKey,
	})
	if err != nil {
		return nil, err
	}

	membership := &domain.MembershipRecord{
		FederationID:      input.FederationID,
		StationPeerID:     input.JoiningStationPeerID,
		StationName:       input.JoiningStationName,
		StationURL:        input.JoiningStationURL,
		Role:              "member_station",
		Status:            "active",
		ApprovedByEventID: event.EventId,
	}
	if err := s.membershipRepo.Upsert(ctx, membership); err != nil {
		return nil, err
	}

	return membership, nil
}

type LeaveFederationInput struct {
	FederationID      string
	ActorID           string
	ActorHandle       string
	StationPeerID     string
	Reason            string
	ActorPrivateKey   ed25519.PrivateKey
	StationPrivateKey ed25519.PrivateKey
}

func (s *FederationService) LeaveFederation(ctx context.Context, input *LeaveFederationInput) error {
	payload := &pb.StationLeftPayload{
		LeavingStationPeerId:        input.StationPeerID,
		LeavingActorId:              input.ActorID,
		LeavingActorFederatedHandle: input.ActorHandle,
		Reason:                      input.Reason,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return err
	}

	_, err = s.ledgerSvc.AppendEvent(ctx, &AppendEventInput{
		FederationID:      input.FederationID,
		EventType:         pb.EventType_STATION_LEFT,
		PayloadBytes:      payloadBytes,
		ActorID:           input.ActorID,
		ActorHandle:       input.ActorHandle,
		StationPeerID:     input.StationPeerID,
		ActorPrivateKey:   input.ActorPrivateKey,
		StationPrivateKey: input.StationPrivateKey,
	})
	if err != nil {
		return err
	}

	membership, err := s.membershipRepo.GetByStation(ctx, input.FederationID, input.StationPeerID)
	if err != nil {
		return err
	}
	if membership != nil {
		membership.Status = "left"
		return s.membershipRepo.Upsert(ctx, membership)
	}
	return nil
}

type DeleteFederationInput struct {
	FederationID      string
	ActorID           string
	ActorHandle       string
	StationPeerID     string
	ActorPrivateKey   ed25519.PrivateKey
	StationPrivateKey ed25519.PrivateKey
}

func (s *FederationService) DeleteFederation(ctx context.Context, input *DeleteFederationInput) error {
	payload := &pb.FederationArchivedPayload{
		ArchivedByActorId:              input.ActorID,
		ArchivedByActorFederatedHandle: input.ActorHandle,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return err
	}

	_, err = s.ledgerSvc.AppendEvent(ctx, &AppendEventInput{
		FederationID:      input.FederationID,
		EventType:         pb.EventType_FEDERATION_ARCHIVED,
		PayloadBytes:      payloadBytes,
		ActorID:           input.ActorID,
		ActorHandle:       input.ActorHandle,
		StationPeerID:     input.StationPeerID,
		ActorPrivateKey:   input.ActorPrivateKey,
		StationPrivateKey: input.StationPrivateKey,
	})
	if err != nil {
		return err
	}

	return s.federationRepo.UpdateStatus(ctx, input.FederationID, "archived")
}

var _ = ulid.Make
