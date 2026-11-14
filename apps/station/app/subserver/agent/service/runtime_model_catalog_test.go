package service

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestRuntimeModelCatalogIsActorScoped(t *testing.T) {
	runtimeCatalog := NewRuntimeModelCatalog()
	recordA := &persistence.AgentProvider{ActorPTID: "actor-a", Name: "trae-cli", Version: 1}
	recordB := &persistence.AgentProvider{ActorPTID: "actor-b", Name: "trae-cli", Version: 1}
	observedAt := time.Now().UTC()
	runtimeCatalog.Replace(
		recordA,
		[]catalog.CatalogModel{{ID: "actor-a-model"}},
		observedAt,
	)
	runtimeCatalog.Replace(
		recordB,
		[]catalog.CatalogModel{{ID: "actor-b-model"}},
		observedAt,
	)

	base := catalog.CatalogProvider{
		ID:     "trae-cli",
		Models: []catalog.CatalogModel{{ID: "registered-default"}},
	}
	actorA := runtimeCatalog.EffectiveProvider(recordA, base)
	actorB := runtimeCatalog.EffectiveProvider(recordB, base)
	actorC := runtimeCatalog.EffectiveProvider(&persistence.AgentProvider{ActorPTID: "actor-c", Name: "trae-cli"}, base)

	if len(actorA.Models) != 1 || actorA.Models[0].ID != "actor-a-model" {
		t.Fatalf("actor A catalog = %+v", actorA.Models)
	}
	if len(actorB.Models) != 1 || actorB.Models[0].ID != "actor-b-model" {
		t.Fatalf("actor B catalog = %+v", actorB.Models)
	}
	if len(actorC.Models) != 1 || actorC.Models[0].ID != "registered-default" {
		t.Fatalf("undiscovered actor catalog = %+v", actorC.Models)
	}
}

func TestRuntimeModelCatalogOwnsAnImmutableSnapshot(t *testing.T) {
	runtimeCatalog := NewRuntimeModelCatalog()
	record := &persistence.AgentProvider{ActorPTID: "actor-a", Name: "trae-cli", Version: 1}
	input := []catalog.CatalogModel{{
		ID:                       "model-1",
		Capabilities:             []string{"streaming"},
		SupportedReasoningLevels: []string{"high"},
	}}
	runtimeCatalog.Replace(
		record,
		input,
		time.Now().UTC(),
	)

	input[0].Capabilities[0] = "mutated-input"
	first, _, ok := runtimeCatalog.Models(record)
	if !ok {
		t.Fatal("runtime catalog snapshot is missing")
	}
	first[0].SupportedReasoningLevels[0] = "mutated-read"

	second, _, ok := runtimeCatalog.Models(record)
	if !ok {
		t.Fatal("runtime catalog snapshot is missing after read")
	}
	if second[0].Capabilities[0] != "streaming" ||
		second[0].SupportedReasoningLevels[0] != "high" {
		t.Fatalf("runtime catalog snapshot was mutated through an alias: %+v", second[0])
	}
}
