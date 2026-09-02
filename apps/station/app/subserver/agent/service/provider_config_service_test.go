package service

import "testing"

func TestProviderRecordSupportedByFrozenProfileRejectsOptionalCLIRegistration(t *testing.T) {
	provider := newProviderRecord(ProviderCreateRequest{
		ProviderID: "trae-cli",
	})

	if providerRecordSupportedByFrozenProfile(provider) {
		t.Fatal("catalog or registry metadata must not promote trae-cli into the frozen profile")
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

func TestProviderRecordSupportedByFrozenProfileRejectsProtocolInference(t *testing.T) {
	provider := newProviderRecord(ProviderCreateRequest{
		ProviderID: "custom-cli",
		Protocol:   "cli",
	})

	if providerRecordSupportedByFrozenProfile(provider) {
		t.Fatal("CLI protocol must not masquerade as an HTTP Direct Model provider")
	}
}
