package service

import (
	"strings"
	"testing"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

func TestValidateProviderRuntimeConfigAcceptsRegisteredDefaultWithoutCatalogRows(t *testing.T) {
	provider := &catalog.CatalogProvider{
		ID:             "codex-cli",
		RuntimeKind:    "cli",
		DefaultModel:   "default",
		DefaultTimeout: 120,
		Configurable:   []string{"default-model", "startup-args", "environment", "timeout"},
	}

	err := ValidateProviderRuntimeConfig(provider, &model.ProviderRuntimeConfig{
		DefaultModel:   "default",
		StartupArgs:    []string{"--verbose"},
		Environment:    map[string]string{"CODEX_PROFILE": "work"},
		TimeoutSeconds: 120,
	})
	if err != nil {
		t.Fatalf("registered adapter default should be valid: %v", err)
	}
}

func TestValidateProviderRuntimeConfigRejectsUnknownDefaultModel(t *testing.T) {
	provider := &catalog.CatalogProvider{
		ID:             "trae-cli",
		RuntimeKind:    "cli",
		DefaultModel:   "default",
		DefaultTimeout: 120,
		Configurable:   []string{"default-model", "startup-args", "environment", "timeout"},
		Models: []catalog.CatalogModel{
			{ID: "default"},
			{ID: "seed-2.1"},
		},
	}

	err := ValidateProviderRuntimeConfig(provider, &model.ProviderRuntimeConfig{
		DefaultModel:   "missing",
		TimeoutSeconds: 120,
	})
	if err == nil || !strings.Contains(err.Error(), "not in the Station model catalog") {
		t.Fatalf("unknown default model should be rejected, got %v", err)
	}
}
