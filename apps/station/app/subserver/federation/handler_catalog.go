package federation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	resolvepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/api/pb"
	resolverpkg "github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
	touchdb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
)

const defaultCatalogPageSize = 20
const maxCatalogPageSize = 100

func (s *subServer) handleListFederationContexts(
	ctx context.Context,
	_ *struct{},
) (*pb.ListFederationContextsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	// Materialize the station-local social domain on first authenticated need
	// so existing sessions discover it without re-login or manual setup.
	s.ensureDefaultFederation(ctx)
	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}
	federations, err := s.projectionSvc.ListFederations(
		ctx,
		stationPeerID,
		subject.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("list Federation contexts: %w", err)
	}
	return federationContexts(federations), nil
}

func federationContexts(
	federations *pb.ListFederationsResponse,
) *pb.ListFederationContextsResponse {
	response := &pb.ListFederationContextsResponse{}
	if federations == nil {
		return response
	}
	for _, federation := range federations.Federations {
		if federation == nil || federation.Status != "active" {
			continue
		}
		response.Contexts = append(response.Contexts, &pb.FederationContext{
			FederationId: federation.FederationId,
			Name:         federation.Name,
			Status:       federation.Status,
		})
	}
	return response
}

func (s *subServer) handleResolveFederationActor(
	ctx context.Context,
	req *resolvepb.FederationResolveRequest,
) (*resolvepb.FederationResolveView, error) {
	if coreauth.GetSubject(ctx) == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req == nil || strings.TrimSpace(req.FederationId) == "" {
		return nil, server.BadRequest("federation_id is required")
	}
	if strings.TrimSpace(req.Handle) == "" {
		return nil, server.BadRequest("handle is required")
	}

	resolveCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	resolved, err := resolverpkg.New(resolverpkg.Config{
		HTTPClient:         &http.Client{Timeout: 15 * time.Second},
		StationURLResolver: s,
	}).ResolveByHandleInFederation(
		resolveCtx,
		req.FederationId,
		req.Handle,
		s,
		touchactor.FederationProfileFetcher(""),
		touchactor.FederationKeyCache(),
	)
	if err != nil {
		switch {
		case errors.Is(err, resolverpkg.ErrFederationContextRequired):
			return nil, server.BadRequest("federation_id is required")
		case errors.Is(err, resolverpkg.ErrStationOutsideFederation),
			errors.Is(err, locator.ErrNotFound),
			errors.Is(err, resolverpkg.ErrTombstoned):
			return nil, server.NotFound("actor is not visible in the Federation context")
		case errors.Is(err, resolverpkg.ErrFederationNotReady),
			errors.Is(err, resolverpkg.ErrLocalIdentityMissing),
			errors.Is(err, resolverpkg.ErrRelayUnavailable):
			return nil, server.NewHandlerError(
				503,
				"Federation resolution is unavailable",
			)
		default:
			return nil, server.InternalErrorWithCause(
				"resolve Federation actor",
				err,
			)
		}
	}
	return federationResolveView(req.FederationId, resolved), nil
}

func federationResolveView(
	federationID string,
	resolved *resolverpkg.Resolved,
) *resolvepb.FederationResolveView {
	if resolved == nil || resolved.Envelope == nil {
		return &resolvepb.FederationResolveView{}
	}
	envelope := resolved.Envelope
	handle := strings.TrimSpace(envelope.GetFederatedHandle())
	if handle != "" && !strings.HasPrefix(handle, "@") {
		handle = "@" + handle
	}
	return &resolvepb.FederationResolveView{
		FederatedHandle:   handle,
		HomeStationPeerId: envelope.GetHomeStationPeerId(),
		HomeStationDomain: envelope.GetHomeStationDomain(),
		IsLocal:           resolved.IsLocal,
		FromCache:         resolved.FromCache,
		Profile:           envelope.GetProfile(),
		LocatorSeq:        resolved.Locator.GetSeq(),
		IssuedAtUnixMs:    envelope.GetIssuedAtUnixMs(),
		ExpiresAtUnixMs:   envelope.GetExpiresAtUnixMs(),
		SigningKeyKid:     envelope.GetSigningKeyKid(),
		FederationId:      strings.TrimSpace(federationID),
	}
}

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

	stationPeerID := localStationPeerID()
	if stationPeerID == "" {
		return nil, server.InternalError("local Station peer identity unavailable")
	}

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
	memberStationNames := make(map[string]string, len(members.Stations))
	memberStationIDs := make([]string, 0, len(members.Stations))
	for _, m := range members.Stations {
		if m == nil || m.Status != "active" {
			continue
		}
		memberStationIDs = append(memberStationIDs, m.StationPeerId)
		memberStationNames[m.StationPeerId] = m.StationName
		if m.StationPeerId == stationPeerID {
			isMember = true
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
		`(preferred_username LIKE ? OR name LIKE ? OR federated_handle LIKE ?)
AND visibility >= 3
AND (
  origin = ?
  OR (
    origin = ?
    AND home_station_peer_id IN ?
    AND cached_until_unix_ms > ?
  )
)`,
		searchPattern,
		searchPattern,
		searchPattern,
		touchactor.OriginLocal,
		touchactor.OriginRemoteCached,
		memberStationIDs,
		time.Now().UnixMilli(),
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
		homeStationPeerID := a.HomeStationPeerID
		homeStationName := memberStationNames[homeStationPeerID]
		if a.Origin == touchactor.OriginLocal {
			homeStationPeerID = stationPeerID
			homeStationName = stationName
		}
		if homeStationName == "" {
			homeStationName = a.HomeStationDomain
		}
		handle := a.FederatedHandle
		if handle == "" {
			handle = fmt.Sprintf("@%s", a.PreferredUsername)
		}

		entries = append(entries, &pb.FederationCatalogEntry{
			ActorPtid:         a.PTID,
			FederatedHandle:   handle,
			DisplayName:       a.Name,
			AvatarUrl:         a.Icon,
			HomeStationPeerId: homeStationPeerID,
			HomeStationName:   homeStationName,
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
