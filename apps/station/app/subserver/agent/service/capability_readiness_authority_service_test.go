package service

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestCapabilityReadinessModelSelectionUsesRequestedTopicModel(t *testing.T) {
	providerID, modelID, err := capabilityReadinessModelSelection(
		&domain.Agent{
			ProviderID: "legacy-provider",
			ModelName:  "legacy-model",
		},
		&model.GetCapabilityReadinessRequest{
			ProviderId: "topic-provider",
			ModelId:    "topic-model",
		},
	)
	if err != nil {
		t.Fatalf("resolve Topic model selection: %v", err)
	}
	if providerID != "topic-provider" || modelID != "topic-model" {
		t.Fatalf("unexpected Topic model selection: %s/%s", providerID, modelID)
	}
}

func TestCapabilityReadinessModelSelectionKeepsLegacyFallback(t *testing.T) {
	providerID, modelID, err := capabilityReadinessModelSelection(
		&domain.Agent{
			ProviderID: "legacy-provider",
			ModelName:  "legacy-model",
		},
		&model.GetCapabilityReadinessRequest{},
	)
	if err != nil {
		t.Fatalf("resolve legacy Agent model selection: %v", err)
	}
	if providerID != "legacy-provider" || modelID != "legacy-model" {
		t.Fatalf("unexpected legacy model selection: %s/%s", providerID, modelID)
	}
}

func TestCapabilityReadinessModelSelectionRejectsIncompleteSelection(t *testing.T) {
	for name, req := range map[string]*model.GetCapabilityReadinessRequest{
		"provider only": {ProviderId: "topic-provider"},
		"model only":    {ModelId: "topic-model"},
		"no selection":  {},
	} {
		t.Run(name, func(t *testing.T) {
			_, _, err := capabilityReadinessModelSelection(
				&domain.Agent{},
				req,
			)
			if err == nil {
				t.Fatal("incomplete runtime selection must fail closed")
			}
		})
	}
}
