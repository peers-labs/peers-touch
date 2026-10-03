package service

import "testing"

func TestProviderRecordSupportedByFrozenProfileAllowsCatalogCLIRegistration(t *testing.T) {
	provider := newProviderRecord(ProviderCreateRequest{
		ProviderID: "trae-cli",
	})

	if !providerRecordSupportedByFrozenProfile(provider) {
		t.Fatal("catalog CLI provider must be available to the Station Direct Model runtime")
	}
	if provider.RuntimeKind != "cli" ||
		provider.Protocol != "cli" ||
		provider.CliCommand == "" ||
		provider.ModelsCommand == "" {
		t.Fatalf("catalog CLI execution metadata was not persisted: %+v", provider)
	}
}

func TestProviderRecordSupportedByFrozenProfileRetainsDirectModelQuickCompletion(t *testing.T) {
	provider := newProviderRecord(ProviderCreateRequest{
		ProviderID:  "translation-provider",
		DisplayName: "Translation Provider",
		BaseURL:     "https://provider.invalid/v1",
		Protocol:    "openai-compatible",
	})

	if !providerRecordSupportedByFrozenProfile(provider) {
		t.Fatal("Direct Model provider must remain available to Station quick completion")
	}
	if provider.RuntimeKind != "http" || provider.BaseURL != "https://provider.invalid/v1" {
		t.Fatalf("unexpected Direct Model provider record: %+v", provider)
	}
}

func TestProviderRecordSupportedByFrozenProfileRejectsCLIProtocolWithoutCLIRuntime(t *testing.T) {
	provider := newProviderRecord(ProviderCreateRequest{
		ProviderID: "custom-cli",
		Protocol:   "cli",
	})

	if providerRecordSupportedByFrozenProfile(provider) {
		t.Fatal("CLI protocol must not masquerade as an HTTP runtime")
	}
}

func TestProviderRecordSupportedByFrozenProfileRejectsUnimplementedProtocol(t *testing.T) {
	provider := newProviderRecord(ProviderCreateRequest{
		ProviderID: "custom-gemini",
		Protocol:   "gemini",
	})

	if providerRecordSupportedByFrozenProfile(provider) {
		t.Fatal("provider protocol without a Station execution adapter must not be advertised")
	}
}
