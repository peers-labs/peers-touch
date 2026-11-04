package dashboard

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	pb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"google.golang.org/protobuf/types/known/emptypb"
)

func federationEndpoint[Q, R any](h *dashboardHandler,
	invoke func(context.Context, federationdomain.ManagementPort, *Q) (*R, error),
) func(context.Context, *Q) (*R, error) {
	return func(ctx context.Context, req *Q) (*R, error) {
		claims := getClaims(ctx)
		if claims == nil || (claims.Role != string(domain.AdminRoleSuper) && claims.Role != string(domain.AdminRoleAdmin)) {
			return nil, server.Forbidden("Dashboard administrator session is required")
		}
		if h.sub.federationSvc == nil {
			return nil, server.NewHandlerError(http.StatusServiceUnavailable, "Federation control plane is unavailable")
		}
		return invoke(ctx, h.sub.federationSvc, req)
	}
}

func (h *dashboardHandler) federationHandlers() []server.Handler {
	auth := func(next server.EndpointHandler) server.EndpointHandler {
		return h.connectionMaterialResponseWrapper()(h.authWrapper()(next))
	}
	return []server.Handler{
		server.NewTypedHandler("dashboard-federation-list", "/dashboard/api/federation/list", server.POST,
			federationEndpoint(h, func(ctx context.Context, port federationdomain.ManagementPort, _ *emptypb.Empty) (*pb.ListFederationsResponse, error) {
				return port.ListManagedFederations(ctx)
			}), auth),
		server.NewTypedHandler("dashboard-federation-stations", "/dashboard/api/federation/stations", server.POST,
			federationEndpoint(h, func(ctx context.Context, port federationdomain.ManagementPort, req *pb.ListMemberStationsRequest) (*pb.ListMemberStationsResponse, error) {
				return port.ListManagedStations(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-federation-create", "/dashboard/api/federation/create", server.POST,
			federationEndpoint(h, func(ctx context.Context, port federationdomain.ManagementPort, req *pb.CreateFederationRequest) (*pb.CreateFederationResponse, error) {
				return port.CreateFederation(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-federation-join", "/dashboard/api/federation/join", server.POST,
			federationEndpoint(h, func(ctx context.Context, port federationdomain.ManagementPort, req *pb.JoinFederationRequest) (*pb.JoinFederationResponse, error) {
				return port.JoinFederation(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-federation-leave", "/dashboard/api/federation/leave", server.POST,
			federationEndpoint(h, func(ctx context.Context, port federationdomain.ManagementPort, req *pb.LeaveFederationRequest) (*pb.LeaveFederationResponse, error) {
				return port.LeaveFederation(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-federation-delete", "/dashboard/api/federation/delete", server.POST,
			federationEndpoint(h, func(ctx context.Context, port federationdomain.ManagementPort, req *pb.DeleteFederationRequest) (*pb.DeleteFederationResponse, error) {
				return port.DeleteFederation(ctx, req)
			}), auth),
	}
}
