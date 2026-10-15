package relay

import (
	"context"
	"fmt"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func (s *SubServer) AccessEndpoint(
	ctx context.Context,
	req *peerpb.AccessEndpointRequest,
) (*peerpb.AccessEndpointResponse, error) {
	return s.svc.DiscoverEndpoint(ctx, req, s.opts.PublicBaseURL)
}

func (h *relayHandler) handlePublishStationRoute(
	ctx context.Context,
	req *peerpb.PublishStationRouteRequest,
) (*peerpb.PublishStationRouteResponse, error) {
	identity, ok := nodeIdentityFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("valid Relay enrollment identity is required")
	}
	statement, err := h.sub.svc.PublishStationRoute(
		ctx,
		identity,
		req.GetRouteAttestation(),
	)
	if err != nil {
		return nil, err
	}
	return &peerpb.PublishStationRouteResponse{
		RouteId:         statement.GetRouteId(),
		RouteGeneration: statement.GetRouteGeneration(),
	}, nil
}

func (h *relayHandler) handleRegisterConnectionGrant(
	ctx context.Context,
	req *peerpb.RegisterStationConnectionGrantRequest,
) (*peerpb.RegisterStationConnectionGrantResponse, error) {
	identity, ok := nodeIdentityFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("valid Relay enrollment identity is required")
	}
	record, err := h.sub.svc.RegisterConnectionGrant(ctx, identity, req)
	if err != nil {
		return nil, err
	}
	return &peerpb.RegisterStationConnectionGrantResponse{
		GrantId:       record.GrantID,
		RemainingUses: record.RemainingUses,
	}, nil
}

func nodeIdentityFromContext(ctx context.Context) (domain.NodeIdentity, bool) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return domain.NodeIdentity{}, false
	}
	return nodeIdentityFromSubject(subject.ID, subject.Attributes)
}
