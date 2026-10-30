package dashboard

import (
	"context"
	"errors"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	agentservice "github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

// The trusted Dashboard JWT supplies administration authority. Requests contain
// no actor/scope selector and cannot impersonate a Provider owner.
func aiEndpoint[Q, R any](h *dashboardHandler,
	invoke func(context.Context, agentservice.ProviderManagementPort, *Q) (*R, error),
) func(context.Context, *Q) (*R, error) {
	return func(ctx context.Context, request *Q) (*R, error) {
		claims := getClaims(ctx)
		if claims == nil || (claims.Role != string(domain.AdminRoleSuper) && claims.Role != string(domain.AdminRoleAdmin)) {
			return nil, server.NewHandlerError(http.StatusForbidden, "Dashboard administrator session is required")
		}
		if h.sub.aiSvc == nil {
			return nil, server.NewHandlerError(http.StatusServiceUnavailable, "Agent control plane is unavailable")
		}
		result, err := invoke(ctx, h.sub.aiSvc, request)
		if err == nil {
			return result, nil
		}
		var business *errcode.BizError
		if errors.As(err, &business) {
			return nil, server.NewHandlerError(business.HTTPStatus, business.Message)
		}
		return nil, server.InternalErrorWithCause("Agent control plane request failed", err)
	}
}

func (h *dashboardHandler) aiHandlers() []server.Handler {
	auth := func(next server.EndpointHandler) server.EndpointHandler {
		return h.connectionMaterialResponseWrapper()(h.authWrapper()(next))
	}
	owner := agentservice.StationProviderOwner()
	return []server.Handler{
		server.NewTypedHandler("dashboard-ai-provider-list", "/dashboard/api/ai/provider/list", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, _ *model.ListProvidersRequest) (*model.ListProvidersResponse, error) {
				return port.List(ctx, owner)
			}), auth),
		server.NewTypedHandler("dashboard-ai-provider-get", "/dashboard/api/ai/provider/get", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.GetProviderRequest) (*model.GetProviderResponse, error) {
				return port.Get(ctx, owner, req.GetProviderId())
			}), auth),
		server.NewTypedHandler("dashboard-ai-provider-create", "/dashboard/api/ai/provider/create", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.CreateProviderRequest) (*model.CreateProviderResponse, error) {
				return port.Create(ctx, owner, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-provider-update", "/dashboard/api/ai/provider/update", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.UpdateProviderRequest) (*model.UpdateProviderResponse, error) {
				return port.Update(ctx, owner, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-provider-delete", "/dashboard/api/ai/provider/delete", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.DeleteProviderRequest) (*model.DeleteProviderResponse, error) {
				return port.Delete(ctx, owner, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-model-list", "/dashboard/api/ai/model/list", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.ListModelsRequest) (*model.ListModelsResponse, error) {
				return port.ListModels(ctx, owner, req.GetProviderId())
			}), auth),
		server.NewTypedHandler("dashboard-ai-model-create", "/dashboard/api/ai/model/create", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.CreateModelRequest) (*model.CreateModelResponse, error) {
				return port.CreateModel(ctx, owner, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-model-update", "/dashboard/api/ai/model/update", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.UpdateModelRequest) (*model.UpdateModelResponse, error) {
				return port.UpdateModel(ctx, owner, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-credential-set", "/dashboard/api/ai/credential/set", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.SetCredentialRequest) (*model.SetCredentialResponse, error) {
				return port.SetCredential(ctx, owner, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-credential-delete", "/dashboard/api/ai/credential/delete", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.DeleteCredentialRequest) (*model.DeleteCredentialResponse, error) {
				return port.DeleteCredential(ctx, owner, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-credential-status", "/dashboard/api/ai/credential/status", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.GetCredentialStatusRequest) (*model.GetCredentialStatusResponse, error) {
				return port.CredentialStatus(ctx, owner, req.GetProviderId())
			}), auth),
		server.NewTypedHandler("dashboard-ai-policy-get", "/dashboard/api/ai/policy/get", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, _ *model.GetProviderPolicyRequest) (*model.GetProviderPolicyResponse, error) {
				return port.Policy(ctx)
			}), auth),
		server.NewTypedHandler("dashboard-ai-policy-set", "/dashboard/api/ai/policy/set", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.SetProviderPolicyRequest) (*model.SetProviderPolicyResponse, error) {
				return port.SetPolicy(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-access-get", "/dashboard/api/ai/access/get", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.GetProviderAccessRequest) (*model.GetProviderAccessResponse, error) {
				return port.Access(ctx, req.GetProviderId())
			}), auth),
		server.NewTypedHandler("dashboard-ai-access-set", "/dashboard/api/ai/access/set", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.SetProviderAccessRequest) (*model.SetProviderAccessResponse, error) {
				return port.SetAccess(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-install-start", "/dashboard/api/ai/install/start", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.InstallProviderRequest) (*model.InstallProviderResponse, error) {
				return port.Install(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-install-status", "/dashboard/api/ai/install/status", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.ProviderInstallStatusRequest) (*model.ProviderInstallStatusResponse, error) {
				return port.InstallStatus(ctx, req)
			}), auth),
		server.NewTypedHandler("dashboard-ai-model-discover", "/dashboard/api/ai/model/discover", server.POST,
			aiEndpoint(h, func(ctx context.Context, port agentservice.ProviderManagementPort, req *model.DiscoverProviderModelsRequest) (*model.DiscoverProviderModelsResponse, error) {
				return port.Discover(ctx, owner, req.GetProviderId())
			}), auth),
	}
}
