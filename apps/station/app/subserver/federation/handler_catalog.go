package federation

import (
	"context"
	"errors"
	"fmt"
	"strings"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchdb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

const defaultCatalogPageSize = 20
const maxCatalogPageSize = 100

func (s *subServer) handleCatalogSearch(ctx context.Context, req *pb.FederationCatalogSearchRequest) (*pb.FederationCatalogSearchResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}

	if req.FederationId == "" {
		return nil, errors.New("federation_id is required")
	}
	if req.Prefix == "" {
		return nil, errors.New("prefix is required for catalog search")
	}

	stationPeerID := node.GetService().Options().Id

	if req.StationId != "" && req.StationId != stationPeerID {
		return &pb.FederationCatalogSearchResponse{
			Entries:    nil,
			TotalCount: 0,
		}, nil
	}

	members, err := s.projectionSvc.ListMemberStations(ctx, req.FederationId)
	if err != nil {
		return nil, fmt.Errorf("federation lookup failed: %w", err)
	}
	isMember := false
	for _, m := range members.Stations {
		if m.StationPeerId == stationPeerID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, errors.New("this station is not a member of the specified federation")
	}

	pageSize := int(req.PageSize)
	if pageSize <= 0 {
		pageSize = defaultCatalogPageSize
	}
	if pageSize > maxCatalogPageSize {
		pageSize = maxCatalogPageSize
	}

	rds, err := store.GetRDS(ctx)
	if err != nil {
		return nil, fmt.Errorf("database unavailable: %w", err)
	}

	escaped := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(req.Prefix)
	searchPattern := "%" + escaped + "%"

	var actors []touchdb.Actor
	dbQuery := rds.Where(
		"(preferred_username LIKE ? OR name LIKE ? OR federated_handle LIKE ?) AND origin = ? AND visibility >= 3",
		searchPattern, searchPattern, searchPattern, "local",
	).Limit(pageSize + 1)

	if err := dbQuery.Find(&actors).Error; err != nil {
		return nil, fmt.Errorf("actor search failed: %w", err)
	}

	stationName := node.GetService().Name()
	hasMore := len(actors) > pageSize
	if hasMore {
		actors = actors[:pageSize]
	}

	entries := make([]*pb.FederationCatalogEntry, 0, len(actors))
	for _, a := range actors {
		handle := a.FederatedHandle
		if handle == "" {
			handle = fmt.Sprintf("@%s", a.PreferredUsername)
		}

		entries = append(entries, &pb.FederationCatalogEntry{
			ActorId:           fmt.Sprintf("%d", a.ID),
			FederatedHandle:   handle,
			DisplayName:       a.Name,
			AvatarUrl:         a.Icon,
			HomeStationPeerId: stationPeerID,
			HomeStationName:   stationName,
			Visibility:        "indexed",
		})
	}

	resp := &pb.FederationCatalogSearchResponse{
		Entries:    entries,
		TotalCount: uint32(len(entries)),
	}
	if hasMore {
		resp.NextPageToken = fmt.Sprintf("offset:%d", pageSize)
	}
	return resp, nil
}
