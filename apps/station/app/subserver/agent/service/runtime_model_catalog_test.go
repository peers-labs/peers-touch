package service

import (
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
)

func TestRuntimeModelCatalogIsActorScoped(t *testing.T) {
	runtimeCatalog := NewRuntimeModelCatalog()
	observedAt := time.Now().UTC()
	runtimeCatalog.Replace(
		"actor-a",
		"trae-cli",
		[]catalog.CatalogModel{{ID: "actor-a-model"}},
		observedAt,
	)
	runtimeCatalog.Replace(
		"actor-b",
		"trae-cli",
		[]catalog.CatalogModel{{ID: "actor-b-model"}},
		observedAt,
	)

	base := catalog.CatalogProvider{
		ID:     "trae-cli",
		Models: []catalog.CatalogModel{{ID: "registered-default"}},
	}
	actorA := runtimeCatalog.EffectiveProvider("actor-a", base)
	actorB := runtimeCatalog.EffectiveProvider("actor-b", base)
	actorC := runtimeCatalog.EffectiveProvider("actor-c", base)

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
	input := []catalog.CatalogModel{{
		ID:                       "model-1",
		Capabilities:             []string{"streaming"},
		SupportedReasoningLevels: []string{"high"},
	}}
	runtimeCatalog.Replace(
		"actor-a",
		"trae-cli",
		input,
		time.Now().UTC(),
	)

	input[0].Capabilities[0] = "mutated-input"
	first, _, ok := runtimeCatalog.Models("actor-a", "trae-cli")
	if !ok {
		t.Fatal("runtime catalog snapshot is missing")
	}
	first[0].SupportedReasoningLevels[0] = "mutated-read"

	second, _, ok := runtimeCatalog.Models("actor-a", "trae-cli")
	if !ok {
		t.Fatal("runtime catalog snapshot is missing after read")
	}
	if second[0].Capabilities[0] != "streaming" ||
		second[0].SupportedReasoningLevels[0] != "high" {
		t.Fatalf("runtime catalog snapshot was mutated through an alias: %+v", second[0])
	}
}
