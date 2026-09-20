package handler

import (
	"encoding/json"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestFrozenProfileDoesNotAdvertiseOptionalRuntimeKinds(t *testing.T) {
	for _, runtimeKind := range []string{"cli", "external_agent", "EXTERNAL_AGENT"} {
		if runtimeAdvertisedByFrozenProfile(runtimeKind) {
			t.Fatalf("runtime kind %q must not be advertised", runtimeKind)
		}
	}
	for _, runtimeKind := range []string{"", "http"} {
		if !runtimeAdvertisedByFrozenProfile(runtimeKind) {
			t.Fatalf("Direct Model runtime kind %q must remain advertised", runtimeKind)
		}
	}
}

func TestFrozenProfileKeepsCLIRegistrationDisabledAndUnadvertised(t *testing.T) {
	trae := catalog.Find("trae-cli")
	if trae == nil {
		t.Fatal("expected retained trae-cli catalog registration")
	}
	if trae.Enabled {
		t.Fatal("trae-cli registration must remain disabled")
	}
	if catalogProviderAdvertisedByFrozenProfile(*trae) {
		t.Fatal("disabled CLI registration must not enter the effective provider projection")
	}
}

func TestFrozenProfileDoesNotAdvertiseUnimplementedProviderProtocol(t *testing.T) {
	google := catalog.Find("google")
	if google == nil {
		t.Fatal("expected Google catalog registration")
	}
	if catalogProviderAdvertisedByFrozenProfile(*google) {
		t.Fatal("provider without a Station Gemini adapter must not enter the effective projection")
	}
}

func TestProviderProjectionDoesNotInferRuntimeCapabilityFromCatalog(t *testing.T) {
	info := providerToProto(&persistence.AgentProvider{
		Name:        "trae-cli",
		DisplayName: "Retained disabled registration",
		Enabled:     false,
	})

	if info.Protocol != "" || info.RuntimeKind != "" || info.CliCommand != "" || info.ModelsCommand != "" {
		t.Fatalf("catalog metadata must not infer an advertised runtime capability: %+v", info)
	}
}

func TestModelProjectionReturnsPersistedCapabilityAuthority(t *testing.T) {
	info, err := modelToProto(&persistence.AgentModel{
		ModelID:          "custom-model",
		ContextWindow:    128000,
		CapabilitiesJSON: json.RawMessage(`{"streaming":true,"native-tools":false}`),
	})
	if err != nil {
		t.Fatalf("project model: %v", err)
	}
	if info.GetContextWindow() != 128000 ||
		!info.GetCapabilities().GetFlags()["streaming"] ||
		info.GetCapabilities().GetFlags()["native-tools"] {
		t.Fatalf("model projection dropped capability authority: %+v", info)
	}
}

func TestCatalogModelProjectionReturnsDeclaredCapabilities(t *testing.T) {
	info, err := catalogModelToProto(&catalog.CatalogModel{
		ID:            "catalog-model",
		Type:          "chat",
		ContextWindow: 64000,
		Capabilities:  []string{"streaming", "native-tools"},
	})
	if err != nil {
		t.Fatalf("project catalog model: %v", err)
	}
	if !info.GetCapabilities().GetFlags()["streaming"] ||
		!info.GetCapabilities().GetFlags()["native-tools"] {
		t.Fatalf("catalog projection dropped declared capabilities: %+v", info)
	}
}
