package handler

import (
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
