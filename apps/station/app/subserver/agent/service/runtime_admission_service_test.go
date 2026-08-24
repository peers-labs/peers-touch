package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openAdmissionTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open admission test database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.AgentProvider{},
		&persistence.AgentModel{},
		&persistence.TurnAttempt{},
	); err != nil {
		t.Fatalf("migrate admission test database: %v", err)
	}
	injectOrchestrationServiceTestStore(t, db)
	return db
}

func setupTestCatalog() func() {
	showAPIKey := true
	catalog.SetForTesting([]catalog.CatalogProvider{
		{
			ID:          "test-provider",
			Name:        "Test Provider",
			Enabled:     true,
			Protocol:    "openai-compatible",
			RuntimeKind: "http",
			ShowAPIKey:  &showAPIKey,
			Models: []catalog.CatalogModel{
				{ID: "test-model", DisplayName: "Test Model", Type: "chat", Enabled: true, ContextWindow: 128000},
				{ID: "disabled-model", DisplayName: "Disabled", Type: "chat", Enabled: false, ContextWindow: 8192},
				{ID: "embed-model", DisplayName: "Embed", Type: "embedding", Enabled: true, ContextWindow: 8192},
			},
		},
	})
	return catalog.RestoreForTesting
}

func seedTestProvider(t *testing.T, db *gorm.DB, actorID, name string, enabled bool, keyVaults string) {
	t.Helper()
	provider := persistence.AgentProvider{
		ID:          generateID("prov"),
		ActorID:     actorID,
		Name:        name,
		Enabled:     true,
		Protocol:    "openai-compatible",
		RuntimeKind: "http",
		KeyVaults:   keyVaults,
	}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	if !enabled {
		if err := db.Model(&persistence.AgentProvider{}).
			Where("id = ?", provider.ID).
			Update("enabled", false).Error; err != nil {
			t.Fatalf("disable provider: %v", err)
		}
	}
}

func TestRuntimeAdmissionResolveRejectsMissingProvider(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	openAdmissionTestDB(t, "admission_missing_provider")

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	_, err := resolver.Resolve(ctx, "actor-1", "nonexistent", "test-model")
	if err == nil {
		t.Fatal("expected error for nonexistent provider, got nil")
	}
}

func TestRuntimeAdmissionResolveRejectsDisabledProvider(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_disabled_provider")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", false, string(keyVaults))

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	_, err := resolver.Resolve(ctx, "actor-1", "test-provider", "test-model")
	if err == nil {
		t.Fatal("expected error for disabled provider, got nil")
	}
}

func TestRuntimeAdmissionResolveRejectsMissingCredential(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_missing_credential")

	seedTestProvider(t, db, "actor-1", "test-provider", true, "")

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	_, err := resolver.Resolve(ctx, "actor-1", "test-provider", "test-model")
	if err == nil {
		t.Fatal("expected error for missing credential, got nil")
	}
}

func TestRuntimeAdmissionResolveRejectsDisabledModel(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_disabled_model")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", true, string(keyVaults))

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	_, err := resolver.Resolve(ctx, "actor-1", "test-provider", "disabled-model")
	if err == nil {
		t.Fatal("expected error for disabled model, got nil")
	}
}

func TestRuntimeAdmissionResolveRejectsNonChatModel(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_nonchat_model")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", true, string(keyVaults))

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	_, err := resolver.Resolve(ctx, "actor-1", "test-provider", "embed-model")
	if err == nil {
		t.Fatal("expected error for non-chat model, got nil")
	}
}

func TestRuntimeAdmissionResolveRejectsNonexistentModel(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_nonexistent_model")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", true, string(keyVaults))

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	_, err := resolver.Resolve(ctx, "actor-1", "test-provider", "nonexistent-model")
	if err == nil {
		t.Fatal("expected error for nonexistent model, got nil")
	}
}

func TestRuntimeAdmissionResolveSuccess(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_success")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", true, string(keyVaults))

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	snapshot, err := resolver.Resolve(ctx, "actor-1", "test-provider", "test-model")
	if err != nil {
		t.Fatalf("expected successful admission, got error: %v", err)
	}
	if snapshot.SnapshotID == "" {
		t.Fatal("expected non-empty snapshot ID")
	}
	if snapshot.ProviderID != "test-provider" {
		t.Fatalf("expected provider ID test-provider, got %s", snapshot.ProviderID)
	}
	if snapshot.ModelID != "test-model" {
		t.Fatalf("expected model ID test-model, got %s", snapshot.ModelID)
	}
	if snapshot.Capabilities == nil {
		t.Fatal("expected non-nil capabilities")
	}
	if snapshot.Budget == nil {
		t.Fatal("expected non-nil budget")
	}
	if snapshot.Capabilities.Limits.ContextTokens != 128000 {
		t.Fatalf("expected context tokens 128000, got %d", snapshot.Capabilities.Limits.ContextTokens)
	}
}

func TestRuntimeAdmissionSnapshotIDIsDeterministic(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_deterministic")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", true, string(keyVaults))

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	snap1, err := resolver.Resolve(ctx, "actor-1", "test-provider", "test-model")
	if err != nil {
		t.Fatalf("first resolution failed: %v", err)
	}
	snap2, err := resolver.Resolve(ctx, "actor-1", "test-provider", "test-model")
	if err != nil {
		t.Fatalf("second resolution failed: %v", err)
	}
	if snap1.SnapshotID != snap2.SnapshotID {
		t.Fatalf("expected deterministic snapshot IDs, got %s and %s", snap1.SnapshotID, snap2.SnapshotID)
	}
}

func TestRuntimeAdmissionListAvailableModels(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_list_models")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", true, string(keyVaults))

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	models, err := resolver.ListAvailableModels(ctx, "actor-1")
	if err != nil {
		t.Fatalf("ListAvailableModels failed: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("expected 1 available model (only enabled chat model), got %d", len(models))
	}
	if models[0].ID != "test-model" {
		t.Fatalf("expected test-model, got %s", models[0].ID)
	}
}

func TestRuntimeAdmissionListAvailableModelsExcludesUnconfigured(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_list_unconfigured")

	seedTestProvider(t, db, "actor-1", "test-provider", true, "")

	resolver := NewRuntimeAdmissionResolver(NewProviderConfigService(), NewModelConfigService())
	ctx := context.Background()

	models, err := resolver.ListAvailableModels(ctx, "actor-1")
	if err != nil {
		t.Fatalf("ListAvailableModels failed: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("expected 0 models for unconfigured provider, got %d", len(models))
	}
}
