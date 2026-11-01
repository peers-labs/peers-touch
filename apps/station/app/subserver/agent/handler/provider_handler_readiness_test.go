package handler

import (
	"context"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/managed"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

func newControlPlaneHandlers(t *testing.T) (*ProviderHandlers, *service.ProviderManagementService, context.Context) {
	t.Helper()
	db := openTurnHandlerTestDB(t, "provider_control_"+t.Name())
	if err := db.AutoMigrate(&persistence.AgentProvider{}, &persistence.AgentModel{}, &persistence.Credential{},
		&persistence.ProviderPolicy{}, &persistence.ProviderAccessGrant{}, &persistence.AgentRuntimeDefault{}, &persistence.CLIProfileDefault{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PT_SECRET_KEK", "handler-provider-test-key-material")
	t.Setenv("PT_SECRET_KEK_FILE", "")
	providers, models := service.NewProviderConfigService(), service.NewModelConfigService()
	runtimeModels := service.NewRuntimeModelCatalog()
	handlers := NewProviderHandlers(providers, models, service.NewCredentialConfigService(),
		service.NewRuntimeAdmissionResolver(providers, models), runtimeModels,
		service.NewProviderModelDiscoveryService(runtimeModels), service.NewRuntimeDefaultService(), managed.NewManager(t.TempDir()))
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "ptid:person:consumer"})
	return handlers, handlers.management, ctx
}

func findProviderInfo(list *model.ListProvidersResponse, id string) *model.AgentProviderInfo {
	for _, provider := range list.GetProviders() {
		if provider.GetId() == id {
			return provider
		}
	}
	return nil
}

func TestProviderManagementListsAllCLIAdaptersWithoutAnInstallation(t *testing.T) {
	t.Setenv("PATH", "")
	handlers, management, ctx := newControlPlaneHandlers(t)
	list, err := management.List(ctx, service.StationProviderOwner())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"trae-cli", "codex-cli", "cursor-cli", "claude-cli"} {
		provider := findProviderInfo(list, id)
		if provider == nil || provider.GetInstallState() == "" {
			t.Fatalf("management catalog lost missing CLI adapter %s", id)
		}
		if provider.GetOwner().GetScope() != model.ProviderResourceScope_PROVIDER_RESOURCE_SCOPE_STATION {
			t.Fatal("shared management projection has an actor owner")
		}
	}
	manual, err := management.Install(ctx, &model.InstallProviderRequest{ProviderId: "trae-cli"})
	if err != nil || manual.GetInstallState() != "manual_required" || manual.GetJobId() != "" ||
		manual.GetManualInstallUrl() == "" {
		t.Fatalf("TRAE manual install = %+v %v", manual, err)
	}
	consumer, err := handlers.HandleProviderList(ctx, &model.ListProvidersRequest{})
	if err != nil || len(consumer.GetProviders()) != 0 {
		t.Fatalf("consumer catalog exposed unconfigured adapters: %+v %v", consumer, err)
	}
}

func TestProviderConsumerProjectionRetainsOnlyAuthorizedModels(t *testing.T) {
	catalog.SetForTesting([]catalog.CatalogProvider{{
		ID: "test-shared", Name: "Shared Models", Enabled: true, Protocol: "openai-compatible", RuntimeKind: "http",
		Models: []catalog.CatalogModel{
			{ID: "allowed", DisplayName: "Allowed", Enabled: true, Type: "chat", ContextWindow: 64000, Capabilities: []string{"streaming"}},
			{ID: "denied", DisplayName: "Denied", Enabled: true, Type: "chat", ContextWindow: 64000},
		},
	}})
	defer catalog.RestoreForTesting()
	handlers, management, ctx := newControlPlaneHandlers(t)
	owner := service.StationProviderOwner()
	if _, err := management.Create(ctx, owner, &model.CreateProviderRequest{ProviderId: "test-shared"}); err != nil {
		t.Fatal(err)
	}
	if _, err := management.SetCredential(ctx, owner, &model.SetCredentialRequest{ProviderId: "test-shared", ApiKey: "shared-test-key"}); err != nil {
		t.Fatal(err)
	}
	if _, err := management.SetAccess(ctx, &model.SetProviderAccessRequest{ProviderId: "test-shared",
		Grants: []*model.ProviderAccessGrant{{ActorPtid: "ptid:person:consumer", ModelId: "allowed"}}}); err != nil {
		t.Fatal(err)
	}
	list, err := handlers.HandleProviderList(ctx, &model.ListProvidersRequest{})
	if err != nil || len(list.GetProviders()) != 1 {
		t.Fatalf("consumer catalog = %+v %v", list, err)
	}
	provider := list.GetProviders()[0]
	if len(provider.GetModels()) != 1 || provider.GetModels()[0].GetId() != "allowed" ||
		provider.GetCliCommand() != "" || provider.GetBaseUrl() != "" ||
		provider.GetRuntimeConfig() != nil || provider.GetCredentialStatus() != "" || provider.GetInstallState() != "" ||
		provider.GetRuntimeKind() != "" || provider.GetVersion() != 0 {
		t.Fatalf("consumer projection leaked management data: %+v", provider)
	}
	otherCtx := coreauth.WithSubject(context.Background(), &coreauth.Subject{ID: "ptid:person:other"})
	if other, err := handlers.HandleProviderList(otherCtx, &model.ListProvidersRequest{}); err != nil || len(other.GetProviders()) != 0 {
		t.Fatalf("targeted model grant escaped to another actor: %+v %v", other, err)
	}
	if _, err := handlers.HandleProviderUpdate(ctx, &model.UpdateProviderRequest{ProviderId: "test-shared", Version: 2}); err == nil {
		t.Fatal("consumer actor modified a shared Provider while personal management was disabled")
	}
	policy, err := management.SetPolicy(ctx, &model.SetProviderPolicyRequest{
		AiUserAccess: &model.AIUserAccess{ActorPtids: []string{"ptid:person:other"}},
	})
	if err != nil || policy.GetPolicy().GetAiUserAccess().GetAllActors() {
		t.Fatalf("global policy was not persisted: %v %v", policy, err)
	}
	if _, err := handlers.HandleSetRuntimeDefault(ctx, &model.SetRuntimeDefaultRequest{
		ProviderId: "test-shared", ModelId: "allowed",
	}); err == nil {
		t.Fatal("globally denied actor selected a granted model as the default")
	}
	if list, err := handlers.HandleProviderList(ctx, &model.ListProvidersRequest{}); err != nil || len(list.GetProviders()) != 0 {
		t.Fatalf("global denial did not remove consumer models: %v %v", list, err)
	}
	if public, err := handlers.HandleProviderPolicy(ctx, &model.GetProviderPolicyRequest{}); err != nil || public.GetPolicy().GetAiUserAccess() != nil {
		t.Fatalf("actor policy projection exposed administrator user grants: %v %v", public, err)
	}
}

func TestCatalogModelTogglePreservesCapabilityAuthority(t *testing.T) {
	catalog.SetForTesting([]catalog.CatalogProvider{{
		ID: "catalog-provider", Name: "Catalog Provider", Enabled: true, Protocol: "openai-compatible", RuntimeKind: "http",
		Models: []catalog.CatalogModel{{ID: "catalog-model", DisplayName: "Catalog Model", Type: "chat",
			Enabled: true, ContextWindow: 128000, Capabilities: []string{"streaming", "native-tools"}}},
	}})
	defer catalog.RestoreForTesting()
	_, management, ctx := newControlPlaneHandlers(t)
	owner := service.StationProviderOwner()
	if _, err := management.Create(ctx, owner, &model.CreateProviderRequest{ProviderId: "catalog-provider"}); err != nil {
		t.Fatal(err)
	}
	disabled := false
	created, err := management.UpdateModel(ctx, owner, &model.UpdateModelRequest{
		ProviderId: "catalog-provider", ModelId: "catalog-model", Enabled: &disabled,
	})
	if err != nil || created.GetModel().GetVersion() != 1 || created.GetModel().GetEnabled() {
		t.Fatalf("catalog override = %+v %v", created, err)
	}
	enabled := true
	updated, err := management.UpdateModel(ctx, owner, &model.UpdateModelRequest{
		ProviderId: "catalog-provider", ModelId: "catalog-model", Version: 1, Enabled: &enabled,
		Capabilities: &model.ModelCapabilityConfig{Flags: map[string]bool{"native-tools": false}},
	})
	if err != nil || updated.GetModel().GetVersion() != 2 {
		t.Fatalf("updated override = %+v %v", updated, err)
	}
	after, err := management.Get(ctx, owner, "catalog-provider")
	if err != nil {
		t.Fatal(err)
	}
	projected := after.GetProvider().GetModels()[0]
	if !projected.GetEnabled() || !projected.GetCapabilities().GetFlags()["streaming"] ||
		projected.GetCapabilities().GetFlags()["native-tools"] {
		t.Fatalf("effective model capability authority = %+v", projected)
	}
	if _, err := management.UpdateModel(ctx, owner, &model.UpdateModelRequest{
		ProviderId: "catalog-provider", ModelId: "catalog-model", Version: 1, Enabled: &disabled,
	}); err == nil || !strings.Contains(err.Error(), "conflict") {
		t.Fatalf("stale model version was accepted: %v", err)
	}
}
