// Package application — NodesService aggregates persisted peers and live
// registry registrations for the dashboard "Nodes" page.
//
// Created: 2026-04-21 — replaces the placeholder Nodes page.
package application

import (
	"context"
	"fmt"

	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/dashboard/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
)

// NodesService produces the Nodes-page payload.
type NodesService struct {
	nodesRepo infrastructure.NodesRepository
	registry  registry.Registry
}

// NewNodesService constructs a NodesService. The registry may be nil at
// construction; SetRegistry can be used to set it once available.
func NewNodesService(nodesRepo infrastructure.NodesRepository, reg registry.Registry) *NodesService {
	return &NodesService{nodesRepo: nodesRepo, registry: reg}
}

// SetRegistry installs the registry after construction (mirrors OverviewService).
func (s *NodesService) SetRegistry(reg registry.Registry) {
	s.registry = reg
}

// GetNodesOverview returns the persisted peers and live registry
// registrations side by side.
func (s *NodesService) GetNodesOverview(ctx context.Context) (*domain.NodesOverview, error) {
	out := &domain.NodesOverview{}

	persisted, err := s.nodesRepo.ListPersistedPeers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list persisted peers: %w", err)
	}
	out.Persisted = persisted

	if s.registry != nil {
		regs, err := s.registry.Query(ctx)
		if err == nil {
			out.Registrations = projectRegistrations(regs)
		}
	}
	if out.Registrations == nil {
		out.Registrations = []domain.RegistryRegistration{}
	}

	return out, nil
}

// projectRegistrations turns Registry's internal Registration list into
// JSON-safe DTOs. Metadata values are best-effort stringified to keep the
// JSON contract stable across registry implementations.
func projectRegistrations(regs []*registry.Registration) []domain.RegistryRegistration {
	out := make([]domain.RegistryRegistration, 0, len(regs))
	for _, r := range regs {
		if r == nil {
			continue
		}
		var meta map[string]string
		if len(r.Metadata) > 0 {
			meta = make(map[string]string, len(r.Metadata))
			for k, v := range r.Metadata {
				meta[k] = fmt.Sprint(v)
			}
		}
		out = append(out, domain.RegistryRegistration{
			ID:         r.ID,
			Name:       r.Name,
			Type:       string(r.Type),
			Namespaces: r.Namespaces,
			Addresses:  r.Addresses,
			TTLSeconds: int64(r.TTL.Seconds()),
			Metadata:   meta,
		})
	}
	return out
}
