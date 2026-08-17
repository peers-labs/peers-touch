package handler

import (
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
)

func TestCatalogProviderReadyForAgentRequiresConfiguredCredential(t *testing.T) {
	showAPIKey := true
	provider := catalog.CatalogProvider{
		ID:         "test-http-provider",
		ShowAPIKey: &showAPIKey,
	}

	if catalogProviderReadyForAgent(provider, nil) {
		t.Fatal("provider without an actor record must not be ready")
	}
	if catalogProviderReadyForAgent(provider, &persistence.AgentProvider{
		Name:      provider.ID,
		KeyVaults: `{}`,
	}) {
		t.Fatal("provider without an API key must not be ready")
	}
	if !catalogProviderReadyForAgent(provider, &persistence.AgentProvider{
		Name:      provider.ID,
		KeyVaults: `{"api_key":"configured"}`,
	}) {
		t.Fatal("configured provider should be ready")
	}
}

func TestCatalogProviderReadyForAgentAllowsAPIKeylessProvider(t *testing.T) {
	showAPIKey := false
	provider := catalog.CatalogProvider{
		ID:         "test-keyless-provider",
		ShowAPIKey: &showAPIKey,
	}

	if !catalogProviderReadyForAgent(provider, nil) {
		t.Fatal("API-keyless provider should not require a credential record")
	}
}

func TestCatalogProviderReadyForAgentChecksCLIBinary(t *testing.T) {
	provider := catalog.CatalogProvider{
		ID:          "test-cli-provider",
		RuntimeKind: "cli",
		CliCommand:  "definitely-not-installed-peers-cli",
	}

	if catalogProviderReadyForAgent(provider, &persistence.AgentProvider{Name: provider.ID}) {
		t.Fatal("CLI provider with a missing binary must not be ready")
	}

	provider.CliCommand = "sh"
	if !catalogProviderReadyForAgent(provider, &persistence.AgentProvider{Name: provider.ID}) {
		t.Fatal("CLI provider with an installed binary should be ready")
	}
}

func TestCatalogModelAvailableForAgentOnlyReturnsEnabledChatModels(t *testing.T) {
	chatModel := catalog.CatalogModel{ID: "chat", Type: "chat", Enabled: true}
	if !catalogModelAvailableForAgent(chatModel, nil) {
		t.Fatal("enabled chat model should be available")
	}
	if catalogModelAvailableForAgent(
		catalog.CatalogModel{ID: "embedding", Type: "embedding", Enabled: true},
		nil,
	) {
		t.Fatal("embedding model must not be exposed as an Agent chat model")
	}
	if catalogModelAvailableForAgent(
		catalog.CatalogModel{ID: "disabled", Type: "chat", Enabled: false},
		nil,
	) {
		t.Fatal("disabled chat model must not be available")
	}
	if catalogModelAvailableForAgent(chatModel, []string{"chat"}) {
		t.Fatal("hidden chat model must not be available")
	}
}
