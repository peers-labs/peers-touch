package federation

import (
	"context"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func (s *subServer) FederationManagement() domain.ManagementPort { return s }

func (s *subServer) ListManagedFederations(ctx context.Context) (*pb.ListFederationsResponse, error) {
	actorPTID, err := s.governanceActor(ctx)
	if err != nil {
		return nil, err
	}
	s.ensureDefaultFederation(ctx)
	stationPeerID := localStationPeerID()
	if stationPeerID == "" || s.projectionSvc == nil {
		return nil, server.InternalError("local Federation projection is unavailable")
	}
	return s.projectionSvc.ListFederations(ctx, stationPeerID, actorPTID)
}

func (s *subServer) ListManagedStations(ctx context.Context, req *pb.ListMemberStationsRequest) (*pb.ListMemberStationsResponse, error) {
	if strings.TrimSpace(req.GetFederationId()) == "" {
		return nil, server.BadRequest("federation_id is required")
	}
	if s.projectionSvc == nil {
		return nil, server.InternalError("local Federation projection is unavailable")
	}
	return s.projectionSvc.ListMemberStations(ctx, req.GetFederationId())
}

var _ domain.ManagementPort = (*subServer)(nil)
