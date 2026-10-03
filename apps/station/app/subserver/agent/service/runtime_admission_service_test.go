package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestParseModelCapabilityFlagsRequiresExplicitDatabaseFacts(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want runtimeCapabilityFacts
	}{
		{
			name: "explicit list",
			raw:  `["chat","streaming","vision","tools"]`,
			want: runtimeCapabilityFacts{
				"text-input":   true,
				"streaming":    true,
				"image-input":  true,
				"native-tools": true,
			},
		},
		{
			name: "explicit map preserves false override",
			raw:  `{"vision":true,"pdf":true,"parallel_tools":false}`,
			want: runtimeCapabilityFacts{
				"image-input":    true,
				"file-input":     true,
				"parallel-tools": false,
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseModelCapabilityFlags([]byte(test.raw))
			if err != nil {
				t.Fatalf("parse capability flags: %v", err)
			}
			if len(got) != len(test.want) {
				t.Fatalf("capability count=%d, want %d: %+v", len(got), len(test.want), got)
			}
			for capabilityID, want := range test.want {
				if got[capabilityID] != want {
					t.Fatalf("capability %q=%v, want %v", capabilityID, got[capabilityID], want)
				}
			}
		})
	}
}

func TestParseModelCapabilityFlagsRejectsMalformedAuthority(t *testing.T) {
	if _, err := parseModelCapabilityFlags([]byte(`{`)); err == nil {
		t.Fatal("malformed capability authority must fail closed")
	}
}

func openAdmissionTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open admission test database: %v", err)
	}
	if err := db.AutoMigrate(
		&persistence.AgentProvider{},
		&persistence.AgentModel{},
		&persistence.Credential{},
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
				{
					ID:            "test-model",
					DisplayName:   "Test Model",
					Type:          "chat",
					Enabled:       true,
					ContextWindow: 128000,
					Capabilities:  []string{"text-input", "text-output", "streaming", "structured-output", "native-tools"},
				},
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
		ActorPTID:   actorID,
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

func seedTestModel(
	t *testing.T,
	db *gorm.DB,
	actorPTID string,
	providerID string,
	modelID string,
	enabled bool,
	contextWindow int,
	capabilities string,
) {
	t.Helper()
	modelRecord := &persistence.AgentModel{
		ID:               generateID("model"),
		ActorPTID:        actorPTID,
		ProviderID:       providerID,
		ModelID:          modelID,
		DisplayName:      "Database Model",
		Enabled:          true,
		ContextWindow:    contextWindow,
		CapabilitiesJSON: json.RawMessage(capabilities),
		Version:          1,
	}
	if err := db.Create(modelRecord).Error; err != nil {
		t.Fatalf("seed model: %v", err)
	}
	if !enabled {
		if err := db.Model(&persistence.AgentModel{}).
			Where("id = ?", modelRecord.ID).
			Update("enabled", false).Error; err != nil {
			t.Fatalf("disable model: %v", err)
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
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) ||
		bizErr.Code != errcode.AgentRuntimeUnavailable ||
		bizErr.HTTPStatus != 503 ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentRuntimeUnavailable) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentRuntimeUnavailableLocaleKey ||
		!bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		bizErr.Payload.GetDetails()["runtime_kind"] != "direct_model" ||
		bizErr.Payload.GetDetails()["reason_code"] != "provider_disabled" {
		t.Fatalf("disabled provider payload = %+v", bizErr)
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
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) {
		t.Fatalf("missing credential error type = %T, want *errcode.BizError", err)
	}
	if bizErr.Code != errcode.AgentProviderCredentialMissing ||
		bizErr.Payload.GetErrorType() != string(errcode.AgentProviderCredentialMissing) ||
		bizErr.Payload.GetLocaleKey() != errcode.AgentProviderCredentialMissingLocaleKey ||
		!bizErr.Payload.GetRetryable() ||
		!bizErr.Payload.GetTerminal() ||
		bizErr.Payload.GetDetails()["provider_id"] != "test-provider" {
		t.Fatalf("missing credential payload = %+v", bizErr)
	}
}

func TestCredentialPoolLeaseRejectsMissingCredentialWithTypedPayload(t *testing.T) {
	openAdmissionTestDB(t, "credential_pool_missing")

	_, err := NewCredentialPoolService().Lease(
		context.Background(),
		"actor-1",
		"test-provider",
		domain.RotationRoundRobin,
	)
	if err == nil {
		t.Fatal("expected error for missing credential, got nil")
	}
	var bizErr *errcode.BizError
	if !errors.As(err, &bizErr) {
		t.Fatalf("missing credential error type = %T, want *errcode.BizError", err)
	}
	if bizErr.Code != errcode.AgentProviderCredentialMissing ||
		bizErr.Payload.GetDetails()["provider_id"] != "test-provider" {
		t.Fatalf("missing credential payload = %+v", bizErr)
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
	if snapshot.ProviderConfigVersion != "1" {
		t.Fatalf(
			"expected provider config version 1, got %s",
			snapshot.ProviderConfigVersion,
		)
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
	provenance := snapshot.Capabilities.GetProvenance()
	if provenance.GetDiscoverySource() != runtimeCapabilityDiscoverySource ||
		provenance.GetSourceVersion() == "" ||
		provenance.GetObservedAt() == nil {
		t.Fatalf("runtime capability provenance is incomplete: %+v", provenance)
	}
	if !snapshot.Capabilities.GetRuntime().GetStreaming() ||
		!snapshot.Capabilities.GetOutput().GetStructured() ||
		!snapshot.Capabilities.GetAgentic().GetNativeTools() {
		t.Fatalf("catalog capability facts were not projected: %+v", snapshot.Capabilities)
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

func TestRuntimeAdmissionSnapshotIDChangesWithInputCapabilities(t *testing.T) {
	budget := defaultRuntimeBudget(128000)
	observedAt := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	withoutImage := buildCapabilitySnapshot(
		"provider-1",
		"model-1",
		128000,
		nil,
		nil,
		runtimeCapabilityFacts{"text-input": true, "text-output": true},
		"cap-src-1",
		observedAt,
	)
	withImage := buildCapabilitySnapshot(
		"provider-1",
		"model-1",
		128000,
		nil,
		nil,
		runtimeCapabilityFacts{
			"text-input":  true,
			"text-output": true,
			"image-input": true,
		},
		"cap-src-1",
		observedAt,
	)

	first, err := computeSnapshotID("actor-1", "provider-1", "model-1", withoutImage, budget)
	if err != nil {
		t.Fatalf("hash snapshot without image: %v", err)
	}
	second, err := computeSnapshotID("actor-1", "provider-1", "model-1", withImage, budget)
	if err != nil {
		t.Fatalf("hash snapshot with image: %v", err)
	}
	if first == second {
		t.Fatal("snapshot ID must change when model input capabilities change")
	}
}

func TestRuntimeAdmissionSnapshotIDChangesWithCapabilitySourceVersion(t *testing.T) {
	budget := defaultRuntimeBudget(128000)
	observedAt := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	facts := runtimeCapabilityFacts{"text-input": true, "text-output": true}
	firstSnapshot := buildCapabilitySnapshot(
		"provider-1", "model-1", 128000, nil, nil, facts, "cap-src-1", observedAt,
	)
	secondSnapshot := buildCapabilitySnapshot(
		"provider-1", "model-1", 128000, nil, nil, facts, "cap-src-2", observedAt,
	)

	first, err := computeSnapshotID("actor-1", "provider-1", "model-1", firstSnapshot, budget)
	if err != nil {
		t.Fatalf("hash first snapshot: %v", err)
	}
	second, err := computeSnapshotID("actor-1", "provider-1", "model-1", secondSnapshot, budget)
	if err != nil {
		t.Fatalf("hash second snapshot: %v", err)
	}
	if first == second {
		t.Fatal("snapshot ID must change when capability source version changes")
	}
}

func TestRuntimeAdmissionDoesNotInferReasoningFromModelName(t *testing.T) {
	snapshot := buildCapabilitySnapshot(
		"provider-1",
		"o3-reasoning-model",
		128000,
		nil,
		nil,
		runtimeCapabilityFacts{"text-input": true, "text-output": true},
		"cap-src-explicit",
		time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	)
	if snapshot.GetRuntime().GetReasoning() {
		t.Fatal("reasoning capability must not be inferred from the model name")
	}
}

func TestRuntimeCapabilitySnapshotUsesCatalogProviderProtocol(t *testing.T) {
	provider := &catalog.CatalogProvider{
		ID:          "ollama",
		Protocol:    "ollama",
		RuntimeKind: "http",
	}
	snapshot := buildCapabilitySnapshot(
		"ollama",
		"local-model",
		8192,
		provider,
		nil,
		runtimeCapabilityFacts{"text-input": true, "text-output": true},
		"cap-src-ollama",
		time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	)
	resolutions := runtimeCapabilityResolution(snapshot)
	if resolutions["protocol"] !=
		model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE {
		t.Fatalf("catalog protocol resolution = %s", resolutions["protocol"])
	}
	for _, resolution := range snapshot.GetResolution() {
		if resolution.GetCapabilityId() == "protocol" &&
			resolution.GetReasonCode() != "ollama" {
			t.Fatalf("catalog protocol reason = %q, want ollama", resolution.GetReasonCode())
		}
	}
}

func TestDefaultRuntimeBudgetNeverExceedsSmallContextWindow(t *testing.T) {
	for _, contextWindow := range []int32{2, 4096, 8192, 16383} {
		budget := defaultRuntimeBudget(contextWindow)
		total := budget.GetMaxInputTokens() + budget.GetMaxOutputTokens()
		if total > uint64(contextWindow) || budget.GetMaxOutputTokens() == 0 {
			t.Fatalf(
				"context window %d produced input/output budget %d/%d",
				contextWindow,
				budget.GetMaxInputTokens(),
				budget.GetMaxOutputTokens(),
			)
		}
	}
	if budget := defaultRuntimeBudget(0); budget.GetMaxInputTokens() == 0 ||
		budget.GetMaxOutputTokens() == 0 {
		t.Fatalf("unknown context window produced an unbounded zero budget: %+v", budget)
	}
}

func TestResolveModelCapabilityFactsAppliesDatabaseOverrides(t *testing.T) {
	catalogModel := &catalog.CatalogModel{
		Type:            "chat",
		ThinkingControl: "ark",
		Capabilities:    []string{"streaming", "native-tools"},
	}
	databaseModel := &persistence.AgentModel{
		CapabilitiesJSON: json.RawMessage(
			`{"streaming":false,"vision":true,"parallel_tools":true}`,
		),
	}
	facts, err := resolveModelCapabilityFacts(catalogModel, databaseModel)
	if err != nil {
		t.Fatalf("resolve capability facts: %v", err)
	}
	if facts["streaming"] ||
		!facts["reasoning"] ||
		!facts["image-input"] ||
		!facts["parallel-tools"] ||
		!facts["text-input"] ||
		!facts["text-output"] {
		t.Fatalf("database capability overrides were not applied: %+v", facts)
	}
}

func TestRuntimeCapabilitySourceVersionUsesNormalizedFactsAndAuthorityVersions(t *testing.T) {
	provider := &persistence.AgentProvider{Version: 3}
	firstModel := &persistence.AgentModel{
		Version:          7,
		ContextWindow:    128000,
		CapabilitiesJSON: json.RawMessage(`["vision","streaming"]`),
	}
	secondModel := &persistence.AgentModel{
		Version:          7,
		ContextWindow:    128000,
		CapabilitiesJSON: json.RawMessage(`["streaming","vision"]`),
	}
	facts := runtimeCapabilityFacts{
		"text-input":  true,
		"text-output": true,
		"image-input": true,
		"streaming":   true,
	}
	budget := defaultRuntimeBudget(128000)

	first, err := runtimeCapabilitySourceVersion(
		nil,
		nil,
		provider,
		firstModel,
		facts,
		128000,
		budget,
	)
	if err != nil {
		t.Fatalf("hash first capability source: %v", err)
	}
	second, err := runtimeCapabilitySourceVersion(
		nil,
		nil,
		provider,
		secondModel,
		facts,
		128000,
		budget,
	)
	if err != nil {
		t.Fatalf("hash reordered capability source: %v", err)
	}
	if first != second {
		t.Fatalf("equivalent capability facts changed source version: %s != %s", first, second)
	}

	secondModel.Version++
	changed, err := runtimeCapabilitySourceVersion(
		nil,
		nil,
		provider,
		secondModel,
		facts,
		128000,
		budget,
	)
	if err != nil {
		t.Fatalf("hash changed capability source: %v", err)
	}
	if first == changed {
		t.Fatal("model authority version must change capability source version")
	}
}

func TestRuntimeCapabilityResolutionClassifiesUnsupportedFacts(t *testing.T) {
	snapshot := buildCapabilitySnapshot(
		"provider-1",
		"model-1",
		128000,
		nil,
		nil,
		runtimeCapabilityFacts{"text-input": true, "text-output": true},
		"cap-src-1",
		time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	)
	resolutions := runtimeCapabilityResolution(snapshot)
	if resolutions["text-input"] !=
		model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_NATIVE {
		t.Fatalf("text input resolution = %s", resolutions["text-input"])
	}
	if resolutions["image-input"] !=
		model.RuntimeCapabilityResolution_RUNTIME_CAPABILITY_RESOLUTION_REJECTED {
		t.Fatalf("image input resolution = %s", resolutions["image-input"])
	}
}

func TestProviderAdvertisementRequiresImplementedRuntimeProtocolPair(t *testing.T) {
	for _, test := range []struct {
		runtime  string
		protocol string
		want     bool
	}{
		{runtime: "http", protocol: "openai-compatible", want: true},
		{runtime: "http", protocol: "openai", want: true},
		{runtime: "http", protocol: "anthropic", want: true},
		{runtime: "http", protocol: "ollama", want: true},
		{runtime: "cli", protocol: "cli", want: true},
		{runtime: "http", protocol: "gemini", want: false},
		{runtime: "http", protocol: "cli", want: false},
		{runtime: "cli", protocol: "openai-compatible", want: false},
		{runtime: "external_agent", protocol: "cli", want: false},
		{runtime: "http", protocol: "", want: false},
	} {
		if got := ProviderRuntimeAdvertised(test.runtime, test.protocol); got != test.want {
			t.Fatalf(
				"provider runtime/protocol %q/%q advertised=%v, want %v",
				test.runtime,
				test.protocol,
				got,
				test.want,
			)
		}
	}
}

func TestAdvertisedCatalogModelsDeclareRuntimeCapabilities(t *testing.T) {
	for _, provider := range catalog.List() {
		if !catalogProviderAdvertised(provider) {
			continue
		}
		for _, catalogModel := range provider.Models {
			if !catalogModel.Enabled || catalogModel.Type != "chat" {
				continue
			}
			facts, err := resolveModelCapabilityFacts(&catalogModel, nil)
			if err != nil {
				t.Fatalf(
					"resolve catalog capability facts for %s/%s: %v",
					provider.ID,
					catalogModel.ID,
					err,
				)
			}
			if len(catalogModel.Capabilities) == 0 ||
				!facts["text-input"] ||
				!facts["text-output"] {
				t.Fatalf(
					"advertised catalog model %s/%s lacks explicit text capability facts",
					provider.ID,
					catalogModel.ID,
				)
			}
		}
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
	if !models[0].Capabilities["streaming"] ||
		!models[0].Capabilities["native-tools"] {
		t.Fatalf("available model dropped runtime capabilities: %+v", models[0])
	}
}

func TestRuntimeAdmissionConditionallyAdvertisesExternalAgent(t *testing.T) {
	catalog.SetForTesting([]catalog.CatalogProvider{{
		ID:          "external-agent",
		Name:        "External Agent",
		Enabled:     true,
		ShowAPIKey:  runtimeAdmissionBoolPointer(false),
		RuntimeKind: "external-agent",
		Protocol:    "session-cli-v1",
		Models: []catalog.CatalogModel{{
			ID:            "default",
			DisplayName:   "Default",
			Type:          "chat",
			Enabled:       true,
			ContextWindow: 200000,
			Capabilities:  []string{"text-input", "text-output", "streaming", "external-resume"},
		}},
	}})
	defer catalog.RestoreForTesting()
	openAdmissionTestDB(t, "admission_external_runtime")

	resolver := NewRuntimeAdmissionResolver(
		NewProviderConfigService(),
		NewModelConfigService(),
	)
	models, err := resolver.ListAvailableModels(context.Background(), "actor-1")
	if err != nil {
		t.Fatalf("list without external adapter: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("unhealthy external adapter was advertised: %+v", models)
	}

	resolver.SetExternalRuntimeAvailability(func() bool { return true })
	models, err = resolver.ListAvailableModels(context.Background(), "actor-1")
	if err != nil {
		t.Fatalf("list with external adapter: %v", err)
	}
	if len(models) != 1 || models[0].ProviderID != "external-agent" {
		t.Fatalf("healthy external adapter models = %+v", models)
	}
	admission, err := resolver.Resolve(
		context.Background(),
		"actor-1",
		"external-agent",
		"default",
	)
	if err != nil {
		t.Fatalf("resolve external runtime: %v", err)
	}
	if admission.RuntimeKind != model.RuntimeKind_RUNTIME_KIND_EXTERNAL_AGENT ||
		admission.RuntimeProfileID != modernChatAgentProfileID ||
		!admission.Capabilities.GetRuntime().GetExternalResume() {
		t.Fatalf("external admission = %+v", admission)
	}
}

func runtimeAdmissionBoolPointer(value bool) *bool {
	return &value
}

func TestCatalogProviderAvailableRequiresCLIExecutable(t *testing.T) {
	available := catalog.CatalogProvider{
		RuntimeKind: "cli",
		Protocol:    "cli",
		CliCommand:  os.Args[0],
	}
	if !CatalogProviderAvailable(available) {
		t.Fatal("executable CLI provider was not available")
	}

	missing := available
	missing.CliCommand = "peers-touch-cli-that-does-not-exist"
	if CatalogProviderAvailable(missing) {
		t.Fatal("missing CLI provider binary remained available")
	}

	httpProvider := catalog.CatalogProvider{
		RuntimeKind: "http",
		Protocol:    "openai-compatible",
	}
	if !CatalogProviderAvailable(httpProvider) {
		t.Fatal("HTTP provider availability must not depend on a CLI binary")
	}
}

func TestRuntimeAdmissionListAvailableModelsIncludesGovernedToolCustomProvider(t *testing.T) {
	catalog.SetForTesting(nil)
	defer catalog.RestoreForTesting()
	db := openAdmissionTestDB(t, "admission_list_custom_provider")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "custom-provider", true, string(keyVaults))
	if err := db.Model(&persistence.AgentProvider{}).
		Where("actor_ptid = ? AND name = ?", "actor-1", "custom-provider").
		Update("display_name", "Custom Provider").Error; err != nil {
		t.Fatalf("set custom provider display name: %v", err)
	}
	seedTestModel(
		t,
		db,
		"actor-1",
		"custom-provider",
		"custom-model",
		true,
		8192,
		`{"streaming":true,"native-tools":true}`,
	)

	resolver := NewRuntimeAdmissionResolver(
		NewProviderConfigService(),
		NewModelConfigService(),
	)
	models, err := resolver.ListAvailableModels(context.Background(), "actor-1")
	if err != nil {
		t.Fatalf("list available models: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("expected custom provider model, got %+v", models)
	}
	got := models[0]
	if got.ID != "custom-model" ||
		got.ProviderID != "custom-provider" ||
		got.ProviderName != "Custom Provider" ||
		got.Type != "chat" ||
		!got.Enabled ||
		got.ContextWindow != 8192 ||
		!got.Capabilities["streaming"] ||
		!got.Capabilities["native-tools"] {
		t.Fatalf("custom provider model projection = %+v", got)
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

func TestRuntimeAdmissionListAvailableModelsAppliesDatabaseOverride(t *testing.T) {
	restore := setupTestCatalog()
	defer restore()
	db := openAdmissionTestDB(t, "admission_list_database_override")

	keyVaults, _ := json.Marshal(map[string]string{"api_key": "test-key"})
	seedTestProvider(t, db, "actor-1", "test-provider", true, string(keyVaults))
	seedTestModel(
		t,
		db,
		"actor-1",
		"test-provider",
		"test-model",
		false,
		64000,
		`{"streaming":true}`,
	)

	resolver := NewRuntimeAdmissionResolver(
		NewProviderConfigService(),
		NewModelConfigService(),
	)
	models, err := resolver.ListAvailableModels(context.Background(), "actor-1")
	if err != nil {
		t.Fatalf("list available models: %v", err)
	}
	if len(models) != 0 {
		t.Fatalf("disabled database override left catalog model selectable: %+v", models)
	}
}
