package service

import (
	"context"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	providercli "github.com/peers-labs/peers-touch/station/app/subserver/agent/service/cli"
)

type ProviderModelDiscoveryService struct {
	runtimeCatalog *RuntimeModelCatalog
	discover       func(
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
	config := EffectiveProviderRuntimeConfig(provider, record)
	timeout := time.Duration(config.GetTimeoutSeconds()) * time.Second
	discovered, err := s.discover(ctx, providercli.ModelDiscoveryRequest{
		Command:             provider.ModelCatalogArgv,
		Environment:         config.GetEnvironment(),
		Timeout:             timeout,
		RuntimeCapabilities: provider.Capabilities,
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
	s.runtimeCatalog.Replace(actorPTID, provider.ID, models, observedAt)
	return models, observedAt, nil
}
