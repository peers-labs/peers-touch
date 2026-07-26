package handler

import (
	"context"
	"net/http"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ProviderHandlers struct {
	providerConfig *service.ProviderConfigService
	modelConfig    *service.ModelConfigService
	credentialCfg  *service.CredentialConfigService
}

func NewProviderHandlers(
	providerConfig *service.ProviderConfigService,
	modelConfig *service.ModelConfigService,
	credentialCfg *service.CredentialConfigService,
) *ProviderHandlers {
	return &ProviderHandlers{
		providerConfig: providerConfig,
		modelConfig:    modelConfig,
		credentialCfg:  credentialCfg,
	}
}

func (h *ProviderHandlers) HandleVerifyCli(_ context.Context, req *model.VerifyCliRequest) (*model.VerifyCliResponse, error) {
	if req.GetCliCommand() == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "cli_command is required")
	}

	result := cli.VerifyCliBinary(req.GetCliCommand())
	return &model.VerifyCliResponse{
		Available:   result.Available,
		Program:     result.Program,
		Path:        result.Path,
		Error:       result.Error,
		InstallHint: result.InstallHint,
	}, nil
}

func (h *ProviderHandlers) HandleProviderList(ctx context.Context, _ *model.ListProvidersRequest) (*model.ListProvidersResponse, error) {
	actorID := subjectActorID(ctx)

	providers, err := h.providerConfig.List(ctx, actorID)
	if err != nil {
		return nil, toHandlerError(err)
	}

	resp := &model.ListProvidersResponse{
		Providers: make([]*model.AgentProviderInfo, 0, len(providers)),
	}
	for i := range providers {
		resp.Providers = append(resp.Providers, providerToProto(&providers[i]))
	}
	return resp, nil
}

func (h *ProviderHandlers) HandleProviderCreate(ctx context.Context, req *model.CreateProviderRequest) (*model.CreateProviderResponse, error) {
	actorID := subjectActorID(ctx)

	provider, err := h.providerConfig.Create(ctx, service.ProviderCreateRequest{
		ActorID:     actorID,
		ProviderID:  req.GetProviderId(),
		DisplayName: req.GetDisplayName(),
		BaseURL:     req.GetBaseUrl(),
		Protocol:    req.GetProtocol(),
		ConfigJSON:  req.GetConfigJson(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.CreateProviderResponse{Provider: providerToProto(provider)}, nil
}

func (h *ProviderHandlers) HandleProviderUpdate(ctx context.Context, req *model.UpdateProviderRequest) (*model.UpdateProviderResponse, error) {
	actorID := subjectActorID(ctx)

	provider, err := h.providerConfig.Update(ctx, service.ProviderUpdateRequest{
		ActorID:     actorID,
		ProviderID:  req.GetProviderId(),
		Version:     req.GetVersion(),
		DisplayName: req.DisplayName,
		BaseURL:     req.BaseUrl,
		Enabled:     req.Enabled,
		ConfigJSON:  req.GetConfigJson(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.UpdateProviderResponse{Provider: providerToProto(provider)}, nil
}

func (h *ProviderHandlers) HandleProviderDelete(ctx context.Context, req *model.DeleteProviderRequest) (*model.DeleteProviderResponse, error) {
	actorID := subjectActorID(ctx)

	if err := h.providerConfig.Delete(ctx, service.ProviderDeleteRequest{
		ActorID:    actorID,
		ProviderID: req.GetProviderId(),
		Version:    req.GetVersion(),
	}); err != nil {
		return nil, toHandlerError(err)
	}

	return &model.DeleteProviderResponse{Deleted: true}, nil
}

func (h *ProviderHandlers) HandleModelList(ctx context.Context, req *model.ListModelsRequest) (*model.ListModelsResponse, error) {
	actorID := subjectActorID(ctx)

	models, err := h.modelConfig.List(ctx, actorID, req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}

	resp := &model.ListModelsResponse{
		Models: make([]*model.AgentModelInfo, 0, len(models)),
	}
	for i := range models {
		resp.Models = append(resp.Models, modelToProto(&models[i]))
	}
	return resp, nil
}

func (h *ProviderHandlers) HandleModelUpdate(ctx context.Context, req *model.UpdateModelRequest) (*model.UpdateModelResponse, error) {
	actorID := subjectActorID(ctx)

	m, err := h.modelConfig.Update(ctx, service.ModelUpdateRequest{
		ActorID:     actorID,
		ProviderID:  req.GetProviderId(),
		ModelID:     req.GetModelId(),
		Version:     req.GetVersion(),
		DisplayName: req.DisplayName,
		Enabled:     req.Enabled,
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.UpdateModelResponse{Model: modelToProto(m)}, nil
}

func (h *ProviderHandlers) HandleCredentialSet(ctx context.Context, req *model.SetCredentialRequest) (*model.SetCredentialResponse, error) {
	actorID := subjectActorID(ctx)

	status, err := h.credentialCfg.Set(ctx, service.CredentialSetRequest{
		ActorID:    actorID,
		ProviderID: req.GetProviderId(),
		APIKey:     req.GetApiKey(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.SetCredentialResponse{Status: credentialStatusToProto(status)}, nil
}

func (h *ProviderHandlers) HandleCredentialDelete(ctx context.Context, req *model.DeleteCredentialRequest) (*model.DeleteCredentialResponse, error) {
	actorID := subjectActorID(ctx)

	if err := h.credentialCfg.Delete(ctx, service.CredentialDeleteRequest{
		ActorID:    actorID,
		ProviderID: req.GetProviderId(),
		Version:    req.GetVersion(),
	}); err != nil {
		return nil, toHandlerError(err)
	}

	return &model.DeleteCredentialResponse{Deleted: true}, nil
}

func (h *ProviderHandlers) HandleCredentialStatus(ctx context.Context, req *model.GetCredentialStatusRequest) (*model.GetCredentialStatusResponse, error) {
	actorID := subjectActorID(ctx)

	status, err := h.credentialCfg.Status(ctx, actorID, req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.GetCredentialStatusResponse{Status: credentialStatusToProto(status)}, nil
}

func (h *ProviderHandlers) HandleCredentialResolve(ctx context.Context, req *model.ResolveCredentialRequest) (*model.ResolveCredentialResponse, error) {
	actorID := subjectActorID(ctx)

	resolved, err := h.credentialCfg.Resolve(ctx, actorID, req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.ResolveCredentialResponse{
		Credential: &model.CredentialResolveInfo{
			ProviderId: resolved.ProviderID,
			ApiKey:     resolved.APIKey,
			BaseUrl:    resolved.BaseURL,
			Protocol:   resolved.Protocol,
		},
	}, nil
}

func (h *ProviderHandlers) HandleModelHide(ctx context.Context, req *model.HideModelRequest) (*model.HideModelResponse, error) {
	actorID := subjectActorID(ctx)
	if req.GetProviderId() == "" || req.GetModelId() == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "provider_id and model_id required")
	}

	if err := h.providerConfig.HideModel(ctx, actorID, req.GetProviderId(), req.GetModelId()); err != nil {
		return nil, toHandlerError(err)
	}

	return &model.HideModelResponse{Ok: true}, nil
}

func (h *ProviderHandlers) HandleModelHiddenList(ctx context.Context, req *model.GetHiddenModelsRequest) (*model.GetHiddenModelsResponse, error) {
	actorID := subjectActorID(ctx)

	hidden, err := h.providerConfig.GetHiddenModels(ctx, actorID, req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.GetHiddenModelsResponse{HiddenModels: hidden}, nil
}

func providerToProto(p *persistence.AgentProvider) *model.AgentProviderInfo {
	return &model.AgentProviderInfo{
		Id:          p.ID,
		ActorId:     p.ActorID,
		Name:        p.Name,
		DisplayName: p.DisplayName,
		BaseUrl:     p.BaseURL,
		Protocol:    p.Protocol,
		RuntimeKind: p.RuntimeKind,
		CliCommand:  p.CliCommand,
		Enabled:     p.Enabled,
		Version:     p.Version,
		Config:      p.Config,
		CreatedAt:   timestamppb.New(p.CreatedAt),
		UpdatedAt:   timestamppb.New(p.UpdatedAt),
	}
}

func modelToProto(m *persistence.AgentModel) *model.AgentModelInfo {
	return &model.AgentModelInfo{
		Id:          m.ID,
		ActorId:     m.ActorID,
		ProviderId:  m.ProviderID,
		ModelId:     m.ModelID,
		DisplayName: m.DisplayName,
		Enabled:     m.Enabled,
		Version:     m.Version,
		CreatedAt:   timestamppb.New(m.CreatedAt),
		UpdatedAt:   timestamppb.New(m.UpdatedAt),
	}
}

func credentialStatusToProto(s *service.CredentialStatusResponse) *model.CredentialStatusInfo {
	return &model.CredentialStatusInfo{
		ProviderId: s.ProviderID,
		Configured: s.Configured,
		Status:     s.Status,
		Version:    s.Version,
	}
}
