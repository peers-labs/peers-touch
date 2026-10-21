package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	providercli "github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
)

func TestProviderModelDiscoveryReplacesCatalogOnlyAfterSuccess(t *testing.T) {
	runtimeCatalog := NewRuntimeModelCatalog()
	previousObservedAt := time.Now().UTC().Add(-time.Minute)
	runtimeCatalog.Replace(
		"actor-a",
		"trae-cli",
		[]catalog.CatalogModel{{ID: "previous-model"}},
		previousObservedAt,
	)
	provider := &catalog.CatalogProvider{
		ID:               "trae-cli",
		RuntimeKind:      "cli",
		ModelCatalogArgv: []string{"traecli", "debug", "models"},
		DefaultTimeout:   120,
		Capabilities:     []string{"streaming"},
	}
	discovery := NewProviderModelDiscoveryService(runtimeCatalog)
	discovery.discover = func(
		_ context.Context,
		request providercli.ModelDiscoveryRequest,
	) ([]providercli.DiscoveredModel, error) {
		if request.Command[0] != "traecli" {
			t.Fatalf("discovery command = %#v", request.Command)
		}
		return nil, errors.New("discovery failed")
	}

	if _, _, err := discovery.Discover(
		context.Background(),
		"actor-a",
		provider,
		nil,
	); err == nil {
		t.Fatal("failed discovery unexpectedly succeeded")
	}
	models, observedAt, ok := runtimeCatalog.Models("actor-a", "trae-cli")
	if !ok ||
		len(models) != 1 ||
		models[0].ID != "previous-model" ||
		!observedAt.Equal(previousObservedAt) {
		t.Fatalf("failed discovery replaced the prior snapshot: %+v %v", models, observedAt)
	}

	discovery.discover = func(
		_ context.Context,
		_ providercli.ModelDiscoveryRequest,
	) ([]providercli.DiscoveredModel, error) {
		return []providercli.DiscoveredModel{{
			ID:                    "new-model",
			DisplayName:           "New Model",
			ContextWindow:         200000,
			Capabilities:          []string{"streaming", "reasoning"},
			DefaultReasoningLevel: "high",
		}}, nil
	}
	discovered, observedAt, err := discovery.Discover(
		context.Background(),
		"actor-a",
		provider,
		nil,
	)
	if err != nil {
		t.Fatalf("successful discovery returned error: %v", err)
	}
	if len(discovered) != 1 || discovered[0].ID != "new-model" {
		t.Fatalf("discovered models = %+v", discovered)
	}
	stored, storedObservedAt, ok := runtimeCatalog.Models("actor-a", "trae-cli")
	if !ok ||
		len(stored) != 1 ||
		stored[0].ID != "new-model" ||
		!storedObservedAt.Equal(observedAt) {
		t.Fatalf("successful discovery did not replace the snapshot: %+v %v", stored, storedObservedAt)
	}
}
