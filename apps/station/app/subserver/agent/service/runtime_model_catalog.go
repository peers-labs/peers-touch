package service

import (
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/catalog"
)

type RuntimeModelCatalog struct {
	mu        sync.RWMutex
	snapshots map[runtimeModelCatalogKey]runtimeModelSnapshot
}

type runtimeModelCatalogKey struct {
	actorPTID  string
	providerID string
}

type runtimeModelSnapshot struct {
	models     []catalog.CatalogModel
	observedAt time.Time
}

func NewRuntimeModelCatalog() *RuntimeModelCatalog {
	return &RuntimeModelCatalog{
		snapshots: make(map[runtimeModelCatalogKey]runtimeModelSnapshot),
	}
}

func (c *RuntimeModelCatalog) Replace(
	actorPTID string,
	providerID string,
	models []catalog.CatalogModel,
	observedAt time.Time,
) {
	if c == nil {
		return
	}
	key := runtimeModelCatalogKey{
		actorPTID:  actorPTID,
		providerID: providerID,
	}
	c.mu.Lock()
	c.snapshots[key] = runtimeModelSnapshot{
		models:     cloneCatalogModels(models),
		observedAt: observedAt.UTC(),
	}
	c.mu.Unlock()
}

func (c *RuntimeModelCatalog) Models(
	actorPTID string,
	providerID string,
) ([]catalog.CatalogModel, time.Time, bool) {
	if c == nil {
		return nil, time.Time{}, false
	}
	key := runtimeModelCatalogKey{
		actorPTID:  actorPTID,
		providerID: providerID,
	}
	c.mu.RLock()
	snapshot, ok := c.snapshots[key]
	c.mu.RUnlock()
	if !ok {
		return nil, time.Time{}, false
	}
	return cloneCatalogModels(snapshot.models),
		snapshot.observedAt,
		true
}

func (c *RuntimeModelCatalog) EffectiveProvider(
	actorPTID string,
	provider catalog.CatalogProvider,
) catalog.CatalogProvider {
	models, _, ok := c.Models(actorPTID, provider.ID)
	if !ok {
		return provider
	}
	provider.Models = models
	return provider
}

func cloneCatalogModels(models []catalog.CatalogModel) []catalog.CatalogModel {
	cloned := make([]catalog.CatalogModel, len(models))
	for i := range models {
		cloned[i] = models[i]
		cloned[i].Capabilities = append([]string(nil), models[i].Capabilities...)
		cloned[i].SupportedReasoningLevels = append(
			[]string(nil),
			models[i].SupportedReasoningLevels...,
		)
	}
	return cloned
}
