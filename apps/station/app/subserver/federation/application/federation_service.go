package application

import (
	"context"
	"crypto/ed25519"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/internal/identity"
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
	stationKeys    domain.StationSigningKeyProvider
	replaySvc      *domain.ReplayService
}

func NewFederationService(
	federationRepo domain.FederationRepository,
	membershipRepo domain.MembershipRepository,
	actorRoleRepo domain.ActorRoleRepository,
	ledgerSvc *LedgerService,
	actorKeySvc *domain.ActorKeyService,
	stationKeys domain.StationSigningKeyProvider,
	replaySvc *domain.ReplayService,
) *FederationService {
	return &FederationService{
		federationRepo: federationRepo,
		membershipRepo: membershipRepo,
		actorRoleRepo:  actorRoleRepo,
		ledgerSvc:      ledgerSvc,
		actorKeySvc:    actorKeySvc,
		stationKeys:    stationKeys,
		replaySvc:      replaySvc,
	}
}

type CreateFederationInput struct {
	Name                 string
	Description          string
	PolicyType           string
	ActorPTID            string
	ActorFederatedHandle string
	StationPeerID        string
	StationName          string
	StationURL           string
}

func (s *FederationService) CreateFederation(ctx context.Context, input *CreateFederationInput) (*domain.FederationRecord, error) {
	federationID := identity.NewFederationID()

	actorPub, actorPriv, err := s.actorKeySvc.GenerateKeyPair(ctx, input.ActorPTID)
	if err != nil {
		existingPub, keyErr := s.actorKeySvc.GetPublicKey(ctx, input.ActorPTID)
		if keyErr != nil {
			return nil, err
		}
		actorPub = existingPub
		actorPriv, err = s.actorKeySvc.GetPrivateKey(ctx, input.ActorPTID)
		if err != nil {
			return nil, err
		}
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

	payload := &pb.FederationCreatedPayload{
		FederationId:                 federationID,
		Name:                         input.Name,
		Description:                  input.Description,
		PolicyType:                   input.PolicyType,
		SequencerStationPeerId:       input.StationPeerID,
		CreatorActorPtid:             input.ActorPTID,
		CreatorActorFederatedHandle:  input.ActorFederatedHandle,
		CreatorStationPeerId:         input.StationPeerID,
		CreatorStationPublicKey:      stationKey.PublicKey,
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
		CreatedByActorPTID:     input.ActorPTID,
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
		ActorPTID:            input.ActorPTID,
		ActorFederatedHandle: input.ActorFederatedHandle,
		StationPeerID:        input.StationPeerID,
		Role:                 "federation_owner",
	}
	if err := s.actorRoleRepo.Upsert(ctx, actorRole); err != nil {
		return nil, err
	}

	_, err = s.ledgerSvc.AppendEvent(ctx, &AppendEventInput{
		FederationID:         federationID,
		EventType:            pb.EventType_FEDERATION_CREATED,
		PayloadBytes:         payloadBytes,
		ActorPTID:            input.ActorPTID,
		ActorFederatedHandle: input.ActorFederatedHandle,
		StationPeerID:        input.StationPeerID,
		ActorPrivateKey:      actorPriv,
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
	FederationID                      string
	LocalActorPTID                    string
	LocalStationPeerID                string
	ExpectedSequencerStationPeerID    string
	ExpectedSequencerStationPublicKey []byte
	Events                            []*pb.LedgerEvent
}

func (s *FederationService) BootstrapReplica(
	ctx context.Context,
	input *BootstrapFederationReplicaInput,
) error {
	if input == nil ||
		input.FederationID == "" ||
		input.LocalActorPTID == "" ||
		input.LocalStationPeerID == "" ||
		input.ExpectedSequencerStationPeerID == "" ||
		len(input.ExpectedSequencerStationPublicKey) !=
			ed25519.PublicKeySize ||
		len(input.Events) == 0 {
		return fmt.Errorf("federation bootstrap input is incomplete")
	}
	if err := s.ledgerSvc.ValidateBootstrapEventsFromSequencer(
		input.FederationID,
		input.ExpectedSequencerStationPublicKey,
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
		genesis.SequencerStationPeerId !=
			input.ExpectedSequencerStationPeerID ||
		genesis.CreatorStationPeerId == "" ||
		genesis.CreatorStationUrl == "" {
		return fmt.Errorf("federation genesis routing is incomplete")
	}

	memberships := map[string]*domain.MembershipRecord{
		genesis.CreatorStationPeerId: {
			FederationID:  input.FederationID,
			StationPeerID: genesis.CreatorStationPeerId,
			StationName:   genesis.CreatorStationName,
			StationURL:    genesis.CreatorStationUrl,
			Role:          "founder",
			Status:        "active",
		},
	}
	for _, event := range input.Events[1:] {
		switch event.EventType {
		case pb.EventType_STATION_JOIN_APPROVED:
			joined := &pb.StationJoinApprovedPayload{}
			if err := proto.Unmarshal(event.PayloadBytes, joined); err != nil {
				return fmt.Errorf("decode Federation join event: %w", err)
			}
			if joined.ApprovedStationPeerId == "" ||
				joined.ApprovedStationUrl == "" ||
				joined.ApprovedStationName == "" {
				return fmt.Errorf("Federation join event routing is incomplete")
			}
			memberships[joined.ApprovedStationPeerId] = &domain.MembershipRecord{
				FederationID:      input.FederationID,
				StationPeerID:     joined.ApprovedStationPeerId,
				StationName:       joined.ApprovedStationName,
				StationURL:        joined.ApprovedStationUrl,
				Role:              joined.Role,
				Status:            "active",
				ApprovedByEventID: event.EventId,
			}
		case pb.EventType_STATION_LEFT:
			left := &pb.StationLeftPayload{}
			if err := proto.Unmarshal(event.PayloadBytes, left); err != nil {
				return fmt.Errorf("decode Federation leave event: %w", err)
			}
			member := memberships[left.LeavingStationPeerId]
			if member == nil {
				return fmt.Errorf("Federation leave targets an unknown Station")
			}
			member.Status = "left"
		case pb.EventType_STATION_SUSPENDED:
			suspended := &pb.StationSuspendedPayload{}
			if err := proto.Unmarshal(event.PayloadBytes, suspended); err != nil {
				return fmt.Errorf("decode Federation suspension event: %w", err)
			}
			member := memberships[suspended.TargetStationPeerId]
			if member == nil {
				return fmt.Errorf("Federation suspension targets an unknown Station")
			}
			member.Status = "suspended"
		case pb.EventType_STATION_REMOVED:
			removed := &pb.StationRemovedPayload{}
			if err := proto.Unmarshal(event.PayloadBytes, removed); err != nil {
				return fmt.Errorf("decode Federation removal event: %w", err)
			}
			member := memberships[removed.TargetStationPeerId]
			if member == nil {
				return fmt.Errorf("Federation removal targets an unknown Station")
			}
			member.Status = "removed"
		}
	}
	localMembership := memberships[input.LocalStationPeerID]
	if localMembership == nil || localMembership.Status != "active" {
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
			CreatedByActorPTID:     genesis.CreatorActorPtid,
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
		ActorPTID:            input.LocalActorPTID,
		ActorFederatedHandle: input.LocalActorPTID,
		StationPeerID:        input.LocalStationPeerID,
		Role:                 "federation_member",
	})
}

type ApproveJoinInput struct {
	FederationID                 string
	JoiningStationPeerID         string
	JoiningStationName           string
	JoiningStationURL            string
	ApproverActorPTID            string
	ApproverActorFederatedHandle string
	ApproverStationPeerID        string
	ActorPrivateKey              ed25519.PrivateKey
}

func (s *FederationService) ApproveJoinAsSequencer(
	ctx context.Context,
	federationID string,
	joiningStationPeerID string,
	joiningStationName string,
	joiningStationURL string,
) (*domain.MembershipRecord, error) {
	federation, err := s.federationRepo.GetByID(ctx, federationID)
	if err != nil {
		return nil, err
	}
	if federation == nil {
		return nil, fmt.Errorf("federation not found")
	}
	actorPTID := federation.CreatedByActorPTID
	privateKey, err := s.actorKeySvc.GetPrivateKey(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	return s.ApproveJoin(ctx, &ApproveJoinInput{
		FederationID:                 federationID,
		JoiningStationPeerID:         joiningStationPeerID,
		JoiningStationName:           joiningStationName,
		JoiningStationURL:            joiningStationURL,
		ApproverActorPTID:            actorPTID,
		ApproverActorFederatedHandle: actorPTID,
		ApproverStationPeerID:        federation.SequencerStationPeerID,
		ActorPrivateKey:              privateKey,
	})
}

func (s *FederationService) ApproveJoin(ctx context.Context, input *ApproveJoinInput) (*domain.MembershipRecord, error) {
	payload := &pb.StationJoinApprovedPayload{
		ApprovedStationPeerId:          input.JoiningStationPeerID,
		ApprovedByActorPtid:            input.ApproverActorPTID,
		ApprovedByActorFederatedHandle: input.ApproverActorFederatedHandle,
		Role:                           "member_station",
		ApprovedStationUrl:             input.JoiningStationURL,
		ApprovedStationName:            input.JoiningStationName,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return nil, err
	}

	membership := &domain.MembershipRecord{
		FederationID:  input.FederationID,
		StationPeerID: input.JoiningStationPeerID,
		StationName:   input.JoiningStationName,
		StationURL:    input.JoiningStationURL,
		Role:          "member_station",
		Status:        "active",
	}
	event, err := s.ledgerSvc.AppendEventWithProjection(
		ctx,
		&AppendEventInput{
			FederationID:         input.FederationID,
			EventType:            pb.EventType_STATION_JOIN_APPROVED,
			PayloadBytes:         payloadBytes,
			ActorPTID:            input.ApproverActorPTID,
			ActorFederatedHandle: input.ApproverActorFederatedHandle,
			StationPeerID:        input.ApproverStationPeerID,
			ActorPrivateKey:      input.ActorPrivateKey,
		},
		domain.LedgerProjectionMutation{Membership: membership},
	)
	if err != nil {
		return nil, err
	}
	membership.ApprovedByEventID = event.EventId
	return membership, nil
}

type LeaveFederationInput struct {
	FederationID         string
	ActorPTID            string
	ActorFederatedHandle string
	StationPeerID        string
	Reason               string
	ActorPrivateKey      ed25519.PrivateKey
}

func (s *FederationService) LeaveFederation(ctx context.Context, input *LeaveFederationInput) error {
	federation, err := s.federationRepo.GetByID(ctx, input.FederationID)
	if err != nil {
		return err
	}
	if federation == nil {
		return fmt.Errorf("federation not found")
	}
	if federation.SequencerStationPeerID == input.StationPeerID {
		return fmt.Errorf(
			"sequencer Station must hand over before leaving the Federation",
		)
	}

	payload := &pb.StationLeftPayload{
		LeavingStationPeerId:        input.StationPeerID,
		LeavingActorPtid:            input.ActorPTID,
		LeavingActorFederatedHandle: input.ActorFederatedHandle,
		Reason:                      input.Reason,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return err
	}

	_, err = s.ledgerSvc.AppendEvent(ctx, &AppendEventInput{
		FederationID:         input.FederationID,
		EventType:            pb.EventType_STATION_LEFT,
		PayloadBytes:         payloadBytes,
		ActorPTID:            input.ActorPTID,
		ActorFederatedHandle: input.ActorFederatedHandle,
		StationPeerID:        input.StationPeerID,
		ActorPrivateKey:      input.ActorPrivateKey,
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

type ApproveLeaveInput struct {
	FederationID                 string
	LeavingActorPTID             string
	LeavingActorFederatedHandle  string
	LeavingStationPeerID         string
	Reason                       string
	ApproverActorPTID            string
	ApproverActorFederatedHandle string
	ApproverStationPeerID        string
	ApproverActorPrivateKey      ed25519.PrivateKey
}

func (s *FederationService) ApproveLeaveAsSequencer(
	ctx context.Context,
	federationID string,
	leavingActorPTID string,
	leavingActorFederatedHandle string,
	leavingStationPeerID string,
	reason string,
) (*pb.LedgerEvent, error) {
	federation, err := s.federationRepo.GetByID(ctx, federationID)
	if err != nil {
		return nil, err
	}
	if federation == nil {
		return nil, fmt.Errorf("federation not found")
	}
	actorPTID := federation.CreatedByActorPTID
	privateKey, err := s.actorKeySvc.GetPrivateKey(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	return s.ApproveLeave(ctx, &ApproveLeaveInput{
		FederationID:                 federationID,
		LeavingActorPTID:             leavingActorPTID,
		LeavingActorFederatedHandle:  leavingActorFederatedHandle,
		LeavingStationPeerID:         leavingStationPeerID,
		Reason:                       reason,
		ApproverActorPTID:            actorPTID,
		ApproverActorFederatedHandle: actorPTID,
		ApproverStationPeerID:        federation.SequencerStationPeerID,
		ApproverActorPrivateKey:      privateKey,
	})
}

func (s *FederationService) ApproveLeave(
	ctx context.Context,
	input *ApproveLeaveInput,
) (*pb.LedgerEvent, error) {
	federation, err := s.federationRepo.GetByID(ctx, input.FederationID)
	if err != nil {
		return nil, err
	}
	if federation == nil {
		return nil, fmt.Errorf("federation not found")
	}
	if input.LeavingStationPeerID == federation.SequencerStationPeerID {
		return nil, fmt.Errorf(
			"sequencer Station must hand over before leaving the Federation",
		)
	}
	membership, err := s.membershipRepo.GetByStation(
		ctx,
		input.FederationID,
		input.LeavingStationPeerID,
	)
	if err != nil {
		return nil, err
	}
	if membership == nil || membership.Status != "active" {
		return nil, fmt.Errorf("leaving Station is not an active member")
	}
	payload := &pb.StationLeftPayload{
		LeavingStationPeerId:        input.LeavingStationPeerID,
		LeavingActorPtid:            input.LeavingActorPTID,
		LeavingActorFederatedHandle: input.LeavingActorFederatedHandle,
		Reason:                      input.Reason,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return nil, err
	}
	event, err := s.ledgerSvc.AppendEventWithProjection(
		ctx,
		&AppendEventInput{
			FederationID:         input.FederationID,
			EventType:            pb.EventType_STATION_LEFT,
			PayloadBytes:         payloadBytes,
			ActorPTID:            input.ApproverActorPTID,
			ActorFederatedHandle: input.ApproverActorFederatedHandle,
			StationPeerID:        input.ApproverStationPeerID,
			ActorPrivateKey:      input.ApproverActorPrivateKey,
		},
		domain.LedgerProjectionMutation{
			MembershipStationPeerID: input.LeavingStationPeerID,
			MembershipStatus:        "left",
		},
	)
	if err != nil {
		return nil, err
	}
	return event, nil
}

type DeleteFederationInput struct {
	FederationID         string
	ActorPTID            string
	ActorFederatedHandle string
	StationPeerID        string
	ActorPrivateKey      ed25519.PrivateKey
}

func (s *FederationService) DeleteFederation(ctx context.Context, input *DeleteFederationInput) error {
	payload := &pb.FederationArchivedPayload{
		ArchivedByActorPtid:            input.ActorPTID,
		ArchivedByActorFederatedHandle: input.ActorFederatedHandle,
	}
	payloadBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(payload)
	if err != nil {
		return err
	}

	_, err = s.ledgerSvc.AppendEventWithProjection(
		ctx,
		&AppendEventInput{
			FederationID:         input.FederationID,
			EventType:            pb.EventType_FEDERATION_ARCHIVED,
			PayloadBytes:         payloadBytes,
			ActorPTID:            input.ActorPTID,
			ActorFederatedHandle: input.ActorFederatedHandle,
			StationPeerID:        input.StationPeerID,
			ActorPrivateKey:      input.ActorPrivateKey,
		},
		domain.LedgerProjectionMutation{
			FederationStatus: "archived",
		},
	)
	return err
}
