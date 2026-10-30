package service

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/managed"
)

func TestProviderManagementCheckUsesRegisteredArgvAndManagedBinary(t *testing.T) {
	catalog.SetForTesting([]catalog.CatalogProvider{{
		ID: "codex-cli", Name: "Codex", RuntimeKind: "cli", Protocol: "cli",
		CLIArgv: []string{"codex", "exec", "-"},
	}})
	defer catalog.RestoreForTesting()
	openAdmissionTestDB(t, "management_cli_binary_check")
	installer := managed.NewManager(t.TempDir())
	runtimeModels := NewRuntimeModelCatalog()
	providers := NewProviderConfigService()
	management := NewProviderManagementService(providers, NewModelConfigService(),
		NewCredentialConfigService(), runtimeModels, nil, installer)
	ctx, owner := context.Background(), ActorProviderOwner("actor-a")
	t.Setenv("PATH", "")
	policy, err := providers.SetPolicy(ctx, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := management.Check(ctx, owner, "codex-cli"); err == nil {
		t.Fatal("CLI check bypassed the disabled personal policy")
	}
	if _, err := providers.SetPolicy(ctx, true, policy.Revision); err != nil {
		t.Fatal(err)
	}
	missing, err := management.Check(ctx, owner, "codex-cli")
	if err != nil || missing.GetOk() || missing.GetProgram() != "codex" || missing.GetInstallHint() == "" {
		t.Fatalf("missing CLI check = %+v %v", missing, err)
	}
	if err := os.MkdirAll(installer.BinDir(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installer.BinDir(), "codex"), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	ready, err := management.Check(ctx, owner, "codex-cli")
	if err != nil || !ready.GetOk() || ready.GetProgram() != "codex" {
		t.Fatalf("managed CLI was missed or formatted argv was used as a binary name: %+v %v", ready, err)
	}
}

func TestProviderManagementCatalogEditorReadsBeforeConfiguration(t *testing.T) {
	defer setupTestCatalog()()
	openAdmissionTestDB(t, "management_unconfigured_catalog")
	runtimeModels := NewRuntimeModelCatalog()
	providers := NewProviderConfigService()
	management := NewProviderManagementService(providers, NewModelConfigService(),
		NewCredentialConfigService(), runtimeModels, nil, nil)
	ctx, owner := context.Background(), StationProviderOwner()
	detail, err := management.Get(ctx, owner, "test-provider")
	if err != nil || detail.GetProvider().GetVersion() != 0 {
		t.Fatalf("unconfigured catalog detail = %+v %v", detail, err)
	}
	if _, err := management.ListModels(ctx, owner, "test-provider"); err != nil {
		t.Fatal(err)
	}
	credential, err := management.CredentialStatus(ctx, owner, "test-provider")
	if err != nil || credential.GetStatus().GetConfigured() {
		t.Fatalf("unconfigured credential = %+v %v", credential, err)
	}
	access, err := management.Access(ctx, "test-provider")
	if err != nil || access.GetAccess().GetRevision() != 0 || len(access.GetAccess().GetGrants()) != 0 {
		t.Fatalf("catalog editor was blocked by absent grants: %+v %v", access, err)
	}
	if _, err := management.SetAccess(ctx, &model.SetProviderAccessRequest{ProviderId: "test-provider",
		Grants: []*model.ProviderAccessGrant{{AllActors: true, AllModels: true}},
	}); err == nil {
		t.Fatal("grant write implicitly configured an absent Provider")
	}
	if records, err := providers.ListOwned(ctx, owner); err != nil || len(records) != 0 {
		t.Fatalf("initial editor reads materialized shared resources: %+v %v", records, err)
	}
	if _, err := management.Access(ctx, "unknown-provider"); err == nil {
		t.Fatal("unknown Provider became a catalog editor")
	}
}

func TestProviderManagementMaterializationIsAtomicAndRejectsStaleCreates(t *testing.T) {
	defer setupTestCatalog()()
	db := openAdmissionTestDB(t, "provider_atomic_materialization")
	providers, models := NewProviderConfigService(), NewModelConfigService()
	runtimeModels := NewRuntimeModelCatalog()
	management := NewProviderManagementService(providers, models, NewCredentialConfigService(), runtimeModels,
		NewProviderModelDiscoveryService(runtimeModels), managed.NewManager(t.TempDir()))
	ctx, owner := context.Background(), StationProviderOwner()
	disabled := false
	name, baseURL := "Configured name", "https://configured.example/v1"
	request := &model.UpdateProviderRequest{ProviderId: "test-provider", Enabled: &disabled,
		DisplayName: &name, BaseUrl: &baseURL}
	result, err := management.Update(ctx, owner, request)
	if err != nil || result.GetProvider().GetEnabled() || result.GetProvider().GetVersion() != 1 ||
		result.GetProvider().GetName() != name || result.GetProvider().GetBaseUrl() != baseURL {
		t.Fatalf("initial configuration was not materialized in its final state: %+v %v", result, err)
	}
	if request.Version != 0 {
		t.Fatal("management mutated caller's optimistic revision")
	}
	if _, err := management.Update(ctx, owner, request); err == nil {
		t.Fatal("stale absent revision overwrote an existing provider")
	}
	if field := (&model.UpdateProviderRequest{}).ProtoReflect().Descriptor().Fields().ByName("key_vaults"); field != nil {
		t.Fatal("generic provider configuration exposes a credential field")
	}
	if _, err := providers.Update(ctx, ProviderUpdateRequest{Scope: ProviderScopeStation,
		ProviderID: "test-provider", Version: 1, ConfigJSON: []byte(`{"api_key":"plaintext-must-not-persist"}`)}); err == nil {
		t.Fatal("provider generic JSON accepted a secret")
	}
	record, err := providers.GetOwned(ctx, owner, "test-provider")
	if err != nil || record.Enabled || record.Version != 1 || record.KeyVaults != "" {
		t.Fatalf("rejected mutations changed persisted state: %+v %v", record, err)
	}
	// Inaccessible legacy actor rows must never become Station resources.
	if err := db.Create(&persistence.AgentProvider{ID: "legacy-orphan", Scope: ProviderScopeActor,
		Name: "test-provider", ActorPTID: "", Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if shared, err := providers.GetOwned(ctx, owner, "test-provider"); err != nil || shared.ID == "legacy-orphan" {
		t.Fatal("legacy unowned actor row was reclassified as shared")
	}
}

func TestProviderControlPlaneMissingKEKRemovesCredentialReadiness(t *testing.T) {
	defer setupTestCatalog()()
	openAdmissionTestDB(t, "provider_missing_kek_readiness")
	providers := NewProviderConfigService()
	ctx := context.Background()
	record, err := providers.Create(ctx, ProviderCreateRequest{Scope: ProviderScopeStation, ProviderID: "test-provider"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewCredentialConfigService().Set(ctx, CredentialSetRequest{Scope: ProviderScopeStation,
		ProviderID: record.Name, APIKey: "test-key"}); err != nil {
		t.Fatal(err)
	}
	if _, err := providers.SetAccess(ctx, record.Name, 0,
		[]persistence.ProviderAccessGrant{{AllActors: true, AllModels: true}}); err != nil {
		t.Fatal(err)
	}
	resolver := NewRuntimeAdmissionResolver(providers, NewModelConfigService())
	if models, err := resolver.ListAvailableModels(ctx, "actor-a"); err != nil || len(models) != 1 {
		t.Fatalf("configured shared model is unavailable: %+v %v", models, err)
	}
	t.Setenv("PT_SECRET_KEK", "")
	t.Setenv("PT_SECRET_KEK_FILE", "")
	if models, err := resolver.ListAvailableModels(ctx, "actor-a"); err != nil || len(models) != 0 {
		t.Fatalf("shared model remained ready without its KEK: %+v %v", models, err)
	}
	if _, err := resolver.Resolve(ctx, "actor-a", record.Name, "test-model"); err == nil {
		t.Fatal("missing KEK passed runtime admission")
	}
}

func TestRuntimeDefaultCASPreservesAccountIsolation(t *testing.T) {
	db := openAdmissionTestDB(t, "runtime_default_cas")
	if err := db.AutoMigrate(&persistence.AgentRuntimeDefault{}); err != nil {
		t.Fatal(err)
	}
	service, ctx := NewRuntimeDefaultService(), context.Background()
	alice, err := service.SetRuntimeDefault(ctx, "actor-a", "provider-a", "model-a", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetRuntimeDefault(ctx, "actor-a", "provider-b", "model-b", 0); err == nil {
		t.Fatal("absent revision overwrote an existing account preference")
	}
	if _, err := service.SetRuntimeDefault(ctx, "actor-a", "provider-b", "model-b", alice.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetRuntimeDefault(ctx, "actor-b", "provider-c", "model-c", 0); err != nil {
		t.Fatal(err)
	}
	if current, found, err := service.GetRuntimeDefault(ctx, "actor-a"); err != nil || !found ||
		current.DefaultProviderID != "provider-b" || current.Revision != 2 {
		t.Fatalf("another account changed Alice's preference: %+v %v", current, err)
	}
	if _, _, err := service.GetRuntimeDefault(ctx, ""); err == nil {
		t.Fatal("unauthenticated account read a default")
	}
}

func TestProviderManagementCLIModelsAreReadOnly(t *testing.T) {
	defer setupTestCatalog()()
	openAdmissionTestDB(t, "management_cli_models_readonly")
	management := NewProviderManagementService(NewProviderConfigService(), NewModelConfigService(),
		NewCredentialConfigService(), nil, nil, nil)
	ctx := context.Background()
	enabled := false
	for _, version := range []int64{0, 1} {
		if _, err := management.UpdateModel(ctx, StationProviderOwner(), &model.UpdateModelRequest{
			ProviderId: "trae-cli", ModelId: "default", Version: version, Enabled: &enabled,
		}); err == nil {
			t.Fatal("CLI model mutation bypassed the read-only catalog")
		}
	}
	if _, err := management.CreateModel(ctx, StationProviderOwner(), &model.CreateModelRequest{
		ProviderId: "trae-cli", ModelId: "custom",
	}); err == nil {
		t.Fatal("CLI model creation bypassed discovery")
	}
}
