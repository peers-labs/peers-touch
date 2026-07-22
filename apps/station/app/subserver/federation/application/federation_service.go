package application

import (
	"context"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"github.com/oklog/ulid/v2"
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

var _ = ulid.Make
