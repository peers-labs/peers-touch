package service

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	providercli "github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli/environment"
)

type ProviderModelDiscoveryService struct {
	runtimeCatalog *RuntimeModelCatalog
	// managedBin resolves the Station managed-runtime bin directory used
	// when locating the discovery binary. Nil disables managed lookup.
	managedBin func() string
	discover   func(
		context.Context,
		providercli.ModelDiscoveryRequest,
	) ([]providercli.DiscoveredModel, error)
}

func NewProviderModelDiscoveryService(
	runtimeCatalog *RuntimeModelCatalog,
) *ProviderModelDiscoveryService {
	return &ProviderModelDiscoveryService{
		runtimeCatalog: runtimeCatalog,
		discover:       providercli.DiscoverModels,
	}
}

// SetManagedBin wires the Station managed CLI runtime into discovery.
func (s *ProviderModelDiscoveryService) SetManagedBin(resolve func() string) {
	s.managedBin = resolve
}

func (s *ProviderModelDiscoveryService) Discover(
	ctx context.Context,
	actorPTID string,
	provider *catalog.CatalogProvider,
	record *persistence.AgentProvider,
) ([]catalog.CatalogModel, time.Time, error) {
	if s == nil || s.runtimeCatalog == nil {
		return nil, time.Time{}, fmt.Errorf("model discovery service is unavailable")
	}
	if provider == nil || len(provider.ModelCatalogArgv) == 0 {
		return nil, time.Time{}, fmt.Errorf("provider does not support model discovery")
	}
	if record == nil || providerOwner(record).Validate() != nil {
		return nil, time.Time{}, fmt.Errorf("model discovery requires a configured provider owner")
	}
	config := EffectiveProviderRuntimeConfig(provider, record)
	stateRoot := environment.ToolRoot(filepath.Join(providercli.WorkspaceBaseDir(), "station-control"), provider.ID)
	if actorPTID != "" {
		var err error
		stateRoot, err = providercli.NewWorkspaceManager("").StateRoot(actorPTID, provider.ID)
		if err != nil {
			return nil, time.Time{}, err
		}
	}
	apiKey, err := providerCredentialAPIKey(record)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("model discovery credential is unavailable")
	}
	timeout := time.Duration(config.GetTimeoutSeconds()) * time.Second
	var pathEntries []string
	if s.managedBin != nil {
		if binDir := strings.TrimSpace(s.managedBin()); binDir != "" {
			pathEntries = append(pathEntries, binDir)
		}
	}
	discovered, err := s.discover(ctx, providercli.ModelDiscoveryRequest{
		Command:             provider.ModelCatalogArgv,
		Environment:         config.GetEnvironment(),
		Credentials:         cliCredentialEnvironment(provider, apiKey),
		StateRoot:           stateRoot,
		Timeout:             timeout,
		RuntimeCapabilities: provider.Capabilities,
		PathEntries:         pathEntries,
	})
	if err != nil {
		return nil, time.Time{}, err
	}

	models := make([]catalog.CatalogModel, 0, len(discovered))
	for _, item := range discovered {
		models = append(models, catalog.CatalogModel{
			ID:                       item.ID,
			DisplayName:              item.DisplayName,
			Description:              item.Description,
			Type:                     item.Type,
			Enabled:                  true,
			ContextWindow:            item.ContextWindow,
			Capabilities:             item.Capabilities,
			DefaultReasoningLevel:    item.DefaultReasoningLevel,
			SupportedReasoningLevels: item.SupportedReasoningLevels,
		})
	}
	observedAt := time.Now().UTC()
	s.runtimeCatalog.Replace(record, models, observedAt)
	return models, observedAt, nil
}
