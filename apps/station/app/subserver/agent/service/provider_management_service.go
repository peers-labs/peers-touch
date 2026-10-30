package service

import (
	"context"
	"errors"
	"google.golang.org/protobuf/types/known/timestamppb"
	"net/http"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	providercli "github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/managed"
)

// ProviderManagementPort is the Agent-owned control-plane boundary. The
// Dashboard authenticates administrators; it never writes Agent tables.
type ProviderManagementPort interface {
	List(context.Context, ProviderOwner) (*model.ListProvidersResponse, error)
	Get(context.Context, ProviderOwner, string) (*model.GetProviderResponse, error)
	Create(context.Context, ProviderOwner, *model.CreateProviderRequest) (*model.CreateProviderResponse, error)
	Update(context.Context, ProviderOwner, *model.UpdateProviderRequest) (*model.UpdateProviderResponse, error)
	Delete(context.Context, ProviderOwner, *model.DeleteProviderRequest) (*model.DeleteProviderResponse, error)
	ListModels(context.Context, ProviderOwner, string) (*model.ListModelsResponse, error)
	CreateModel(context.Context, ProviderOwner, *model.CreateModelRequest) (*model.CreateModelResponse, error)
	UpdateModel(context.Context, ProviderOwner, *model.UpdateModelRequest) (*model.UpdateModelResponse, error)
	SetCredential(context.Context, ProviderOwner, *model.SetCredentialRequest) (*model.SetCredentialResponse, error)
	DeleteCredential(context.Context, ProviderOwner, *model.DeleteCredentialRequest) (*model.DeleteCredentialResponse, error)
	CredentialStatus(context.Context, ProviderOwner, string) (*model.GetCredentialStatusResponse, error)
	Policy(context.Context) (*model.GetProviderPolicyResponse, error)
	SetPolicy(context.Context, *model.SetProviderPolicyRequest) (*model.SetProviderPolicyResponse, error)
	Access(context.Context, string) (*model.GetProviderAccessResponse, error)
	SetAccess(context.Context, *model.SetProviderAccessRequest) (*model.SetProviderAccessResponse, error)
	Install(context.Context, *model.InstallProviderRequest) (*model.InstallProviderResponse, error)
	InstallStatus(context.Context, *model.ProviderInstallStatusRequest) (*model.ProviderInstallStatusResponse, error)
	Discover(context.Context, ProviderOwner, string) (*model.DiscoverProviderModelsResponse, error)
}

type ProviderManagementService struct {
	providers     *ProviderConfigService
	models        *ModelConfigService
	credentials   *CredentialConfigService
	runtimeModels *RuntimeModelCatalog
	discovery     *ProviderModelDiscoveryService
	installer     *managed.Manager
}

func NewProviderManagementService(providers *ProviderConfigService, models *ModelConfigService,
	credentials *CredentialConfigService, runtimeModels *RuntimeModelCatalog,
	discovery *ProviderModelDiscoveryService, installer *managed.Manager) *ProviderManagementService {
	return &ProviderManagementService{providers: providers, models: models, credentials: credentials,
		runtimeModels: runtimeModels, discovery: discovery, installer: installer}
}

func (s *ProviderManagementService) List(ctx context.Context, owner ProviderOwner) (*model.ListProvidersResponse, error) {
	if err := s.providers.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	records, err := s.providers.ListOwned(ctx, owner)
	if err != nil {
		return nil, err
	}
	byID := map[string]*persistence.AgentProvider{}
	for i := range records {
		byID[records[i].Name] = &records[i]
	}
	result := &model.ListProvidersResponse{Providers: []*model.AgentProviderInfo{}}
	for _, provider := range catalog.List() {
		if !catalogProviderAdvertised(provider) {
			continue
		}
		info, err := s.project(ctx, owner, &provider, byID[provider.ID])
		if err != nil {
			return nil, err
		}
		result.Providers = append(result.Providers, info)
	}
	for i := range records {
		if catalog.Find(records[i].Name) == nil {
			info, err := s.project(ctx, owner, nil, &records[i])
			if err != nil {
				return nil, err
			}
			result.Providers = append(result.Providers, info)
		}
	}
	return result, nil
}

func (s *ProviderManagementService) Get(ctx context.Context, owner ProviderOwner, providerID string) (*model.GetProviderResponse, error) {
	if err := s.providers.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	record, err := s.providers.GetOwned(ctx, owner, providerID)
	var missing *errcode.BizError
	if err != nil && (!errors.As(err, &missing) || missing.Code != errcode.AgentNotFound) {
		return nil, err
	}
	cp := catalog.Find(providerID)
	if record == nil && cp == nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "provider not found", nil)
	}
	info, err := s.project(ctx, owner, cp, record)
	return &model.GetProviderResponse{Provider: info}, err
}

// Check reports configuration and binary availability, not upstream completion.
// It uses the same registered argv and managed PATH as actual CLI execution.
func (s *ProviderManagementService) Check(ctx context.Context, owner ProviderOwner, providerID string) (*model.CheckProviderResponse, error) {
	provider, err := s.Get(ctx, owner, providerID)
	if err != nil {
		return nil, err
	}
	info := provider.GetProvider()
	if info.GetRuntimeKind() == providerRuntimeCLI {
		cp := catalog.Find(providerID)
		if cp == nil {
			return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "registered CLI provider not found", nil)
		}
		var paths []string
		if s.installer != nil {
			paths = append(paths, s.installer.BinDir())
		}
		verified := providercli.VerifyCliBinaryFor(cp.CLIArgv, paths)
		return &model.CheckProviderResponse{Ok: verified.Available, Program: verified.Program,
			Error: verified.Error, InstallHint: verified.InstallHint}, nil
	}
	return &model.CheckProviderResponse{Ok: info.GetEnabled() &&
		(!info.GetShowApiKey() || info.GetCredentialStatus() == "configured")}, nil
}

func (s *ProviderManagementService) project(ctx context.Context, owner ProviderOwner, cp *catalog.CatalogProvider, record *persistence.AgentProvider) (*model.AgentProviderInfo, error) {
	info := &model.AgentProviderInfo{Owner: providerOwnerProto(owner), CredentialStatus: "not_configured"}
	if cp != nil {
		effective := s.runtimeModels.EffectiveProvider(record, *cp)
		cp = &effective
		info.Id, info.Name, info.Description = cp.ID, cp.Name, cp.Description
		info.Builtin, info.Protocol, info.Discovery = cp.Builtin, cp.Protocol, cp.Discovery
		info.RuntimeKind, info.BaseUrl, info.Source = cp.RuntimeKind, cp.DefaultBaseURL, "catalog"
		info.HomeUrl, info.ApiKeyUrl, info.ShowChecker = cp.HomeURL, cp.APIKeyURL, cp.ShowChecker
		info.ShowApiKey = cp.ShowAPIKey == nil || *cp.ShowAPIKey
		info.CliCommand, info.WorkspacePolicy = catalog.FormatArgv(cp.CLIArgv), cp.WorkspacePolicy
		info.RuntimeConfig = EffectiveProviderRuntimeConfig(cp, record)
		info.DefaultRuntimeConfig = DefaultProviderRuntimeConfig(cp)
		info.AdapterCapabilities = &model.ProviderAdapterCapabilities{
			ModelDiscovery:      len(cp.ModelCatalogArgv) > 0,
			StartupArgs:         cp.SupportsConfiguration("startup-args"),
			Environment:         cp.SupportsConfiguration("environment"),
			ConfigurableTimeout: cp.SupportsConfiguration("timeout"),
			RuntimeCapabilities: append([]string(nil), cp.Capabilities...),
		}
	}
	if record != nil {
		info.Id, info.Enabled, info.Version = record.Name, record.Enabled, record.Version
		if record.DisplayName != "" {
			info.Name = record.DisplayName
		}
		if record.BaseURL != "" {
			info.BaseUrl = record.BaseURL
		}
		if cp == nil {
			info.Name, info.Protocol, info.RuntimeKind, info.Source = record.DisplayName, record.Protocol, record.RuntimeKind, record.SourceType
			if info.Name == "" {
				info.Name = record.Name
			}
		}
		if ProviderCredentialConfigured(record) {
			info.CredentialStatus = "configured"
		}
	}
	persisted, err := s.models.ListOwned(ctx, owner, info.Id)
	if err != nil {
		return nil, err
	}
	if cp == nil {
		cp = &catalog.CatalogProvider{ID: info.Id}
	}
	hidden := []string(nil)
	if record != nil {
		hidden = parseHiddenModels(record.HiddenModels)
	}
	effective, err := ResolveEffectiveProviderModels(cp, persisted, hidden)
	if err != nil {
		return nil, err
	}
	for _, item := range effective {
		projected := &model.ProviderModelInfo{Id: item.ID, DisplayName: item.DisplayName, Type: item.Type,
			Enabled: item.Enabled, ContextWindow: int32(item.ContextWindow),
			Capabilities: &model.ModelCapabilityConfig{Flags: item.Capabilities}}
		for _, original := range cp.Models {
			if original.ID == item.ID {
				projected.Description = original.Description
				projected.DefaultReasoningLevel = original.DefaultReasoningLevel
				projected.SupportedReasoningLevels = original.SupportedReasoningLevels
				break
			}
		}
		info.Models = append(info.Models, projected)
	}
	if _, ok := managed.FindSpec(info.Id); ok && s.installer != nil {
		snapshot := s.installer.Snapshot(info.Id, "")
		info.InstallState, info.InstallSupported, info.ManualInstallUrl = string(snapshot.State), snapshot.InstallSupported, snapshot.ManualURL
	}
	return info, nil
}

func providerOwnerProto(owner ProviderOwner) *model.ProviderResourceOwner {
	scope := model.ProviderResourceScope_PROVIDER_RESOURCE_SCOPE_ACTOR
	if owner.Scope == ProviderScopeStation {
		scope = model.ProviderResourceScope_PROVIDER_RESOURCE_SCOPE_STATION
	}
	return &model.ProviderResourceOwner{Scope: scope, ActorPtid: owner.ActorPTID}
}

func (s *ProviderManagementService) Create(ctx context.Context, owner ProviderOwner, req *model.CreateProviderRequest) (*model.CreateProviderResponse, error) {
	_, err := s.providers.Create(ctx, ProviderCreateRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.GetProviderId(), DisplayName: req.GetDisplayName(), BaseURL: req.GetBaseUrl(),
		Protocol: req.GetProtocol(), ConfigJSON: req.GetConfigJson()})
	if err != nil {
		return nil, err
	}
	info, err := s.Get(ctx, owner, req.GetProviderId())
	return &model.CreateProviderResponse{Provider: info.GetProvider()}, err
}

func (s *ProviderManagementService) Update(ctx context.Context, owner ProviderOwner, req *model.UpdateProviderRequest) (*model.UpdateProviderResponse, error) {
	if err := s.providers.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	config := req.GetConfigJson()
	if req.RuntimeConfig != nil {
		cp := catalog.Find(req.GetProviderId())
		record, _ := s.providers.GetOwned(ctx, owner, req.GetProviderId())
		if cp != nil {
			effective := s.runtimeModels.EffectiveProvider(record, *cp)
			cp = &effective
		}
		var err error
		config, err = EncodeProviderRuntimeConfig(cp, req.RuntimeConfig)
		if err != nil {
			return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "invalid provider runtime configuration", err)
		}
	}
	update := ProviderUpdateRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.GetProviderId(), Version: req.GetVersion(), DisplayName: req.DisplayName,
		BaseURL: req.BaseUrl, Enabled: req.Enabled, ConfigJSON: config}
	var err error
	if req.GetVersion() == 0 {
		_, err = s.providers.Materialize(ctx, update)
	} else {
		_, err = s.providers.Update(ctx, update)
	}
	if err != nil {
		return nil, err
	}
	info, err := s.Get(ctx, owner, req.GetProviderId())
	return &model.UpdateProviderResponse{Provider: info.GetProvider()}, err
}

func (s *ProviderManagementService) Delete(ctx context.Context, owner ProviderOwner, req *model.DeleteProviderRequest) (*model.DeleteProviderResponse, error) {
	err := s.providers.Delete(ctx, ProviderDeleteRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.GetProviderId(), Version: req.GetVersion()})
	return &model.DeleteProviderResponse{Deleted: err == nil}, err
}

func (s *ProviderManagementService) ListModels(ctx context.Context, owner ProviderOwner, providerID string) (*model.ListModelsResponse, error) {
	info, err := s.Get(ctx, owner, providerID)
	if err != nil {
		return nil, err
	}
	persisted, err := s.models.ListOwned(ctx, owner, providerID)
	if err != nil {
		return nil, err
	}
	byID := map[string]persistence.AgentModel{}
	for _, record := range persisted {
		byID[record.ModelID] = record
	}
	result := &model.ListModelsResponse{Models: []*model.AgentModelInfo{}}
	for _, item := range info.GetProvider().GetModels() {
		record := byID[item.Id]
		result.Models = append(result.Models, &model.AgentModelInfo{Id: record.ID, ActorPtid: owner.ActorPTID,
			Owner: providerOwnerProto(owner), ProviderId: providerID, ModelId: item.Id, DisplayName: item.DisplayName,
			Enabled: item.Enabled, Version: record.Version, ContextWindow: item.ContextWindow, Capabilities: item.Capabilities})
	}
	return result, nil
}

func (s *ProviderManagementService) CreateModel(ctx context.Context, owner ProviderOwner, req *model.CreateModelRequest) (*model.CreateModelResponse, error) {
	if cp := catalog.Find(req.GetProviderId()); cp != nil && cp.RuntimeKind == providerRuntimeCLI {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "CLI model definitions are read-only; use discovery", nil)
	}
	record, err := s.models.Create(ctx, ModelCreateRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.GetProviderId(), ModelID: req.GetModelId(), DisplayName: req.GetDisplayName(),
		Enabled: req.GetEnabled(), ContextWindow: int(req.GetContextWindow()), Capabilities: req.GetCapabilities().GetFlags()})
	if err != nil {
		return nil, err
	}
	return &model.CreateModelResponse{Model: persistedModelProto(record)}, nil
}

func (s *ProviderManagementService) UpdateModel(ctx context.Context, owner ProviderOwner, req *model.UpdateModelRequest) (*model.UpdateModelResponse, error) {
	if cp := catalog.Find(req.GetProviderId()); cp != nil && cp.RuntimeKind == providerRuntimeCLI {
		return nil, errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, "CLI model definitions are read-only; use discovery", nil)
	}
	if req.GetVersion() == 0 {
		info, err := s.Get(ctx, owner, req.GetProviderId())
		if err != nil {
			return nil, err
		}
		for _, item := range info.GetProvider().GetModels() {
			if item.Id != req.GetModelId() {
				continue
			}
			if req.Enabled != nil {
				item.Enabled = *req.Enabled
			}
			if req.DisplayName != nil {
				item.DisplayName = *req.DisplayName
			}
			if req.ContextWindow != nil {
				item.ContextWindow = *req.ContextWindow
			}
			if req.Capabilities != nil {
				item.Capabilities = req.Capabilities
			}
			record, err := s.models.Create(ctx, ModelCreateRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
				ProviderID: req.GetProviderId(), ModelID: item.Id, DisplayName: item.DisplayName, Enabled: item.Enabled,
				ContextWindow: int(item.ContextWindow), Capabilities: item.GetCapabilities().GetFlags()})
			if err != nil {
				return nil, err
			}
			return &model.UpdateModelResponse{Model: persistedModelProto(record)}, nil
		}
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "model not found", nil)
	}
	var window *int
	if req.ContextWindow != nil {
		value := int(*req.ContextWindow)
		window = &value
	}
	record, err := s.models.Update(ctx, ModelUpdateRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.GetProviderId(), ModelID: req.GetModelId(), Version: req.GetVersion(),
		DisplayName: req.DisplayName, Enabled: req.Enabled, ContextWindow: window, Capabilities: req.GetCapabilities().GetFlags()})
	if err != nil {
		return nil, err
	}
	return &model.UpdateModelResponse{Model: persistedModelProto(record)}, nil
}

func persistedModelProto(record *persistence.AgentModel) *model.AgentModelInfo {
	flags, _ := DecodeModelCapabilityFlags(record.CapabilitiesJSON)
	return &model.AgentModelInfo{Id: record.ID, ActorPtid: record.ActorPTID, Owner: providerOwnerProto(requestProviderOwner(record.Scope, record.ActorPTID)),
		ProviderId: record.ProviderID, ModelId: record.ModelID, DisplayName: record.DisplayName, Enabled: record.Enabled,
		Version: record.Version, ContextWindow: int32(record.ContextWindow), Capabilities: &model.ModelCapabilityConfig{Flags: flags}}
}

func (s *ProviderManagementService) SetCredential(ctx context.Context, owner ProviderOwner, req *model.SetCredentialRequest) (*model.SetCredentialResponse, error) {
	status, err := s.credentials.Set(ctx, CredentialSetRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.GetProviderId(), APIKey: req.GetApiKey()})
	if err != nil {
		return nil, err
	}
	return &model.SetCredentialResponse{Status: credentialStatusProto(status)}, nil
}

func (s *ProviderManagementService) DeleteCredential(ctx context.Context, owner ProviderOwner, req *model.DeleteCredentialRequest) (*model.DeleteCredentialResponse, error) {
	err := s.credentials.Delete(ctx, CredentialDeleteRequest{Scope: owner.Scope, ActorPTID: owner.ActorPTID,
		ProviderID: req.GetProviderId(), Version: req.GetVersion()})
	return &model.DeleteCredentialResponse{Deleted: err == nil}, err
}

func (s *ProviderManagementService) CredentialStatus(ctx context.Context, owner ProviderOwner, providerID string) (*model.GetCredentialStatusResponse, error) {
	if err := s.providers.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	status, err := s.credentials.StatusOwned(ctx, owner, providerID)
	if err != nil {
		return nil, err
	}
	return &model.GetCredentialStatusResponse{Status: credentialStatusProto(status)}, nil
}

func credentialStatusProto(status *CredentialStatusResponse) *model.CredentialStatusInfo {
	return &model.CredentialStatusInfo{ProviderId: status.ProviderID, Configured: status.Configured, Status: status.Status, Version: status.Version}
}

func (s *ProviderManagementService) Policy(ctx context.Context) (*model.GetProviderPolicyResponse, error) {
	policy, err := s.providers.Policy(ctx)
	if err != nil {
		return nil, err
	}
	return &model.GetProviderPolicyResponse{Policy: &model.ProviderPolicy{PersonalProvidersEnabled: policy.PersonalProvidersEnabled, Revision: policy.Revision}}, nil
}

func (s *ProviderManagementService) SetPolicy(ctx context.Context, req *model.SetProviderPolicyRequest) (*model.SetProviderPolicyResponse, error) {
	policy, err := s.providers.SetPolicy(ctx, req.GetPersonalProvidersEnabled(), req.GetRevision())
	if err != nil {
		return nil, err
	}
	return &model.SetProviderPolicyResponse{Policy: &model.ProviderPolicy{PersonalProvidersEnabled: policy.PersonalProvidersEnabled, Revision: policy.Revision}}, nil
}

func (s *ProviderManagementService) Access(ctx context.Context, providerID string) (*model.GetProviderAccessResponse, error) {
	provider, grants, err := s.providers.Access(ctx, providerID)
	if err != nil {
		var missing *errcode.BizError
		if errors.As(err, &missing) && missing.Code == errcode.AgentNotFound && catalog.Find(providerID) != nil {
			// An unconfigured catalog entry has no persisted grants. Reading
			// its initial editor must not materialize or authorize a Provider.
			return &model.GetProviderAccessResponse{Access: &model.ProviderAccess{
				ProviderId: providerID, Grants: []*model.ProviderAccessGrant{},
			}}, nil
		}
		return nil, err
	}
	access := &model.ProviderAccess{ProviderId: providerID, Revision: provider.AccessRevision, Grants: []*model.ProviderAccessGrant{}}
	for _, grant := range grants {
		access.Grants = append(access.Grants, &model.ProviderAccessGrant{AllActors: grant.AllActors, ActorPtid: grant.ActorPTID,
			AllModels: grant.AllModels, ModelId: grant.ModelID})
	}
	return &model.GetProviderAccessResponse{Access: access}, nil
}

func (s *ProviderManagementService) SetAccess(ctx context.Context, req *model.SetProviderAccessRequest) (*model.SetProviderAccessResponse, error) {
	if _, err := s.providers.GetOwned(ctx, StationProviderOwner(), req.GetProviderId()); err != nil {
		return nil, err
	}
	grants := make([]persistence.ProviderAccessGrant, 0, len(req.GetGrants()))
	for _, grant := range req.GetGrants() {
		grants = append(grants, persistence.ProviderAccessGrant{AllActors: grant.GetAllActors(), ActorPTID: grant.GetActorPtid(),
			AllModels: grant.GetAllModels(), ModelID: grant.GetModelId()})
	}
	if _, err := s.providers.SetAccess(ctx, req.GetProviderId(), req.GetRevision(), grants); err != nil {
		return nil, err
	}
	current, err := s.Access(ctx, req.GetProviderId())
	return &model.SetProviderAccessResponse{Access: current.GetAccess()}, err
}

func (s *ProviderManagementService) Install(ctx context.Context, req *model.InstallProviderRequest) (*model.InstallProviderResponse, error) {
	if s.installer == nil {
		return nil, errcode.NewRuntimeUnavailable("cli", "installer_unavailable")
	}
	snapshot, err := s.installer.Start(ctx, req.GetProviderId())
	return &model.InstallProviderResponse{InstallState: string(snapshot.State), JobId: snapshot.JobID,
		InstallSupported: snapshot.InstallSupported, ManualInstallUrl: snapshot.ManualURL}, err
}

func (s *ProviderManagementService) InstallStatus(ctx context.Context, req *model.ProviderInstallStatusRequest) (*model.ProviderInstallStatusResponse, error) {
	if s.installer == nil {
		return nil, errcode.NewRuntimeUnavailable("cli", "installer_unavailable")
	}
	snapshot := s.installer.Snapshot(req.GetProviderId(), req.GetJobId())
	return &model.ProviderInstallStatusResponse{InstallState: string(snapshot.State), JobId: snapshot.JobID,
		Phase: snapshot.Phase, Percent: int32(snapshot.Percent), Message: snapshot.Message, Error: snapshot.Error,
		InstallSupported: snapshot.InstallSupported, ManualInstallUrl: snapshot.ManualURL, InstalledVersion: snapshot.InstalledVersion}, nil
}

func (s *ProviderManagementService) Discover(ctx context.Context, owner ProviderOwner, providerID string) (*model.DiscoverProviderModelsResponse, error) {
	if err := s.providers.validateManagementOwner(ctx, owner); err != nil {
		return nil, err
	}
	record, err := s.providers.GetOwned(ctx, owner, providerID)
	if err != nil {
		return nil, err
	}
	cp := catalog.Find(providerID)
	if cp == nil {
		return nil, errcode.New(errcode.AgentNotFound, http.StatusNotFound, "provider not found", nil)
	}
	_, observed, err := s.discovery.Discover(ctx, owner.ActorPTID, cp, record)
	if err != nil {
		return nil, err
	}
	info, err := s.Get(ctx, owner, providerID)
	return &model.DiscoverProviderModelsResponse{Models: info.GetProvider().GetModels(), ObservedAt: timestamppb.New(observed)}, err
}
