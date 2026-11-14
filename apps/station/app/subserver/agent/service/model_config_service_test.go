package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestModelConfigCreateAndUpdatePersistCanonicalCapabilities(t *testing.T) {
	openAdmissionTestDB(t, "model_config_capabilities")
	models := NewModelConfigService()
	ctx := context.Background()
	if _, err := NewProviderConfigService().Create(ctx, ProviderCreateRequest{
		ActorPTID: "actor-1", ProviderID: "provider-1", Protocol: "openai",
	}); err != nil {
		t.Fatal(err)
	}

	created, err := models.Create(ctx, ModelCreateRequest{
		ActorPTID:     "actor-1",
		ProviderID:    "provider-1",
		ModelID:       "model-1",
		DisplayName:   "Model 1",
		Enabled:       true,
		ContextWindow: 128000,
		Capabilities: map[string]bool{
			"streaming":    true,
			"native-tools": false,
		},
	})
	if err != nil {
		t.Fatalf("create model: %v", err)
	}
	flags, err := DecodeModelCapabilityFlags(created.CapabilitiesJSON)
	if err != nil {
		t.Fatalf("decode created capabilities: %v", err)
	}
	if !flags["streaming"] || flags["native-tools"] {
		t.Fatalf("created capabilities = %+v", flags)
	}

	contextWindow := 64000
	updated, err := models.Update(ctx, ModelUpdateRequest{
		ActorPTID:     created.ActorPTID,
		ProviderID:    created.ProviderID,
		ModelID:       created.ModelID,
		Version:       created.Version,
		ContextWindow: &contextWindow,
		Capabilities: map[string]bool{
			"streaming":   true,
			"image-input": true,
		},
	})
	if err != nil {
		t.Fatalf("update model: %v", err)
	}
	flags, err = DecodeModelCapabilityFlags(updated.CapabilitiesJSON)
	if err != nil {
		t.Fatalf("decode updated capabilities: %v", err)
	}
	if updated.ContextWindow != contextWindow ||
		!flags["streaming"] ||
		!flags["image-input"] ||
		len(flags) != 2 {
		t.Fatalf("updated model = %+v, capabilities = %+v", updated, flags)
	}
}

func TestModelConfigCreatePersistsDisabledState(t *testing.T) {
	openAdmissionTestDB(t, "model_config_disabled")
	models := NewModelConfigService()
	ctx := context.Background()
	if _, err := NewProviderConfigService().Create(ctx, ProviderCreateRequest{
		ActorPTID: "actor-1", ProviderID: "provider-1", Protocol: "openai",
	}); err != nil {
		t.Fatal(err)
	}

	created, err := models.Create(ctx, ModelCreateRequest{
		ActorPTID:     "actor-1",
		ProviderID:    "provider-1",
		ModelID:       "disabled-model",
		DisplayName:   "Disabled Model",
		Enabled:       false,
		ContextWindow: 128000,
	})
	if err != nil {
		t.Fatalf("create disabled model: %v", err)
	}
	if created.Enabled {
		t.Fatalf("created model ignored disabled state: %+v", created)
	}

	persisted, err := models.List(ctx, created.ActorPTID, created.ProviderID)
	if err != nil {
		t.Fatalf("list disabled model: %v", err)
	}
	if len(persisted) != 1 || persisted[0].Enabled {
		t.Fatalf("disabled state was not persisted: %+v", persisted)
	}
}

func TestResolveEffectiveProviderModelsMergesCatalogOverride(t *testing.T) {
	provider := &catalog.CatalogProvider{
		ID: "provider-1",
		Models: []catalog.CatalogModel{{
			ID:            "model-1",
			DisplayName:   "Catalog Model",
			Type:          "chat",
			Enabled:       true,
			ContextWindow: 128000,
			Capabilities:  []string{"streaming", "native-tools"},
		}},
	}
	persisted := []persistence.AgentModel{{
		ID:               "model-record-1",
		ModelID:          "model-1",
		DisplayName:      "Actor Model",
		Enabled:          false,
		ContextWindow:    64000,
		CapabilitiesJSON: json.RawMessage(`{"native-tools":false}`),
		Version:          3,
	}}

	models, err := ResolveEffectiveProviderModels(provider, persisted, nil)
	if err != nil {
		t.Fatalf("resolve effective models: %v", err)
	}
	if len(models) != 1 ||
		models[0].Enabled ||
		models[0].DisplayName != "Actor Model" ||
		models[0].ContextWindow != 64000 ||
		!models[0].Capabilities["streaming"] ||
		models[0].Capabilities["native-tools"] ||
		models[0].PersistedModel == nil ||
		models[0].PersistedModel.Version != 3 {
		t.Fatalf("unexpected effective model: %+v", models)
	}
}

func TestModelConfigRejectsNonCanonicalCapabilityIDs(t *testing.T) {
	openAdmissionTestDB(t, "model_config_noncanonical_capabilities")
	_, err := NewModelConfigService().Create(context.Background(), ModelCreateRequest{
		ActorPTID:     "actor-1",
		ProviderID:    "provider-1",
		ModelID:       "model-1",
		DisplayName:   "Model 1",
		Enabled:       true,
		ContextWindow: 128000,
		Capabilities:  map[string]bool{"function_call": true},
	})
	if err == nil {
		t.Fatal("non-canonical capability ID must be rejected")
	}
}

func TestModelConfigContextWindowContract(t *testing.T) {
	defer setupTestCatalog()()
	openAdmissionTestDB(t, "model_context_contract")
	ctx, owner := context.Background(), StationProviderOwner()
	providers, models := NewProviderConfigService(), NewModelConfigService()
	for _, id := range []string{"custom-provider", "test-provider"} {
		if _, err := providers.Create(ctx, ProviderCreateRequest{Scope: owner.Scope, ProviderID: id, Protocol: "openai"}); err != nil {
			t.Fatal(err)
		}
	}
	assertInvalid := func(err error) {
		t.Helper()
		var business *errcode.BizError
		if !errors.As(err, &business) || business.Code != errcode.AgentInvalidRequest || business.HTTPStatus != http.StatusBadRequest {
			t.Fatalf("invalid context must fail with a client error: %v", err)
		}
	}
	for _, window := range []int{-1, 0, 1} {
		_, err := models.Create(ctx, ModelCreateRequest{Scope: owner.Scope,
			ProviderID: "custom-provider", ModelID: "custom", Enabled: true, ContextWindow: window})
		assertInvalid(err)
	}
	created, err := models.Create(ctx, ModelCreateRequest{Scope: owner.Scope,
		ProviderID: "custom-provider", ModelID: "custom", Enabled: true, ContextWindow: 131072})
	if err != nil {
		t.Fatal(err)
	}
	for _, window := range []int{0, 1} {
		_, err := models.Update(ctx, ModelUpdateRequest{Scope: owner.Scope, ProviderID: created.ProviderID,
			ModelID: created.ModelID, Version: created.Version, ContextWindow: &window})
		assertInvalid(err)
	}
	persisted, err := models.ListOwned(ctx, owner, created.ProviderID)
	if err != nil || len(persisted) != 1 || persisted[0].ContextWindow != 131072 || persisted[0].Version != created.Version {
		t.Fatalf("rejected context update changed the model: %+v %v", persisted, err)
	}
	disabled := false
	if _, err := models.Update(ctx, ModelUpdateRequest{Scope: owner.Scope, ProviderID: created.ProviderID,
		ModelID: created.ModelID, Version: created.Version, Enabled: &disabled}); err != nil {
		t.Fatalf("partial model update requires no context resubmission: %v", err)
	}
	inherited, err := models.Create(ctx, ModelCreateRequest{Scope: owner.Scope,
		ProviderID: "test-provider", ModelID: "test-model", Enabled: true})
	if err != nil {
		t.Fatalf("catalog context inheritance was rejected: %v", err)
	}
	effective, err := ResolveEffectiveProviderModels(catalog.Find("test-provider"), []persistence.AgentModel{*inherited}, nil)
	if err != nil || len(effective) == 0 || effective[0].ID != inherited.ModelID || effective[0].ContextWindow != 128000 {
		t.Fatalf("catalog inheritance has no usable context: %+v %v", effective, err)
	}
	zero := 0
	if _, err := models.Update(ctx, ModelUpdateRequest{Scope: owner.Scope, ProviderID: inherited.ProviderID,
		ModelID: inherited.ModelID, Version: inherited.Version, ContextWindow: &zero}); err != nil {
		t.Fatalf("resetting catalog inheritance failed: %v", err)
	}
	one := 1
	_, err = models.Update(ctx, ModelUpdateRequest{Scope: owner.Scope, ProviderID: inherited.ProviderID,
		ModelID: inherited.ModelID, Version: inherited.Version + 1, ContextWindow: &one})
	assertInvalid(err)
}
