package service

import (
	"context"
	"testing"
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
			"streaming":   true,
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
			"streaming":  true,
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
