package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/channel/secret"
)

func cliCredentialEnvironment(provider *catalog.CatalogProvider, apiKey string) map[string]string {
	if provider == nil || provider.CredentialEnvKey == "" || apiKey == "" {
		return nil
	}
	return map[string]string{provider.CredentialEnvKey: apiKey}
}

type providerSecretEnvelope struct {
	SealedCredential *secret.Envelope `json:"sealed_credential"`
}

// The scope is bound as part of the resource ID. The actor slot remains empty
// for Station ownership; no invented PTID is used.
func sealProviderCredential(provider *persistence.AgentProvider, apiKey string) (string, error) {
	owner := providerOwner(provider)
	if err := owner.Validate(); err != nil {
		return "", err
	}
	envelope, err := secret.Seal(secret.NewEnvKEKProvider(), owner.ActorPTID,
		secret.PurposeAgentRuntime, owner.Scope+":"+provider.ID, []byte(apiKey))
	if err != nil {
		return "", fmt.Errorf("provider credential cannot be sealed: %w", err)
	}
	encoded, err := json.Marshal(providerSecretEnvelope{SealedCredential: &envelope})
	return string(encoded), err
}

func ProviderCredentialConfigured(provider *persistence.AgentProvider) bool {
	if provider == nil {
		return false
	}
	var stored providerSecretEnvelope
	return json.Unmarshal([]byte(provider.KeyVaults), &stored) == nil &&
		stored.SealedCredential != nil && len(stored.SealedCredential.Ciphertext) > 0
}

func providerCredentialAPIKey(provider *persistence.AgentProvider) (string, error) {
	if strings.TrimSpace(provider.KeyVaults) == "" {
		return "", nil
	}
	owner := providerOwner(provider)
	if err := owner.Validate(); err != nil {
		return "", err
	}
	var stored providerSecretEnvelope
	if err := json.Unmarshal([]byte(provider.KeyVaults), &stored); err != nil || stored.SealedCredential == nil {
		return "", fmt.Errorf("provider credential is not an encrypted envelope")
	}
	plaintext, err := secret.Open(secret.NewEnvKEKProvider(), owner.ActorPTID,
		secret.PurposeAgentRuntime, owner.Scope+":"+provider.ID, *stored.SealedCredential)
	if err != nil {
		return "", fmt.Errorf("provider credential is unavailable: %w", err)
	}
	return string(plaintext), nil
}

// Legacy decoding is confined to the at-rest migration, never dispatch.
func legacyProviderAPIKey(raw string) string {
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil {
		raw = string(decoded)
	}
	var values map[string]string
	if json.Unmarshal([]byte(raw), &values) != nil {
		return ""
	}
	for _, key := range []string{"api_key", "key", "token"} {
		if value := strings.TrimSpace(values[key]); value != "" {
			return value
		}
	}
	return ""
}
