package handler

import (
	"context"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/managed"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ProviderHandlers struct {
	providerConfig    *service.ProviderConfigService
	credentialCfg     *service.CredentialConfigService
	admissionResolver *service.RuntimeAdmissionResolver
	runtimeDefaults   *service.RuntimeDefaultService
	management        *service.ProviderManagementService
}

func NewProviderHandlers(providers *service.ProviderConfigService, models *service.ModelConfigService,
	credentials *service.CredentialConfigService, admission *service.RuntimeAdmissionResolver,
	runtimeModels *service.RuntimeModelCatalog, discovery *service.ProviderModelDiscoveryService,
	defaults *service.RuntimeDefaultService, installer *managed.Manager) *ProviderHandlers {
	return &ProviderHandlers{providerConfig: providers, credentialCfg: credentials,
		admissionResolver: admission, runtimeDefaults: defaults,
		management: service.NewProviderManagementService(providers, models, credentials, runtimeModels, discovery, installer)}
}

// Consumption projects only authorized models. Shared credentials, commands,
// installation state and configuration never cross the actor boundary.
func (h *ProviderHandlers) HandleProviderList(ctx context.Context, _ *model.ListProvidersRequest) (*model.ListProvidersResponse, error) {
	actor := subjectActorPTID(ctx)
	models, err := h.admissionResolver.ListAvailableModels(ctx, actor)
	if err != nil {
		return nil, toHandlerError(err)
	}
	records, err := h.providerConfig.ListEffective(ctx, actor)
	if err != nil {
		return nil, toHandlerError(err)
	}
	result := &model.ListProvidersResponse{Providers: []*model.AgentProviderInfo{}}
	byID := map[string]*model.AgentProviderInfo{}
	for _, item := range models {
		provider := byID[item.ProviderID]
		if provider == nil {
			provider = &model.AgentProviderInfo{Id: item.ProviderID, Name: item.ProviderName, Enabled: true}
			for _, record := range records {
				if record.Name != item.ProviderID {
					continue
				}
				scope := model.ProviderResourceScope_PROVIDER_RESOURCE_SCOPE_ACTOR
				if record.Scope == service.ProviderScopeStation {
					scope = model.ProviderResourceScope_PROVIDER_RESOURCE_SCOPE_STATION
				}
				provider.Owner = &model.ProviderResourceOwner{Scope: scope, ActorPtid: record.ActorPTID}
				provider.Version = record.Version
				provider.RuntimeKind = record.RuntimeKind
				break
			}
			byID[item.ProviderID] = provider
			result.Providers = append(result.Providers, provider)
		}
		provider.Models = append(provider.Models, &model.ProviderModelInfo{Id: item.ID,
			DisplayName: item.DisplayName, Type: item.Type, Enabled: true, ContextWindow: item.ContextWindow,
			Capabilities: &model.ModelCapabilityConfig{Flags: item.Capabilities}})
	}
	return result, nil
}

func (h *ProviderHandlers) HandleProviderGet(ctx context.Context, req *model.GetProviderRequest) (*model.GetProviderResponse, error) {
	list, err := h.HandleProviderList(ctx, &model.ListProvidersRequest{})
	if err != nil {
		return nil, err
	}
	for _, provider := range list.Providers {
		if provider.Id == req.GetProviderId() {
			return &model.GetProviderResponse{Provider: provider}, nil
		}
	}
	return nil, server.NewHandlerError(http.StatusNotFound, "authorized provider not found")
}

func (h *ProviderHandlers) HandlePersonalProviderList(ctx context.Context, _ *model.ListProvidersRequest) (*model.ListProvidersResponse, error) {
	result, err := h.management.List(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)))
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandlePersonalProviderGet(ctx context.Context, req *model.GetProviderRequest) (*model.GetProviderResponse, error) {
	result, err := h.management.Get(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req.GetProviderId())
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleProviderCreate(ctx context.Context, req *model.CreateProviderRequest) (*model.CreateProviderResponse, error) {
	result, err := h.management.Create(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleProviderUpdate(ctx context.Context, req *model.UpdateProviderRequest) (*model.UpdateProviderResponse, error) {
	result, err := h.management.Update(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleProviderDelete(ctx context.Context, req *model.DeleteProviderRequest) (*model.DeleteProviderResponse, error) {
	result, err := h.management.Delete(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleProviderPolicy(ctx context.Context, _ *model.GetProviderPolicyRequest) (*model.GetProviderPolicyResponse, error) {
	if err := service.ActorProviderOwner(subjectActorPTID(ctx)).Validate(); err != nil {
		return nil, toHandlerError(err)
	}
	result, err := h.management.Policy(ctx)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleProviderCheck(ctx context.Context, req *model.CheckProviderRequest) (*model.CheckProviderResponse, error) {
	result, err := h.management.Check(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req.GetProviderId())
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleDiscoverProviderModels(ctx context.Context, req *model.DiscoverProviderModelsRequest) (*model.DiscoverProviderModelsResponse, error) {
	result, err := h.management.Discover(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req.GetProviderId())
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleModelList(ctx context.Context, req *model.ListModelsRequest) (*model.ListModelsResponse, error) {
	list, err := h.HandleListAvailableModels(ctx, &model.ListAvailableModelsRequest{})
	if err != nil {
		return nil, err
	}
	result := &model.ListModelsResponse{Models: []*model.AgentModelInfo{}}
	for _, item := range list.Models {
		if req.GetProviderId() != "" && req.GetProviderId() != item.ProviderId {
			continue
		}
		result.Models = append(result.Models, &model.AgentModelInfo{Id: item.Id, ProviderId: item.ProviderId,
			ModelId: item.Id, DisplayName: item.DisplayName, Enabled: item.Enabled, ContextWindow: item.ContextWindow,
			Capabilities: item.Capabilities})
	}
	return result, nil
}

func (h *ProviderHandlers) HandlePersonalModelList(ctx context.Context, req *model.ListModelsRequest) (*model.ListModelsResponse, error) {
	result, err := h.management.ListModels(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req.GetProviderId())
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleModelCreate(ctx context.Context, req *model.CreateModelRequest) (*model.CreateModelResponse, error) {
	result, err := h.management.CreateModel(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleModelUpdate(ctx context.Context, req *model.UpdateModelRequest) (*model.UpdateModelResponse, error) {
	result, err := h.management.UpdateModel(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleListAvailableModels(ctx context.Context, _ *model.ListAvailableModelsRequest) (*model.ListAvailableModelsResponse, error) {
	items, err := h.admissionResolver.ListAvailableModels(ctx, subjectActorPTID(ctx))
	if err != nil {
		return nil, toHandlerError(err)
	}
	result := &model.ListAvailableModelsResponse{Models: []*model.AvailableModelInfo{}}
	for _, item := range items {
		result.Models = append(result.Models, &model.AvailableModelInfo{Id: item.ID, ProviderId: item.ProviderID,
			ProviderName: item.ProviderName, DisplayName: item.DisplayName, Type: item.Type, Enabled: item.Enabled,
			ContextWindow: item.ContextWindow, Capabilities: &model.ModelCapabilityConfig{Flags: item.Capabilities}})
	}
	return result, nil
}

func (h *ProviderHandlers) HandleCredentialSet(ctx context.Context, req *model.SetCredentialRequest) (*model.SetCredentialResponse, error) {
	result, err := h.management.SetCredential(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleCredentialDelete(ctx context.Context, req *model.DeleteCredentialRequest) (*model.DeleteCredentialResponse, error) {
	result, err := h.management.DeleteCredential(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req)
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleCredentialStatus(ctx context.Context, req *model.GetCredentialStatusRequest) (*model.GetCredentialStatusResponse, error) {
	result, err := h.management.CredentialStatus(ctx, service.ActorProviderOwner(subjectActorPTID(ctx)), req.GetProviderId())
	return result, toHandlerError(err)
}

func (h *ProviderHandlers) HandleCredentialResolve(ctx context.Context, req *model.ResolveCredentialRequest) (*model.ResolveCredentialResponse, error) {
	result, err := h.credentialCfg.Resolve(ctx, subjectActorPTID(ctx), req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	return &model.ResolveCredentialResponse{Credential: &model.CredentialResolveInfo{ProviderId: result.ProviderID,
		ApiKey: result.APIKey, BaseUrl: result.BaseURL, Protocol: result.Protocol}}, nil
}

func (h *ProviderHandlers) HandleModelHide(ctx context.Context, req *model.HideModelRequest) (*model.HideModelResponse, error) {
	err := h.providerConfig.HideModel(ctx, subjectActorPTID(ctx), req.GetProviderId(), req.GetModelId())
	return &model.HideModelResponse{Ok: err == nil}, toHandlerError(err)
}

func (h *ProviderHandlers) HandleModelHiddenList(ctx context.Context, req *model.GetHiddenModelsRequest) (*model.GetHiddenModelsResponse, error) {
	actor := subjectActorPTID(ctx)
	if err := h.providerConfig.RequirePersonal(ctx, actor); err != nil {
		return nil, toHandlerError(err)
	}
	items, err := h.providerConfig.GetHiddenModels(ctx, actor, req.GetProviderId())
	return &model.GetHiddenModelsResponse{HiddenModels: items}, toHandlerError(err)
}
