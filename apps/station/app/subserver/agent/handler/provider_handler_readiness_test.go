package handler

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
)

func TestFrozenProfileDoesNotAdvertiseExternalAgentRuntimeKinds(t *testing.T) {
	for _, runtimeKind := range []string{"external_agent", "EXTERNAL_AGENT"} {
		if runtimeAdvertisedByFrozenProfile(runtimeKind) {
			t.Fatalf("runtime kind %q must not be advertised", runtimeKind)
		}
	}
	for _, runtimeKind := range []string{"", "http"} {
		if !runtimeAdvertisedByFrozenProfile(runtimeKind) {
			t.Fatalf("Direct Model runtime kind %q must remain advertised", runtimeKind)
		}
	}
}

func TestFrozenProfileAdvertisesBuiltInCLIProvider(t *testing.T) {
	trae := catalog.Find("trae-cli")
	if trae == nil {
		t.Fatal("expected trae-cli catalog registration")
	}
	if !trae.Enabled {
		t.Fatal("trae-cli registration must be enabled")
	}
	if !catalogProviderAdvertisedByFrozenProfile(*trae) {
		t.Fatal("implemented CLI registration must enter the effective provider projection")
	}
}

func TestFrozenProfileDoesNotAdvertiseUnimplementedProviderProtocol(t *testing.T) {
	google := catalog.Find("google")
	if google == nil {
		t.Fatal("expected Google catalog registration")
	}
	if catalogProviderAdvertisedByFrozenProfile(*google) {
		t.Fatal("provider without a Station Gemini adapter must not enter the effective projection")
	}
}

func TestProviderProjectionDoesNotInferRuntimeCapabilityFromCatalog(t *testing.T) {
	info := providerToProto(&persistence.AgentProvider{
		Name:        "trae-cli",
		DisplayName: "Retained disabled registration",
		Enabled:     false,
	})

	if info.Protocol != "cli" ||
		info.RuntimeKind != "" ||
		info.CliCommand != "" {
		t.Fatalf("catalog metadata must not infer an advertised runtime capability: %+v", info)
	}
}

func TestModelProjectionReturnsPersistedCapabilityAuthority(t *testing.T) {
	info, err := modelToProto(&persistence.AgentModel{
		ModelID:          "custom-model",
		ContextWindow:    128000,
		CapabilitiesJSON: json.RawMessage(`{"streaming":true,"native-tools":false}`),
	})
	if err != nil {
		t.Fatalf("project model: %v", err)
	}
	if info.GetContextWindow() != 128000 ||
		!info.GetCapabilities().GetFlags()["streaming"] ||
		info.GetCapabilities().GetFlags()["native-tools"] {
		t.Fatalf("model projection dropped capability authority: %+v", info)
	}
}

func TestCatalogModelProjectionReturnsDeclaredCapabilities(t *testing.T) {
	info, err := catalogModelToProto(&catalog.CatalogModel{
		ID:            "catalog-model",
		Type:          "chat",
		ContextWindow: 64000,
		Capabilities:  []string{"streaming", "native-tools"},
	})
	if err != nil {
		t.Fatalf("project catalog model: %v", err)
	}
	if !info.GetCapabilities().GetFlags()["streaming"] ||
		!info.GetCapabilities().GetFlags()["native-tools"] {
		t.Fatalf("catalog projection dropped declared capabilities: %+v", info)
	}
}

func TestCatalogModelToggleMaterializesAndProjectsOverride(t *testing.T) {
	showAPIKey := true
	catalog.SetForTesting([]catalog.CatalogProvider{{
		ID:          "catalog-provider",
		Name:        "Catalog Provider",
		Enabled:     true,
		Protocol:    "openai-compatible",
		RuntimeKind: "http",
		ShowAPIKey:  &showAPIKey,
		Models: []catalog.CatalogModel{{
			ID:            "catalog-model",
			DisplayName:   "Catalog Model",
			Type:          "chat",
			Enabled:       true,
			ContextWindow: 128000,
			Capabilities:  []string{"streaming", "native-tools"},
		}},
	}})
	defer catalog.RestoreForTesting()

	db := openTurnHandlerTestDB(t, "provider_handler_catalog_model_toggle")
	if err := db.AutoMigrate(
		&persistence.AgentProvider{},
		&persistence.AgentModel{},
		&persistence.Credential{},
	); err != nil {
		t.Fatalf("migrate provider handler database: %v", err)
	}

	providerConfig := service.NewProviderConfigService()
	modelConfig := service.NewModelConfigService()
	runtimeModels := service.NewRuntimeModelCatalog()
	handlers := NewProviderHandlers(
		providerConfig,
		modelConfig,
		service.NewCredentialConfigService(),
		service.NewRuntimeAdmissionResolver(providerConfig, modelConfig),
		runtimeModels,
		service.NewProviderModelDiscoveryService(runtimeModels),
		service.NewRuntimeDefaultService(),
	)
	ctx := coreauth.WithSubject(
		context.Background(),
		&coreauth.Subject{ID: "ptid:person:catalog-model-toggle"},
	)

	before, err := handlers.HandleModelList(ctx, &model.ListModelsRequest{
		ProviderId: "catalog-provider",
	})
	if err != nil {
		t.Fatalf("list virtual catalog model: %v", err)
	}
	if len(before.GetModels()) != 1 ||
		before.GetModels()[0].GetVersion() != 0 ||
		!before.GetModels()[0].GetEnabled() {
		t.Fatalf("unexpected virtual catalog model: %+v", before.GetModels())
	}

	disabled := false
	created, err := handlers.HandleModelUpdate(ctx, &model.UpdateModelRequest{
		ProviderId: "catalog-provider",
		ModelId:    "catalog-model",
		Version:    0,
		Enabled:    &disabled,
	})
	if err != nil {
		t.Fatalf("materialize disabled catalog override: %v", err)
	}
	if created.GetModel().GetVersion() != 1 || created.GetModel().GetEnabled() {
		t.Fatalf("unexpected materialized override: %+v", created.GetModel())
	}

	provider, err := handlers.HandleProviderGet(ctx, &model.GetProviderRequest{
		ProviderId: "catalog-provider",
	})
	if err != nil {
		t.Fatalf("get provider after model toggle: %v", err)
	}
	if len(provider.GetProvider().GetModels()) != 1 ||
		provider.GetProvider().GetModels()[0].GetEnabled() {
		t.Fatalf("provider detail ignored disabled override: %+v", provider.GetProvider())
	}

	enabled := true
	updated, err := handlers.HandleModelUpdate(ctx, &model.UpdateModelRequest{
		ProviderId: "catalog-provider",
		ModelId:    "catalog-model",
		Version:    created.GetModel().GetVersion(),
		Enabled:    &enabled,
		Capabilities: &model.ModelCapabilityConfig{Flags: map[string]bool{
			"native-tools": false,
		}},
	})
	if err != nil {
		t.Fatalf("update catalog override: %v", err)
	}
	if updated.GetModel().GetVersion() != 2 || !updated.GetModel().GetEnabled() {
		t.Fatalf("unexpected updated override: %+v", updated.GetModel())
	}

	after, err := handlers.HandleProviderList(ctx, &model.ListProvidersRequest{})
	if err != nil {
		t.Fatalf("list providers after model update: %v", err)
	}
	projected := after.GetProviders()[0].GetModels()[0]
	if !projected.GetEnabled() ||
		!projected.GetCapabilities().GetFlags()["streaming"] ||
		projected.GetCapabilities().GetFlags()["native-tools"] {
		t.Fatalf("provider list did not merge catalog and override: %+v", projected)
	}
}

func TestCLIProviderModelMutationsAreRejectedBeforePersistence(t *testing.T) {
	catalog.SetForTesting([]catalog.CatalogProvider{{
		ID:          "test-cli",
		Name:        "Test CLI",
		RuntimeKind: "cli",
		Protocol:    "cli",
	}})
	defer catalog.RestoreForTesting()

	providerConfig := service.NewProviderConfigService()
	modelConfig := service.NewModelConfigService()
	runtimeModels := service.NewRuntimeModelCatalog()
	handlers := NewProviderHandlers(
		providerConfig,
		modelConfig,
		service.NewCredentialConfigService(),
		service.NewRuntimeAdmissionResolver(providerConfig, modelConfig),
		runtimeModels,
		service.NewProviderModelDiscoveryService(runtimeModels),
		service.NewRuntimeDefaultService(),
	)
	ctx := context.Background()

	tests := []struct {
		name string
		run  func() error
	}{
		{
			name: "create",
			run: func() error {
				_, err := handlers.HandleModelCreate(ctx, &model.CreateModelRequest{
					ProviderId: "test-cli",
					ModelId:    "manual-model",
				})
				return err
			},
		},
		{
			name: "update",
			run: func() error {
				_, err := handlers.HandleModelUpdate(ctx, &model.UpdateModelRequest{
					ProviderId: "test-cli",
					ModelId:    "manual-model",
				})
				return err
			},
		},
		{
			name: "hide",
			run: func() error {
				_, err := handlers.HandleModelHide(ctx, &model.HideModelRequest{
					ProviderId: "test-cli",
					ModelId:    "manual-model",
				})
				return err
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.run()
			if err == nil || !strings.Contains(err.Error(), "read-only") {
				t.Fatalf("CLI model %s error = %v, want read-only rejection", test.name, err)
			}
		})
	}
}
