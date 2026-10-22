package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestModelConfigCreateAndUpdatePersistCanonicalCapabilities(t *testing.T) {
	openAdmissionTestDB(t, "model_config_capabilities")
	models := NewModelConfigService()
	ctx := context.Background()

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
