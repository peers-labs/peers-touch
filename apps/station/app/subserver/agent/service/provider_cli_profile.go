package service

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
)

// providerCatalog separates a resource's identity from its installed adapter.
// Legacy CLI identities are backfilled at startup, never guessed at dispatch.
func providerCatalog(record *persistence.AgentProvider) *catalog.CatalogProvider {
	if record == nil {
		return nil
	}
	id := record.Name
	if record.RuntimeKind == providerRuntimeCLI {
		id = record.CLIAdapterID
	}
	cp := catalog.Find(id)
	if cp == nil {
		return nil
	}
	result := *cp
	result.ID = record.Name
	if record.DisplayName != "" {
		result.Name = record.DisplayName
	}
	return &result
}

func invalidCLIProfile(message string) error {
	return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, message, nil)
}

// CLIBackend reads an immutable resource ID under the profile's owner. A
// recreated same-named connection is not a replacement for the deleted source.
func (s *ProviderConfigService) CLIBackend(ctx context.Context, profile *persistence.AgentProvider) (*persistence.AgentProvider, error) {
	if profile == nil || profile.BackendProviderID == "" {
		return nil, nil
	}
	adapter := catalog.Find(profile.CLIAdapterID)
	if profile.RuntimeKind != providerRuntimeCLI || adapter == nil || len(adapter.BackendProtocols) != 1 {
		return nil, invalidCLIProfile("this CLI adapter does not support a model connection")
	}
	db, err := s.getDB(ctx)
	if err != nil {
		return nil, err
	}
	var backend persistence.AgentProvider
	if err := providerOwner(profile).Query(db.WithContext(ctx)).
		Where("id = ?", profile.BackendProviderID).First(&backend).Error; err != nil {
		return nil, errcode.New(errcode.AgentProviderDisabled, http.StatusForbidden, "CLI model connection is unavailable", nil)
	}
	if backend.RuntimeKind != "http" || backend.BackendProviderID != "" {
		return nil, invalidCLIProfile("CLI profiles require a direct HTTP model connection")
	}
	switch adapter.BackendProtocols[0] {
	case "responses":
		// The administrator explicitly selects Responses for this CLI. An
		// OpenAI-format connection alone does not prove upstream support.
		if backend.Protocol != "openai" && backend.Protocol != "openai-compatible" {
			return nil, invalidCLIProfile("Codex requires an OpenAI Responses endpoint")
		}
	case "anthropic":
		if backend.Protocol != "anthropic" {
			return nil, invalidCLIProfile("Claude requires an Anthropic Messages endpoint")
		}
	default:
		return nil, invalidCLIProfile("unsupported CLI backend protocol")
	}
	return &backend, nil
}

// effectiveProviderCatalog is shared by management and admission. Referenced
// model definitions stay at their source; CLI capability projection prevents
// an HTTP tool/image flag from promising unsupported CLI behavior.
func (s *ProviderConfigService) effectiveProviderCatalog(ctx context.Context, record *persistence.AgentProvider, runtime *RuntimeModelCatalog) (*catalog.CatalogProvider, error) {
	cp := providerCatalog(record)
	if cp != nil && runtime != nil {
		effective := runtime.EffectiveProvider(record, *cp)
		cp = &effective
	}
	if record == nil || record.BackendProviderID == "" {
		return cp, nil
	}
	backend, err := s.CLIBackend(ctx, record)
	if err != nil {
		return nil, err
	}
	if cp == nil {
		return nil, invalidCLIProfile("CLI adapter is unavailable")
	}
	source := providerCatalog(backend)
	if source == nil {
		source = &catalog.CatalogProvider{ID: backend.Name}
	}
	stored, err := NewModelConfigService().ListOwned(ctx, providerOwner(backend), backend.Name)
	if err != nil {
		return nil, err
	}
	models, err := ResolveEffectiveProviderModels(source, stored, parseHiddenModels(backend.HiddenModels))
	if err != nil {
		return nil, err
	}
	cp.Models = nil
	cp.DefaultModel = ""
	for _, item := range models {
		cp.Models = append(cp.Models, catalog.CatalogModel{
			ID: item.ID, DisplayName: item.DisplayName, Type: item.Type,
			Enabled: item.Enabled && backend.Enabled, ContextWindow: item.ContextWindow,
			Capabilities: append([]string{"text-input", "text-output"}, cp.Capabilities...),
		})
	}
	return cp, nil
}

func (s *ProviderConfigService) validateCLIProfile(ctx context.Context, record *persistence.AgentProvider) error {
	if record.RuntimeKind != providerRuntimeCLI {
		if record.CLIAdapterID != "" || record.BackendProviderID != "" {
			return invalidCLIProfile("only CLI profiles can bind an adapter or model connection")
		}
		return nil
	}
	cp, err := s.effectiveProviderCatalog(ctx, record, nil)
	if err != nil {
		return err
	}
	if cp == nil || cp.RuntimeKind != providerRuntimeCLI {
		return invalidCLIProfile("registered CLI adapter is required")
	}
	if record.BackendProviderID != "" && (record.BaseURL != "" || record.KeyVaults != "") {
		return invalidCLIProfile("a referenced connection cannot be combined with profile credentials or URL")
	}
	if len(record.Config) == 0 && record.BackendProviderID == "" {
		return nil
	}
	config, err := readProviderRuntimeConfig(cp, record)
	if err != nil {
		return err
	}
	if record.BackendProviderID != "" && strings.TrimSpace(config.DefaultModel) == "" {
		return invalidCLIProfile("select a model from the referenced connection")
	}
	return ValidateProviderRuntimeConfig(cp, config)
}

func readProviderRuntimeConfig(cp *catalog.CatalogProvider, record *persistence.AgentProvider) (*model.ProviderRuntimeConfig, error) {
	if len(record.Config) > 0 {
		var configured model.ProviderRuntimeConfig
		if err := json.Unmarshal(record.Config, &configured); err != nil {
			return nil, errcode.New(errcode.AgentInvalidSourceState, http.StatusConflict, "CLI runtime configuration is invalid", nil)
		}
	}
	return EffectiveProviderRuntimeConfig(cp, record), nil
}
