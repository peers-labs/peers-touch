package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ProviderHandlers struct {
	providerConfig    *service.ProviderConfigService
	modelConfig       *service.ModelConfigService
	credentialCfg     *service.CredentialConfigService
	admissionResolver *service.RuntimeAdmissionResolver
}

func NewProviderHandlers(
	providerConfig *service.ProviderConfigService,
	modelConfig *service.ModelConfigService,
	credentialCfg *service.CredentialConfigService,
	admissionResolver *service.RuntimeAdmissionResolver,
) *ProviderHandlers {
	return &ProviderHandlers{
		providerConfig:    providerConfig,
		modelConfig:       modelConfig,
		credentialCfg:     credentialCfg,
		admissionResolver: admissionResolver,
	}
}

func (h *ProviderHandlers) HandleProviderList(ctx context.Context, _ *model.ListProvidersRequest) (*model.ListProvidersResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	userProviders, err := h.providerConfig.List(ctx, actorPTID)
	if err != nil {
		return nil, toHandlerError(err)
	}
	userMatchMap := make(map[string]*persistence.AgentProvider)
	hiddenByProvider := make(map[string][]string)
	for i := range userProviders {
		name := userProviders[i].Name
		if _, exists := userMatchMap[name]; !exists {
			userMatchMap[name] = &userProviders[i]
		}
		if hidden := parseHiddenModels(userProviders[i].HiddenModels); len(hidden) > 0 {
			if _, exists := hiddenByProvider[name]; !exists {
				hiddenByProvider[name] = hidden
			}
		}
	}

	entries := catalog.List()
	resp := &model.ListProvidersResponse{
		Providers: make([]*model.AgentProviderInfo, 0, len(entries)),
	}

	for _, cp := range entries {
		if !catalogProviderAdvertisedByFrozenProfile(cp) ||
			!h.admissionResolver.CatalogProviderAvailable(cp) {
			continue
		}
		userMatch := userMatchMap[cp.ID]

		credentialStatus := "not_configured"
		if userMatch != nil {
			if key := parseKeyVaultAPIKey(userMatch.KeyVaults); key != "" {
				credentialStatus = "configured"
			}
		}

		enabled := cp.Enabled
		version := int64(0)
		if userMatch != nil {
			enabled = userMatch.Enabled
			version = userMatch.Version
		}

		hidden := hiddenByProvider[cp.ID]
		models := make([]*model.ProviderModelInfo, 0, len(cp.Models))
		for _, m := range cp.Models {
			if contains(hidden, m.ID) {
				continue
			}
			info, err := catalogModelToProto(&m)
			if err != nil {
				return nil, server.NewHandlerError(http.StatusConflict, err.Error())
			}
			models = append(models, info)
		}

		catalogIDs := make(map[string]bool, len(models))
		for _, m := range models {
			catalogIDs[m.Id] = true
		}
		dbModels, err := h.modelConfig.List(ctx, actorPTID, cp.ID)
		if err != nil {
			return nil, toHandlerError(err)
		}
		for i := range dbModels {
			if catalogIDs[dbModels[i].ModelID] || contains(hidden, dbModels[i].ModelID) {
				continue
			}
			info, err := persistedModelToProviderProto(&dbModels[i])
			if err != nil {
				return nil, server.NewHandlerError(http.StatusConflict, err.Error())
			}
			models = append(models, info)
		}

		baseURL := cp.DefaultBaseURL
		if userMatch != nil && userMatch.BaseURL != "" {
			baseURL = userMatch.BaseURL
		}

		showAPIKey := true
		if cp.ShowAPIKey != nil {
			showAPIKey = *cp.ShowAPIKey
		}

		resp.Providers = append(resp.Providers, &model.AgentProviderInfo{
			Id:               cp.ID,
			Name:             cp.Name,
			Description:      cp.Description,
			Enabled:          enabled,
			Builtin:          cp.Builtin,
			Protocol:         cp.Protocol,
			Discovery:        cp.Discovery,
			RuntimeKind:      cp.RuntimeKind,
			BaseUrl:          baseURL,
			HomeUrl:          cp.HomeURL,
			ApiKeyUrl:        cp.APIKeyURL,
			ShowChecker:      cp.ShowChecker,
			ShowApiKey:       showAPIKey,
			CredentialStatus: credentialStatus,
			Version:          version,
			Source:           "catalog",
			CliCommand:       cp.CliCommand,
			ModelsCommand:    cp.ModelsCommand,
			Models:           models,
		})
	}

	for _, up := range userProviders {
		if catalog.Find(up.Name) != nil {
			continue
		}
		if !h.admissionResolver.ProviderRuntimeAvailable(
			up.RuntimeKind,
			up.Protocol,
		) {
			continue
		}
		p := providerToProto(&up)
		dbModels, err := h.modelConfig.List(ctx, actorPTID, up.Name)
		if err != nil {
			return nil, toHandlerError(err)
		}
		for i := range dbModels {
			info, err := persistedModelToProviderProto(&dbModels[i])
			if err != nil {
				return nil, server.NewHandlerError(http.StatusConflict, err.Error())
			}
			p.Models = append(p.Models, info)
		}
		resp.Providers = append(resp.Providers, p)
	}

	return resp, nil
}

func (h *ProviderHandlers) HandleProviderCreate(ctx context.Context, req *model.CreateProviderRequest) (*model.CreateProviderResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	provider, err := h.providerConfig.Create(ctx, service.ProviderCreateRequest{
		ActorPTID:   actorPTID,
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

func (h *ProviderHandlers) HandleProviderGet(ctx context.Context, req *model.GetProviderRequest) (*model.GetProviderResponse, error) {
	actorPTID := subjectActorPTID(ctx)
	providerID := req.GetProviderId()

	cp := catalog.Find(providerID)
	userProviders, _ := h.providerConfig.List(ctx, actorPTID)
	var userMatch *persistence.AgentProvider
	for i := range userProviders {
		if userProviders[i].Name == providerID {
			userMatch = &userProviders[i]
			break
		}
	}

	if cp == nil && userMatch == nil {
		return nil, server.NewHandlerError(http.StatusNotFound, "provider not found")
	}
	if cp != nil &&
		(!catalogProviderAdvertisedByFrozenProfile(*cp) ||
			!h.admissionResolver.CatalogProviderAvailable(*cp)) {
		return nil, server.NewHandlerError(http.StatusNotFound, "provider not found")
	}
	if userMatch != nil && !h.admissionResolver.ProviderRuntimeAvailable(
		userMatch.RuntimeKind,
		userMatch.Protocol,
	) {
		return nil, server.NewHandlerError(http.StatusNotFound, "provider not found")
	}

	if cp != nil {
		hidden := parseHiddenModels(func() string {
			if userMatch != nil {
				return userMatch.HiddenModels
			}
			return ""
		}())
		credentialStatus := "not_configured"
		if userMatch != nil {
			if key := parseKeyVaultAPIKey(userMatch.KeyVaults); key != "" {
				credentialStatus = "configured"
			}
		}
		enabled := cp.Enabled
		version := int64(0)
		if userMatch != nil {
			enabled = userMatch.Enabled
			version = userMatch.Version
		}

		models := make([]*model.ProviderModelInfo, 0, len(cp.Models))
		for _, m := range cp.Models {
			if contains(hidden, m.ID) {
				continue
			}
			info, err := catalogModelToProto(&m)
			if err != nil {
				return nil, server.NewHandlerError(http.StatusConflict, err.Error())
			}
			models = append(models, info)
		}

		catalogIDs := make(map[string]bool, len(models))
		for _, m := range models {
			catalogIDs[m.Id] = true
		}
		dbModels, err := h.modelConfig.List(ctx, actorPTID, providerID)
		if err != nil {
			return nil, toHandlerError(err)
		}
		for i := range dbModels {
			if catalogIDs[dbModels[i].ModelID] || contains(hidden, dbModels[i].ModelID) {
				continue
			}
			info, err := persistedModelToProviderProto(&dbModels[i])
			if err != nil {
				return nil, server.NewHandlerError(http.StatusConflict, err.Error())
			}
			models = append(models, info)
		}

		showAPIKey := true
		if cp.ShowAPIKey != nil {
			showAPIKey = *cp.ShowAPIKey
		}

		baseURL := cp.DefaultBaseURL
		apiKey := ""
		if userMatch != nil {
			if userMatch.BaseURL != "" {
				baseURL = userMatch.BaseURL
			}
			apiKey = parseKeyVaultAPIKey(userMatch.KeyVaults)
		}
		_ = apiKey

		return &model.GetProviderResponse{Provider: &model.AgentProviderInfo{
			Id:               cp.ID,
			Name:             cp.Name,
			Description:      cp.Description,
			Enabled:          enabled,
			Builtin:          cp.Builtin,
			Protocol:         cp.Protocol,
			Discovery:        cp.Discovery,
			RuntimeKind:      cp.RuntimeKind,
			BaseUrl:          baseURL,
			HomeUrl:          cp.HomeURL,
			ApiKeyUrl:        cp.APIKeyURL,
			ShowChecker:      cp.ShowChecker,
			ShowApiKey:       showAPIKey,
			CredentialStatus: credentialStatus,
			Version:          version,
			Source:           "catalog",
			CliCommand:       cp.CliCommand,
			ModelsCommand:    cp.ModelsCommand,
			Models:           models,
		}}, nil
	}

	p := providerToProto(userMatch)
	dbModels, err := h.modelConfig.List(ctx, actorPTID, userMatch.Name)
	if err != nil {
		return nil, toHandlerError(err)
	}
	for i := range dbModels {
		info, err := persistedModelToProviderProto(&dbModels[i])
		if err != nil {
			return nil, server.NewHandlerError(http.StatusConflict, err.Error())
		}
		p.Models = append(p.Models, info)
	}
	return &model.GetProviderResponse{Provider: p}, nil
}

func (h *ProviderHandlers) HandleProviderUpdate(ctx context.Context, req *model.UpdateProviderRequest) (*model.UpdateProviderResponse, error) {
	actorPTID := subjectActorPTID(ctx)
	providerID := req.GetProviderId()

	userProviders, _ := h.providerConfig.List(ctx, actorPTID)
	var existing *persistence.AgentProvider
	for i := range userProviders {
		if userProviders[i].Name == providerID {
			existing = &userProviders[i]
			break
		}
	}

	var provider *persistence.AgentProvider
	var err error

	if existing != nil {
		provider, err = h.providerConfig.Update(ctx, service.ProviderUpdateRequest{
			ActorPTID:   actorPTID,
			ProviderID:  providerID,
			Version:     req.GetVersion(),
			DisplayName: req.DisplayName,
			BaseURL:     req.BaseUrl,
			Enabled:     req.Enabled,
			ConfigJSON:  req.GetConfigJson(),
		})
	} else {
		cp := catalog.Find(providerID)
		displayName := providerID
		protocol := "openai-compatible"
		baseURL := ""
		if cp != nil {
			displayName = cp.Name
			protocol = cp.Protocol
			baseURL = cp.DefaultBaseURL
		}
		if req.BaseUrl != nil {
			baseURL = *req.BaseUrl
		}
		enabled := true
		if req.Enabled != nil {
			enabled = *req.Enabled
		}

		provider, err = h.providerConfig.Create(ctx, service.ProviderCreateRequest{
			ActorPTID:   actorPTID,
			ProviderID:  providerID,
			DisplayName: displayName,
			BaseURL:     baseURL,
			Protocol:    protocol,
			ConfigJSON:  nil,
		})
		if err == nil && !enabled {
			provider, err = h.providerConfig.Update(ctx, service.ProviderUpdateRequest{
				ActorPTID:  actorPTID,
				ProviderID: providerID,
				Version:    provider.Version,
				Enabled:    &enabled,
			})
		}
	}
	if err != nil {
		return nil, toHandlerError(err)
	}

	if kv := req.GetKeyVaults(); kv != "" {
		if apiKey := parseKeyVaultAPIKey(kv); apiKey != "" {
			if _, credentialErr := h.credentialCfg.Set(ctx, service.CredentialSetRequest{
				ActorPTID:  actorPTID,
				ProviderID: providerID,
				APIKey:     apiKey,
			}); credentialErr != nil {
				return nil, toHandlerError(credentialErr)
			}
		}
	}

	return &model.UpdateProviderResponse{Provider: providerToProto(provider)}, nil
}

func (h *ProviderHandlers) HandleListAvailableModels(ctx context.Context, _ *model.ListAvailableModelsRequest) (*model.ListAvailableModelsResponse, error) {
	actorID := subjectActorID(ctx)

	models, err := h.admissionResolver.ListAvailableModels(ctx, actorID)
	if err != nil {
		return nil, toHandlerError(err)
	}

	resp := &model.ListAvailableModelsResponse{
		Models: make([]*model.AvailableModelInfo, 0, len(models)),
	}
	for _, m := range models {
		resp.Models = append(resp.Models, &model.AvailableModelInfo{
			Id:            m.ID,
			ProviderId:    m.ProviderID,
			ProviderName:  m.ProviderName,
			DisplayName:   m.DisplayName,
			Type:          m.Type,
			Enabled:       m.Enabled,
			ContextWindow: m.ContextWindow,
			Capabilities:  modelCapabilityConfig(m.Capabilities),
		})
	}

	return resp, nil
}

func catalogProviderAdvertisedByFrozenProfile(cp catalog.CatalogProvider) bool {
	return providerAdvertisedByFrozenProfile(cp.RuntimeKind, cp.Protocol)
}

func runtimeAdvertisedByFrozenProfile(runtimeKind string) bool {
	return service.ProviderRuntimeAdvertised(runtimeKind, "openai-compatible")
}

func providerAdvertisedByFrozenProfile(runtimeKind, protocol string) bool {
	return service.ProviderRuntimeAdvertised(runtimeKind, protocol)
}

func (h *ProviderHandlers) HandleProviderDelete(ctx context.Context, req *model.DeleteProviderRequest) (*model.DeleteProviderResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	if err := h.providerConfig.Delete(ctx, service.ProviderDeleteRequest{
		ActorPTID:  actorPTID,
		ProviderID: req.GetProviderId(),
		Version:    req.GetVersion(),
	}); err != nil {
		return nil, toHandlerError(err)
	}

	return &model.DeleteProviderResponse{Deleted: true}, nil
}

func (h *ProviderHandlers) HandleModelList(ctx context.Context, req *model.ListModelsRequest) (*model.ListModelsResponse, error) {
	actorID := subjectActorID(ctx)
	providerID := req.GetProviderId()

	if cp := catalog.Find(providerID); cp != nil {
		if !catalogProviderAdvertisedByFrozenProfile(*cp) ||
			!h.admissionResolver.CatalogProviderAvailable(*cp) {
			return &model.ListModelsResponse{}, nil
		}
	}
	providers, err := h.providerConfig.List(ctx, actorID)
	if err != nil {
		return nil, toHandlerError(err)
	}
	for i := range providers {
		if providers[i].Name == providerID &&
			!h.admissionResolver.ProviderRuntimeAvailable(
				providers[i].RuntimeKind,
				providers[i].Protocol,
			) {
			return &model.ListModelsResponse{}, nil
		}
	}

	models, err := h.modelConfig.List(ctx, actorID, providerID)
	if err != nil {
		return nil, toHandlerError(err)
	}

	resp := &model.ListModelsResponse{
		Models: make([]*model.AgentModelInfo, 0, len(models)),
	}
	for i := range models {
		info, convertErr := modelToProto(&models[i])
		if convertErr != nil {
			return nil, server.NewHandlerError(http.StatusConflict, convertErr.Error())
		}
		resp.Models = append(resp.Models, info)
	}
	return resp, nil
}

func (h *ProviderHandlers) HandleModelCreate(ctx context.Context, req *model.CreateModelRequest) (*model.CreateModelResponse, error) {
	actorPTID := subjectActorPTID(ctx)
	providerID := req.GetProviderId()
	modelID := req.GetModelId()

	if providerID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "provider_id is required")
	}
	if modelID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "model_id is required")
	}

	if err := h.ensureProviderRecord(ctx, actorPTID, providerID); err != nil {
		return nil, toHandlerError(err)
	}

	m, err := h.modelConfig.Create(ctx, service.ModelCreateRequest{
		ActorPTID:     actorPTID,
		ProviderID:    providerID,
		ModelID:       modelID,
		DisplayName:   req.GetDisplayName(),
		Enabled:       req.GetEnabled(),
		Capabilities:  capabilityFlags(req.GetCapabilities()),
		ContextWindow: int(req.GetContextWindow()),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	_ = h.providerConfig.UnhideModel(ctx, actorPTID, providerID, modelID)

	info, err := modelToProto(m)
	if err != nil {
		return nil, server.NewHandlerError(http.StatusConflict, err.Error())
	}
	return &model.CreateModelResponse{Model: info}, nil
}

func (h *ProviderHandlers) HandleModelUpdate(ctx context.Context, req *model.UpdateModelRequest) (*model.UpdateModelResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	m, err := h.modelConfig.Update(ctx, service.ModelUpdateRequest{
		ActorPTID:     actorPTID,
		ProviderID:    req.GetProviderId(),
		ModelID:       req.GetModelId(),
		Version:       req.GetVersion(),
		DisplayName:   req.DisplayName,
		Enabled:       req.Enabled,
		Capabilities:  capabilityFlags(req.GetCapabilities()),
		ContextWindow: int32PtrToInt(req.ContextWindow),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	info, err := modelToProto(m)
	if err != nil {
		return nil, server.NewHandlerError(http.StatusConflict, err.Error())
	}
	return &model.UpdateModelResponse{Model: info}, nil
}

func (h *ProviderHandlers) HandleCredentialSet(ctx context.Context, req *model.SetCredentialRequest) (*model.SetCredentialResponse, error) {
	actorPTID := subjectActorID(ctx)
	if req.GetProviderId() == "" || req.GetApiKey() == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "provider_id and api_key are required")
	}

	status, err := h.credentialCfg.Set(ctx, service.CredentialSetRequest{
		ActorPTID:  actorPTID,
		ProviderID: req.GetProviderId(),
		APIKey:     req.GetApiKey(),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.SetCredentialResponse{Status: credentialStatusToProto(status)}, nil
}

func (h *ProviderHandlers) HandleCredentialDelete(ctx context.Context, req *model.DeleteCredentialRequest) (*model.DeleteCredentialResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	if err := h.credentialCfg.Delete(ctx, service.CredentialDeleteRequest{
		ActorPTID:  actorPTID,
		ProviderID: req.GetProviderId(),
		Version:    req.GetVersion(),
	}); err != nil {
		return nil, toHandlerError(err)
	}

	return &model.DeleteCredentialResponse{Deleted: true}, nil
}

func (h *ProviderHandlers) HandleCredentialStatus(ctx context.Context, req *model.GetCredentialStatusRequest) (*model.GetCredentialStatusResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	status, err := h.credentialCfg.Status(ctx, actorPTID, req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.GetCredentialStatusResponse{Status: credentialStatusToProto(status)}, nil
}

func (h *ProviderHandlers) HandleCredentialResolve(ctx context.Context, req *model.ResolveCredentialRequest) (*model.ResolveCredentialResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	resolved, err := h.credentialCfg.Resolve(ctx, actorPTID, req.GetProviderId())
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
	actorPTID := subjectActorPTID(ctx)
	if req.GetProviderId() == "" || req.GetModelId() == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "provider_id and model_id required")
	}

	providerID := req.GetProviderId()
	if err := h.ensureProviderRecord(ctx, actorPTID, providerID); err != nil {
		return nil, toHandlerError(err)
	}

	if err := h.providerConfig.HideModel(ctx, actorPTID, providerID, req.GetModelId()); err != nil {
		return nil, toHandlerError(err)
	}

	return &model.HideModelResponse{Ok: true}, nil
}

func (h *ProviderHandlers) HandleModelHiddenList(ctx context.Context, req *model.GetHiddenModelsRequest) (*model.GetHiddenModelsResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	hidden, err := h.providerConfig.GetHiddenModels(ctx, actorPTID, req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}

	return &model.GetHiddenModelsResponse{HiddenModels: hidden}, nil
}

func providerToProto(p *persistence.AgentProvider) *model.AgentProviderInfo {
	cp := catalog.Find(p.Name)
	info := &model.AgentProviderInfo{
		Id:            p.Name,
		Name:          p.DisplayName,
		Enabled:       p.Enabled,
		Protocol:      p.Protocol,
		RuntimeKind:   p.RuntimeKind,
		BaseUrl:       p.BaseURL,
		CliCommand:    p.CliCommand,
		ModelsCommand: p.ModelsCommand,
		Version:       p.Version,
		Source:        "custom",
	}
	if cp != nil && catalogProviderAdvertisedByFrozenProfile(*cp) {
		info.Source = "catalog"
		info.Description = cp.Description
		info.Builtin = cp.Builtin
		info.Discovery = cp.Discovery
		info.HomeUrl = cp.HomeURL
		info.ApiKeyUrl = cp.APIKeyURL
		info.ShowChecker = cp.ShowChecker
		if cp.ShowAPIKey != nil {
			info.ShowApiKey = *cp.ShowAPIKey
		} else {
			info.ShowApiKey = true
		}
		if info.BaseUrl == "" {
			info.BaseUrl = cp.DefaultBaseURL
		}
		if info.Protocol == "" {
			info.Protocol = cp.Protocol
		}
	}
	if key := parseKeyVaultAPIKey(p.KeyVaults); key != "" {
		info.CredentialStatus = "configured"
	} else {
		info.CredentialStatus = "not_configured"
	}
	return info
}

func modelToProto(m *persistence.AgentModel) (*model.AgentModelInfo, error) {
	capabilities, err := persistedModelCapabilityConfig(m)
	if err != nil {
		return nil, err
	}
	return &model.AgentModelInfo{
		Id:            m.ID,
		ActorPtid:     m.ActorPTID,
		ProviderId:    m.ProviderID,
		ModelId:       m.ModelID,
		DisplayName:   m.DisplayName,
		Enabled:       m.Enabled,
		Version:       m.Version,
		CreatedAt:     timestamppb.New(m.CreatedAt),
		UpdatedAt:     timestamppb.New(m.UpdatedAt),
		ContextWindow: int32(m.ContextWindow),
		Capabilities:  capabilities,
	}, nil
}

func catalogModelToProto(m *catalog.CatalogModel) (*model.ProviderModelInfo, error) {
	flags, err := service.ModelCapabilityFlagsFromNames(m.Capabilities)
	if err != nil {
		return nil, fmt.Errorf("model %q capability metadata is invalid: %w", m.ID, err)
	}
	return &model.ProviderModelInfo{
		Id:            m.ID,
		DisplayName:   m.DisplayName,
		Type:          m.Type,
		Enabled:       m.Enabled,
		ContextWindow: int32(m.ContextWindow),
		Capabilities:  modelCapabilityConfig(flags),
	}, nil
}

func persistedModelToProviderProto(m *persistence.AgentModel) (*model.ProviderModelInfo, error) {
	capabilities, err := persistedModelCapabilityConfig(m)
	if err != nil {
		return nil, err
	}
	return &model.ProviderModelInfo{
		Id:            m.ModelID,
		DisplayName:   m.DisplayName,
		Type:          "chat",
		Enabled:       m.Enabled,
		ContextWindow: int32(m.ContextWindow),
		Capabilities:  capabilities,
	}, nil
}

func persistedModelCapabilityConfig(m *persistence.AgentModel) (*model.ModelCapabilityConfig, error) {
	flags, err := service.DecodeModelCapabilityFlags(m.CapabilitiesJSON)
	if err != nil {
		return nil, fmt.Errorf("model %q capability metadata is invalid: %w", m.ModelID, err)
	}
	return modelCapabilityConfig(flags), nil
}

func modelCapabilityConfig(flags map[string]bool) *model.ModelCapabilityConfig {
	if flags == nil {
		return nil
	}
	return &model.ModelCapabilityConfig{Flags: flags}
}

func capabilityFlags(config *model.ModelCapabilityConfig) map[string]bool {
	if config == nil {
		return nil
	}
	return config.GetFlags()
}

func int32PtrToInt(value *int32) *int {
	if value == nil {
		return nil
	}
	converted := int(*value)
	return &converted
}

func credentialStatusToProto(s *service.CredentialStatusResponse) *model.CredentialStatusInfo {
	return &model.CredentialStatusInfo{
		ProviderId: s.ProviderID,
		Configured: s.Configured,
		Status:     s.Status,
		Version:    s.Version,
	}
}

func parseHiddenModels(raw string) []string {
	if raw == "" {
		return nil
	}
	var models []string
	_ = json.Unmarshal([]byte(raw), &models)
	return models
}

func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

func parseKeyVaultAPIKey(kv string) string {
	var m map[string]interface{}
	if err := json.Unmarshal([]byte(kv), &m); err != nil {
		return ""
	}
	if v, ok := m["api_key"].(string); ok {
		return v
	}
	return ""
}

// ensureProviderRecord creates a DB record for the provider if one doesn't
// exist yet. This handles the first-activation case for catalog providers
// that appear enabled by default but have no user-specific DB state.
func (h *ProviderHandlers) ensureProviderRecord(ctx context.Context, actorPTID, providerID string) error {
	providers, _ := h.providerConfig.List(ctx, actorPTID)
	for i := range providers {
		if providers[i].Name == providerID {
			return nil
		}
	}

	cp := catalog.Find(providerID)
	displayName := providerID
	protocol := "openai-compatible"
	baseURL := ""
	if cp != nil {
		displayName = cp.Name
		protocol = cp.Protocol
		baseURL = cp.DefaultBaseURL
	}

	_, err := h.providerConfig.Create(ctx, service.ProviderCreateRequest{
		ActorPTID:   actorPTID,
		ProviderID:  providerID,
		DisplayName: displayName,
		BaseURL:     baseURL,
		Protocol:    protocol,
	})
	return err
}
