package federation

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	resolvepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/api/pb"
	resolverpkg "github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
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
	return federationContexts(
		federations,
		s.catalog != nil && s.catalog.config.Enabled,
	), nil
}

func federationContexts(
	federations *pb.ListFederationsResponse,
	localDirectoryEnabled bool,
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
			FederationId:          federation.FederationId,
			Name:                  federation.Name,
			Status:                federation.Status,
			LocalDirectoryEnabled: localDirectoryEnabled,
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
	resolved, err := resolverpkg.New(resolverpkg.Config{}).ResolveByHandleInFederation(
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

func (s *subServer) handleCatalogSearch(
	ctx context.Context,
	req *pb.FederationCatalogSearchRequest,
) (*pb.FederationCatalogSearchResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if s.catalog == nil {
		return nil, server.NewHandlerError(
			503,
			"Federation catalog is unavailable",
		)
	}
	return s.catalog.Search(ctx, subject.ID, req)
}
