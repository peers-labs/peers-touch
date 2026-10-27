package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	providercli "github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

type ProviderHandlers struct {
	providerConfig    *service.ProviderConfigService
	modelConfig       *service.ModelConfigService
	credentialCfg     *service.CredentialConfigService
	admissionResolver *service.RuntimeAdmissionResolver
	runtimeModels     *service.RuntimeModelCatalog
	modelDiscovery    *service.ProviderModelDiscoveryService
	runtimeDefaults   *service.RuntimeDefaultService
}

func NewProviderHandlers(
	providerConfig *service.ProviderConfigService,
	modelConfig *service.ModelConfigService,
	credentialCfg *service.CredentialConfigService,
	admissionResolver *service.RuntimeAdmissionResolver,
	runtimeModels *service.RuntimeModelCatalog,
	modelDiscovery *service.ProviderModelDiscoveryService,
	runtimeDefaults *service.RuntimeDefaultService,
) *ProviderHandlers {
	return &ProviderHandlers{
		providerConfig:    providerConfig,
		modelConfig:       modelConfig,
		credentialCfg:     credentialCfg,
		admissionResolver: admissionResolver,
		runtimeModels:     runtimeModels,
		modelDiscovery:    modelDiscovery,
		runtimeDefaults:   runtimeDefaults,
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

	for _, catalogProvider := range entries {
		cp := h.runtimeModels.EffectiveProvider(actorPTID, catalogProvider)
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

		dbModels, err := h.modelConfig.List(ctx, actorPTID, cp.ID)
		if err != nil {
			return nil, toHandlerError(err)
		}
		models, err := effectiveCatalogProviderModels(&cp, dbModels, hiddenByProvider[cp.ID])
		if err != nil {
			return nil, server.NewHandlerError(http.StatusConflict, err.Error())
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
			CliCommand:       catalog.FormatArgv(cp.CLIArgv),
			Models:           models,
			RuntimeConfig: service.EffectiveProviderRuntimeConfig(
				&cp,
				userMatch,
			),
			DefaultRuntimeConfig: service.DefaultProviderRuntimeConfig(&cp),
			AdapterCapabilities:  providerAdapterCapabilities(&cp),
			WorkspacePolicy:      cp.WorkspacePolicy,
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

	cp := h.effectiveCatalogProvider(actorPTID, providerID)
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

		dbModels, err := h.modelConfig.List(ctx, actorPTID, providerID)
		if err != nil {
			return nil, toHandlerError(err)
		}
		models, err := effectiveCatalogProviderModels(cp, dbModels, hidden)
		if err != nil {
			return nil, server.NewHandlerError(http.StatusConflict, err.Error())
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
			CliCommand:       catalog.FormatArgv(cp.CLIArgv),
			Models:           models,
			RuntimeConfig: service.EffectiveProviderRuntimeConfig(
				cp,
				userMatch,
			),
			DefaultRuntimeConfig: service.DefaultProviderRuntimeConfig(cp),
			AdapterCapabilities:  providerAdapterCapabilities(cp),
			WorkspacePolicy:      cp.WorkspacePolicy,
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
	configJSON := req.GetConfigJson()
	if req.RuntimeConfig != nil {
		encoded, encodeErr := service.EncodeProviderRuntimeConfig(
			h.effectiveCatalogProvider(actorPTID, providerID),
			req.GetRuntimeConfig(),
		)
		if encodeErr != nil {
			return nil, server.NewHandlerError(http.StatusBadRequest, encodeErr.Error())
		}
		configJSON = encoded
	}

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
			ConfigJSON:  configJSON,
		})
	} else {
		cp := h.effectiveCatalogProvider(actorPTID, providerID)
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
			ConfigJSON:  configJSON,
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

func (h *ProviderHandlers) HandleProviderCheck(
	ctx context.Context,
	req *model.CheckProviderRequest,
) (*model.CheckProviderResponse, error) {
	actorPTID := subjectActorPTID(ctx)
	providerID := strings.TrimSpace(req.GetProviderId())
	cp := h.effectiveCatalogProvider(actorPTID, providerID)
	if cp == nil {
		return nil, server.NewHandlerError(http.StatusNotFound, "provider not found")
	}
	if strings.EqualFold(cp.RuntimeKind, "cli") {
		result := providercli.VerifyCliBinary(cp.CLIArgv)
		return &model.CheckProviderResponse{
			Ok:          result.Available,
			Program:     result.Program,
			Error:       result.Error,
			InstallHint: result.InstallHint,
		}, nil
	}

	userProvider, err := h.findUserProvider(ctx, actorPTID, providerID)
	if err != nil {
		return nil, toHandlerError(err)
	}
	requiresAPIKey := cp.ShowAPIKey == nil || *cp.ShowAPIKey
	if requiresAPIKey &&
		(userProvider == nil || parseKeyVaultAPIKey(userProvider.KeyVaults) == "") {
		return &model.CheckProviderResponse{
			Ok:    false,
			Error: "provider credential is not configured",
		}, nil
	}
	return &model.CheckProviderResponse{Ok: true}, nil
}

func (h *ProviderHandlers) HandleDiscoverProviderModels(
	ctx context.Context,
	req *model.DiscoverProviderModelsRequest,
) (*model.DiscoverProviderModelsResponse, error) {
	actorPTID := subjectActorPTID(ctx)
	providerID := strings.TrimSpace(req.GetProviderId())
	cp := h.effectiveCatalogProvider(actorPTID, providerID)
	if cp == nil {
		return nil, server.NewHandlerError(http.StatusNotFound, "provider not found")
	}
	if len(cp.ModelCatalogArgv) == 0 {
		return nil, server.NewHandlerError(
			http.StatusBadRequest,
			"provider does not support model discovery",
		)
	}
	userProvider, err := h.findUserProvider(ctx, actorPTID, providerID)
	if err != nil {
		return nil, toHandlerError(err)
	}
	models, observedAt, err := h.modelDiscovery.Discover(
		ctx,
		actorPTID,
		cp,
		userProvider,
	)
	if err != nil {
		return nil, server.NewHandlerError(http.StatusBadGateway, err.Error())
	}

	response := &model.DiscoverProviderModelsResponse{
		Models:     make([]*model.ProviderModelInfo, 0, len(models)),
		ObservedAt: timestamppb.New(observedAt),
	}
	for i := range models {
		info, projectionErr := catalogModelToProto(&models[i])
		if projectionErr != nil {
			return nil, server.NewHandlerError(http.StatusConflict, projectionErr.Error())
		}
		response.Models = append(response.Models, info)
	}
	return response, nil
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
	actorPTID := subjectActorPTID(ctx)
	providerID := req.GetProviderId()

	cp := h.effectiveCatalogProvider(actorPTID, providerID)
	if cp != nil {
		if !catalogProviderAdvertisedByFrozenProfile(*cp) ||
			!h.admissionResolver.CatalogProviderAvailable(*cp) {
			return &model.ListModelsResponse{}, nil
		}
	}
	providers, err := h.providerConfig.List(ctx, actorPTID)
	if err != nil {
		return nil, toHandlerError(err)
	}
	var hidden []string
	for i := range providers {
		if providers[i].Name != providerID {
			continue
		}
		if !h.admissionResolver.ProviderRuntimeAvailable(
			providers[i].RuntimeKind,
			providers[i].Protocol,
		) {
			return &model.ListModelsResponse{}, nil
		}
		hidden = parseHiddenModels(providers[i].HiddenModels)
		break
	}

	models, err := h.modelConfig.List(ctx, actorPTID, providerID)
	if err != nil {
		return nil, toHandlerError(err)
	}

	resp := &model.ListModelsResponse{
		Models: make([]*model.AgentModelInfo, 0, len(models)),
	}
	if cp != nil {
		effectiveModels, projectionErr := effectiveCatalogAgentModels(
			actorPTID,
			cp,
			models,
			hidden,
		)
		if projectionErr != nil {
			return nil, server.NewHandlerError(http.StatusConflict, projectionErr.Error())
		}
		resp.Models = effectiveModels

		return resp, nil
	}

	for i := range models {
		if contains(hidden, models[i].ModelID) {
			continue
		}
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
	if err := h.ensureProviderModelsMutable(actorPTID, providerID); err != nil {
		return nil, err
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

	if err := h.providerConfig.UnhideModel(ctx, actorPTID, providerID, modelID); err != nil {
		return nil, toHandlerError(err)
	}

	info, err := modelToProto(m)
	if err != nil {
		return nil, server.NewHandlerError(http.StatusConflict, err.Error())
	}
	return &model.CreateModelResponse{Model: info}, nil
}

func (h *ProviderHandlers) HandleModelUpdate(ctx context.Context, req *model.UpdateModelRequest) (*model.UpdateModelResponse, error) {
	actorPTID := subjectActorPTID(ctx)
	if err := h.ensureProviderModelsMutable(actorPTID, req.GetProviderId()); err != nil {
		return nil, err
	}

	updateRequest := service.ModelUpdateRequest{
		ActorPTID:     actorPTID,
		ProviderID:    req.GetProviderId(),
		ModelID:       req.GetModelId(),
		Version:       req.GetVersion(),
		DisplayName:   req.DisplayName,
		Enabled:       req.Enabled,
		Capabilities:  capabilityFlags(req.GetCapabilities()),
		ContextWindow: int32PtrToInt(req.ContextWindow),
	}
	persistedModels, err := h.modelConfig.List(ctx, actorPTID, req.GetProviderId())
	if err != nil {
		return nil, toHandlerError(err)
	}
	for i := range persistedModels {
		if persistedModels[i].ModelID != req.GetModelId() {
			continue
		}
		updated, updateErr := h.modelConfig.Update(ctx, updateRequest)
		if updateErr != nil {
			return nil, toHandlerError(updateErr)
		}

		info, projectionErr := modelToProto(updated)
		if projectionErr != nil {
			return nil, server.NewHandlerError(http.StatusConflict, projectionErr.Error())
		}

		return &model.UpdateModelResponse{Model: info}, nil
	}

	catalogModel := h.findCatalogModel(
		actorPTID,
		req.GetProviderId(),
		req.GetModelId(),
	)
	if req.GetVersion() != 0 || catalogModel == nil {
		_, updateErr := h.modelConfig.Update(ctx, updateRequest)

		return nil, toHandlerError(updateErr)
	}
	if err := h.ensureProviderRecord(
		ctx,
		actorPTID,
		req.GetProviderId(),
	); err != nil {
		return nil, toHandlerError(err)
	}

	createRequest, err := catalogModelCreateRequest(
		actorPTID,
		req.GetProviderId(),
		catalogModel,
		req,
	)
	if err != nil {
		return nil, server.NewHandlerError(http.StatusConflict, err.Error())
	}
	created, err := h.modelConfig.Create(ctx, createRequest)
	if err != nil {
		return nil, toHandlerError(err)
	}
	if err := h.providerConfig.UnhideModel(
		ctx,
		actorPTID,
		req.GetProviderId(),
		req.GetModelId(),
	); err != nil {
		return nil, toHandlerError(err)
	}

	info, err := modelToProto(created)
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
	if err := h.ensureProviderModelsMutable(actorPTID, providerID); err != nil {
		return nil, err
	}
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
		Id:          p.Name,
		Name:        p.DisplayName,
		Enabled:     p.Enabled,
		Protocol:    p.Protocol,
		RuntimeKind: p.RuntimeKind,
		BaseUrl:     p.BaseURL,
		Version:     p.Version,
		Source:      "custom",
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
		if strings.EqualFold(strings.TrimSpace(p.RuntimeKind), "cli") {
			info.CliCommand = catalog.FormatArgv(cp.CLIArgv)
			info.RuntimeConfig = service.EffectiveProviderRuntimeConfig(cp, p)
			info.DefaultRuntimeConfig = service.DefaultProviderRuntimeConfig(cp)
			info.AdapterCapabilities = providerAdapterCapabilities(cp)
			info.WorkspacePolicy = cp.WorkspacePolicy
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
		Id:                    m.ID,
		DisplayName:           m.DisplayName,
		Type:                  m.Type,
		Enabled:               m.Enabled,
		ContextWindow:         int32(m.ContextWindow),
		Capabilities:          modelCapabilityConfig(flags),
		Description:           m.Description,
		DefaultReasoningLevel: m.DefaultReasoningLevel,
		SupportedReasoningLevels: append(
			[]string(nil),
			m.SupportedReasoningLevels...,
		),
	}, nil
}

func effectiveCatalogProviderModels(
	provider *catalog.CatalogProvider,
	persistedModels []persistence.AgentModel,
	hidden []string,
) ([]*model.ProviderModelInfo, error) {
	if providerIsCLI(provider) {
		persistedModels = nil
		hidden = nil
	}
	effectiveModels, err := service.ResolveEffectiveProviderModels(
		provider,
		persistedModels,
		hidden,
	)
	if err != nil {
		return nil, err
	}
	result := make([]*model.ProviderModelInfo, 0, len(effectiveModels))
	for _, effectiveModel := range effectiveModels {
		catalogModel := catalogModelByID(provider, effectiveModel.ID)
		description := ""
		defaultReasoningLevel := ""
		var supportedReasoningLevels []string
		if catalogModel != nil {
			description = catalogModel.Description
			defaultReasoningLevel = catalogModel.DefaultReasoningLevel
			supportedReasoningLevels = append(
				[]string(nil),
				catalogModel.SupportedReasoningLevels...,
			)
		}
		result = append(result, &model.ProviderModelInfo{
			Id:                       effectiveModel.ID,
			DisplayName:              effectiveModel.DisplayName,
			Type:                     effectiveModel.Type,
			Enabled:                  effectiveModel.Enabled,
			ContextWindow:            int32(effectiveModel.ContextWindow),
			Capabilities:             modelCapabilityConfig(effectiveModel.Capabilities),
			Description:              description,
			DefaultReasoningLevel:    defaultReasoningLevel,
			SupportedReasoningLevels: supportedReasoningLevels,
		})
	}

	return result, nil
}

func effectiveCatalogAgentModels(
	actorPTID string,
	provider *catalog.CatalogProvider,
	persistedModels []persistence.AgentModel,
	hidden []string,
) ([]*model.AgentModelInfo, error) {
	if providerIsCLI(provider) {
		persistedModels = nil
		hidden = nil
	}
	effectiveModels, err := service.ResolveEffectiveProviderModels(
		provider,
		persistedModels,
		hidden,
	)
	if err != nil {
		return nil, err
	}
	result := make([]*model.AgentModelInfo, 0, len(effectiveModels))
	for _, effectiveModel := range effectiveModels {
		info := &model.AgentModelInfo{
			Id:            effectiveModel.ID,
			ActorPtid:     actorPTID,
			ProviderId:    provider.ID,
			ModelId:       effectiveModel.ID,
			DisplayName:   effectiveModel.DisplayName,
			Enabled:       effectiveModel.Enabled,
			ContextWindow: int32(effectiveModel.ContextWindow),
			Capabilities:  modelCapabilityConfig(effectiveModel.Capabilities),
		}
		if effectiveModel.PersistedModel != nil {
			persistedModel := effectiveModel.PersistedModel
			info.Id = persistedModel.ID
			info.Version = persistedModel.Version
			info.CreatedAt = timestamppb.New(persistedModel.CreatedAt)
			info.UpdatedAt = timestamppb.New(persistedModel.UpdatedAt)
		}
		result = append(result, info)
	}

	return result, nil
}

func (h *ProviderHandlers) findCatalogModel(
	actorPTID string,
	providerID string,
	modelID string,
) *catalog.CatalogModel {
	provider := h.effectiveCatalogProvider(actorPTID, providerID)
	if provider == nil {
		return nil
	}
	for i := range provider.Models {
		if provider.Models[i].ID == modelID {
			return &provider.Models[i]
		}
	}

	return nil
}

func catalogModelCreateRequest(
	actorPTID string,
	providerID string,
	catalogModel *catalog.CatalogModel,
	req *model.UpdateModelRequest,
) (service.ModelCreateRequest, error) {
	capabilities, err := service.ModelCapabilityFlagsFromNames(catalogModel.Capabilities)
	if err != nil {
		return service.ModelCreateRequest{}, fmt.Errorf(
			"model %q capability metadata is invalid: %w",
			catalogModel.ID,
			err,
		)
	}

	createRequest := service.ModelCreateRequest{
		ActorPTID:     actorPTID,
		ProviderID:    providerID,
		ModelID:       catalogModel.ID,
		DisplayName:   catalogModel.DisplayName,
		Enabled:       catalogModel.Enabled,
		Capabilities:  capabilities,
		ContextWindow: catalogModel.ContextWindow,
	}
	if req.DisplayName != nil {
		createRequest.DisplayName = req.GetDisplayName()
	}
	if req.Enabled != nil {
		createRequest.Enabled = req.GetEnabled()
	}
	if req.Capabilities != nil {
		createRequest.Capabilities = capabilityFlags(req.GetCapabilities())
	}
	if req.ContextWindow != nil {
		createRequest.ContextWindow = int(req.GetContextWindow())
	}

	return createRequest, nil
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

func providerAdapterCapabilities(
	provider *catalog.CatalogProvider,
) *model.ProviderAdapterCapabilities {
	if provider == nil {
		return nil
	}
	return &model.ProviderAdapterCapabilities{
		ModelDiscovery:      len(provider.ModelCatalogArgv) > 0,
		StartupArgs:         provider.SupportsConfiguration("startup-args"),
		Environment:         provider.SupportsConfiguration("environment"),
		ConfigurableTimeout: provider.SupportsConfiguration("timeout"),
		RuntimeCapabilities: append(
			[]string(nil),
			provider.Capabilities...,
		),
	}
}

func providerIsCLI(provider *catalog.CatalogProvider) bool {
	return provider != nil &&
		strings.EqualFold(strings.TrimSpace(provider.RuntimeKind), "cli")
}

func catalogModelByID(
	provider *catalog.CatalogProvider,
	modelID string,
) *catalog.CatalogModel {
	if provider == nil {
		return nil
	}
	for i := range provider.Models {
		if provider.Models[i].ID == modelID {
			return &provider.Models[i]
		}
	}
	return nil
}

func (h *ProviderHandlers) effectiveCatalogProvider(
	actorPTID string,
	providerID string,
) *catalog.CatalogProvider {
	provider := catalog.Find(providerID)
	if provider == nil {
		return nil
	}
	effective := h.runtimeModels.EffectiveProvider(actorPTID, *provider)
	return &effective
}

func (h *ProviderHandlers) findUserProvider(
	ctx context.Context,
	actorPTID string,
	providerID string,
) (*persistence.AgentProvider, error) {
	providers, err := h.providerConfig.List(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	for i := range providers {
		if providers[i].Name == providerID {
			return &providers[i], nil
		}
	}
	return nil, nil
}

func (h *ProviderHandlers) ensureProviderModelsMutable(
	actorPTID string,
	providerID string,
) error {
	if providerIsCLI(h.effectiveCatalogProvider(actorPTID, providerID)) {
		return server.NewHandlerError(
			http.StatusBadRequest,
			"CLI provider models are a read-only Station runtime catalog",
		)
	}
	return nil
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
