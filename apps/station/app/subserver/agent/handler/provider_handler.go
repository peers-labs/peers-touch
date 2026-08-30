package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
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

func (h *ProviderHandlers) HandleFetchCliModels(_ context.Context, req *model.FetchCliModelsRequest) (*model.FetchCliModelsResponse, error) {
	providerID := req.GetProviderId()
	if providerID == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "provider_id is required")
	}

	cp := catalog.Find(providerID)
	if cp == nil {
		return nil, server.NewHandlerError(http.StatusNotFound, "provider not found in catalog")
	}
	if cp.ModelsCommand == "" {
		return nil, server.NewHandlerError(http.StatusBadRequest, "provider has no models_command")
	}

	models, err := cli.FetchModels(cp.ModelsCommand)
	if err != nil {
		return nil, server.NewHandlerError(http.StatusInternalServerError, err.Error())
	}

	return &model.FetchCliModelsResponse{Models: models}, nil
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
			models = append(models, &model.ProviderModelInfo{
				Id:            m.ID,
				DisplayName:   m.DisplayName,
				Type:          m.Type,
				Enabled:       m.Enabled,
				ContextWindow: int32(m.ContextWindow),
			})
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
			models = append(models, &model.ProviderModelInfo{
				Id:            dbModels[i].ModelID,
				DisplayName:   dbModels[i].DisplayName,
				Type:          "chat",
				Enabled:       dbModels[i].Enabled,
				ContextWindow: int32(dbModels[i].ContextWindow),
			})
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
		p := providerToProto(&up)
		dbModels, err := h.modelConfig.List(ctx, actorPTID, up.Name)
		if err != nil {
			return nil, toHandlerError(err)
		}
		for i := range dbModels {
			p.Models = append(p.Models, &model.ProviderModelInfo{
				Id:            dbModels[i].ModelID,
				DisplayName:   dbModels[i].DisplayName,
				Type:          "chat",
				Enabled:       dbModels[i].Enabled,
				ContextWindow: int32(dbModels[i].ContextWindow),
			})
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
			models = append(models, &model.ProviderModelInfo{
				Id:            m.ID,
				DisplayName:   m.DisplayName,
				Type:          m.Type,
				Enabled:       m.Enabled,
				ContextWindow: int32(m.ContextWindow),
			})
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
			models = append(models, &model.ProviderModelInfo{
				Id:            dbModels[i].ModelID,
				DisplayName:   dbModels[i].DisplayName,
				Type:          "chat",
				Enabled:       dbModels[i].Enabled,
				ContextWindow: int32(dbModels[i].ContextWindow),
			})
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
		p.Models = append(p.Models, &model.ProviderModelInfo{
			Id:            dbModels[i].ModelID,
			DisplayName:   dbModels[i].DisplayName,
			Type:          "chat",
			Enabled:       dbModels[i].Enabled,
			ContextWindow: int32(dbModels[i].ContextWindow),
		})
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
			_, _ = h.credentialCfg.Set(ctx, service.CredentialSetRequest{
				ActorPTID:  actorPTID,
				ProviderID: providerID,
				APIKey:     apiKey,
			})
		}
	}

	return &model.UpdateProviderResponse{Provider: providerToProto(provider)}, nil
}

func (h *ProviderHandlers) HandleListAvailableModels(ctx context.Context, _ *model.ListAvailableModelsRequest) (*model.ListAvailableModelsResponse, error) {
	actorPTID := subjectActorPTID(ctx)
	userProviders, _ := h.providerConfig.List(ctx, actorPTID)

	entries := catalog.List()
	resp := &model.ListAvailableModelsResponse{}

	for _, cp := range entries {
		var userMatch *persistence.AgentProvider
		for i := range userProviders {
			if userProviders[i].Name == cp.ID {
				userMatch = &userProviders[i]
				break
			}
		}

		enabled := cp.Enabled
		if userMatch != nil {
			enabled = userMatch.Enabled
		}
		if !enabled {
			continue
		}

		hidden := parseHiddenModels(func() string {
			if userMatch != nil {
				return userMatch.HiddenModels
			}
			return ""
		}())

		catalogIDs := make(map[string]bool, len(cp.Models))
		for _, m := range cp.Models {
			catalogIDs[m.ID] = true
			if !m.Enabled || contains(hidden, m.ID) {
				continue
			}
			resp.Models = append(resp.Models, &model.AvailableModelInfo{
				Id:            m.ID,
				ProviderId:    cp.ID,
				ProviderName:  cp.Name,
				DisplayName:   m.DisplayName,
				Type:          m.Type,
				Enabled:       m.Enabled,
				ContextWindow: int32(m.ContextWindow),
			})
		}

		dbModels, _ := h.modelConfig.List(ctx, actorPTID, cp.ID)
		for i := range dbModels {
			if !dbModels[i].Enabled || catalogIDs[dbModels[i].ModelID] || contains(hidden, dbModels[i].ModelID) {
				continue
			}
			resp.Models = append(resp.Models, &model.AvailableModelInfo{
				Id:            dbModels[i].ModelID,
				ProviderId:    cp.ID,
				ProviderName:  cp.Name,
				DisplayName:   dbModels[i].DisplayName,
				Type:          "chat",
				Enabled:       dbModels[i].Enabled,
				ContextWindow: int32(dbModels[i].ContextWindow),
			})
		}
	}

	return resp, nil
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
	actorPTID := subjectActorPTID(ctx)

	models, err := h.modelConfig.List(ctx, actorPTID, req.GetProviderId())
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
		ContextWindow: int(req.GetContextWindow()),
	})
	if err != nil {
		return nil, toHandlerError(err)
	}

	_ = h.providerConfig.UnhideModel(ctx, actorPTID, providerID, modelID)

	return &model.CreateModelResponse{Model: modelToProto(m)}, nil
}

func (h *ProviderHandlers) HandleModelUpdate(ctx context.Context, req *model.UpdateModelRequest) (*model.UpdateModelResponse, error) {
	actorPTID := subjectActorPTID(ctx)

	m, err := h.modelConfig.Update(ctx, service.ModelUpdateRequest{
		ActorPTID:   actorPTID,
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
	actorPTID := subjectActorPTID(ctx)

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
	if cp != nil {
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
		if info.RuntimeKind == "" {
			info.RuntimeKind = cp.RuntimeKind
		}
		if info.CliCommand == "" {
			info.CliCommand = cp.CliCommand
		}
		if info.ModelsCommand == "" {
			info.ModelsCommand = cp.ModelsCommand
		}
	}
	if key := parseKeyVaultAPIKey(p.KeyVaults); key != "" {
		info.CredentialStatus = "configured"
	} else {
		info.CredentialStatus = "not_configured"
	}
	return info
}

func modelToProto(m *persistence.AgentModel) *model.AgentModelInfo {
	return &model.AgentModelInfo{
		Id:          m.ID,
		ActorPtid:   m.ActorPTID,
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
