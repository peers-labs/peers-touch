package application

import (
	"context"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
)

// ValidateActiveStationPair verifies that both Stations belong to one active
// Federation. It exposes membership truth without leaking Federation stores.
func (s *ProjectionService) ValidateActiveStationPair(
	ctx context.Context,
	federationID string,
	sourceStationPeerID string,
	targetStationPeerID string,
) error {
	federationID = strings.TrimSpace(federationID)
	sourceStationPeerID = strings.TrimSpace(sourceStationPeerID)
	targetStationPeerID = strings.TrimSpace(targetStationPeerID)
	if federationID == "" ||
		sourceStationPeerID == "" ||
		targetStationPeerID == "" ||
		sourceStationPeerID == targetStationPeerID {
		return fmt.Errorf(
			"%w: identifiers are invalid",
			domain.ErrInactiveStationPair,
		)
	}
	federation, err := s.federationRepo.GetByID(ctx, federationID)
	if err != nil {
		return err
	}
	if federation == nil || federation.Status != "active" {
		return fmt.Errorf(
			"%w: Federation is not active",
			domain.ErrInactiveStationPair,
		)
	}
	for _, stationPeerID := range []string{
		sourceStationPeerID,
		targetStationPeerID,
	} {
		membership, err := s.membershipRepo.GetByStation(
			ctx,
			federationID,
			stationPeerID,
		)
		if err != nil {
			return err
		}
		if membership == nil || membership.Status != "active" {
			return fmt.Errorf(
				"%w: Station is not an active Federation member",
				domain.ErrInactiveStationPair,
			)
		}
	}
	return nil
}

type ProjectionService struct {
	federationRepo domain.FederationRepository
	membershipRepo domain.MembershipRepository
	actorRoleRepo  domain.ActorRoleRepository
	syncCursorRepo domain.SyncCursorRepository
}

func NewProjectionService(
	federationRepo domain.FederationRepository,
	membershipRepo domain.MembershipRepository,
	actorRoleRepo domain.ActorRoleRepository,
	syncCursorRepo domain.SyncCursorRepository,
) *ProjectionService {
	return &ProjectionService{
		federationRepo: federationRepo,
		membershipRepo: membershipRepo,
		actorRoleRepo:  actorRoleRepo,
		syncCursorRepo: syncCursorRepo,
	}
}

func (s *ProjectionService) ListFederations(ctx context.Context, stationPeerID, actorPTID string) (*pb.ListFederationsResponse, error) {
	feds, err := s.federationRepo.ListByStation(ctx, stationPeerID)
	if err != nil {
		return nil, err
	}

	resp := &pb.ListFederationsResponse{}
	for _, fed := range feds {
		members, err := s.membershipRepo.ListByFederation(ctx, fed.FederationID)
		if err != nil {
			return nil, err
		}
		role, err := s.actorRoleRepo.GetByActor(ctx, fed.FederationID, actorPTID)
		if err != nil {
			return nil, err
		}

		summary := &pb.FederationSummary{
			FederationId:           fed.FederationID,
			Name:                   fed.Name,
			Description:            fed.Description,
			Status:                 fed.Status,
			PolicyType:             fed.PolicyType,
			HeadSeq:                fed.HeadSeq,
			SequencerStationPeerId: fed.SequencerStationPeerID,
			MemberStationCount:     uint32(len(members)),
		}

		if role != nil {
			summary.MyRole = role.Role
			summary.Capability = computeCapability(role.Role)
		}

		resp.Federations = append(resp.Federations, summary)
	}
	return resp, nil
}

func (s *ProjectionService) ListMemberStations(ctx context.Context, federationID string) (*pb.ListMemberStationsResponse, error) {
	members, err := s.membershipRepo.ListByFederation(ctx, federationID)
	if err != nil {
		return nil, err
	}

	resp := &pb.ListMemberStationsResponse{}
	for _, m := range members {
		resp.Stations = append(resp.Stations, &pb.MemberStationView{
			StationPeerId: m.StationPeerID,
			StationName:   m.StationName,
			StationUrl:    m.StationURL,
			Role:          m.Role,
			Status:        m.Status,
			JoinedAt:      m.JoinedAt,
		})
	}
	return resp, nil
}

func computeCapability(role string) *pb.ActorCapability {
	switch role {
	case "federation_owner":
		return &pb.ActorCapability{
			CanInvite: true, CanApproveJoin: true, CanUpdatePolicy: true,
			CanViewLedger: true, CanRemoveStation: true, CanGrantAdmin: true,
			CanLeave: true, CanArchive: true,
		}
	case "federation_admin":
		return &pb.ActorCapability{
			CanInvite: true, CanApproveJoin: true, CanUpdatePolicy: false,
			CanViewLedger: true, CanRemoveStation: true, CanGrantAdmin: false,
			CanLeave: true, CanArchive: false,
		}
	default:
		return &pb.ActorCapability{
			CanViewLedger: true, CanLeave: true,
		}
	}
}
