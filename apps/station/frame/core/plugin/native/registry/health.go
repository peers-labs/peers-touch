package native

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/registry"
)

// HealthCheck performs connectivity checks for host and DHT.
func (r *nativeRegistry) HealthCheck(ctx context.Context) error {
	if r.host == nil {
		return errors.New("host not initialized")
	}
	if r.dht == nil {
		return errors.New("DHT not initialized")
	}
	if r.dht.RoutingTable().Size() == 0 {
		logger.Infof(ctx, "[HealthCheck] routing table is empty")
	}
	if len(r.host.Network().Peers()) == 0 {
		logger.Warnf(ctx, "[HealthCheck] no connected peers")
	}
	if err := r.dht.Bootstrap(ctx); err != nil {
		return fmt.Errorf("[HealthCheck] DHT bootstrap failed: %w", err)
	}
	testKey := fmt.Sprintf("/%s/healthcheck_%s", registry.DefaultPeersNetworkNamespace, r.host.ID().String())
	testData := []byte("healthcheck")
	if err := r.dht.PutValue(ctx, testKey, testData); err != nil {
		return fmt.Errorf("[HealthCheck] DHT put test failed: %w", err)
	}
	if _, err := r.dht.GetValue(ctx, testKey); err != nil {
		return fmt.Errorf("[HealthCheck] DHT get test failed: %w", err)
	}
	logger.Infof(ctx, "[HealthCheck] registry health check passed")
	return nil
}

// GetDiscoveryStats returns discovery-related metrics.
func (r *nativeRegistry) GetDiscoveryStats() DiscoveryStats {
	stats := DiscoveryStats{Timestamp: time.Now()}
	if r.host != nil {
		stats.ConnectedPeers = len(r.host.Network().Peers())
		stats.HostID = r.host.ID().String()
	}
	if r.dht != nil {
		stats.RoutingTableSize = r.dht.RoutingTable().Size()
	}
	if r.mdnsService != nil {
		mdnsStats := r.getMDNSStats()
		stats.MDNSDiscovered = mdnsStats.TotalDiscovered
		stats.MDNSBootstrapDiscovered = mdnsStats.BootstrapDiscovered
		stats.MDNSConnectedBootstrap = mdnsStats.ConnectedBootstrap
		stats.MDNSLastDiscovery = mdnsStats.LastDiscoveryTime
	}
	if r.turn != nil {
		stats.TURNRelayAddresses = len(r.turnRelayAddresses)
		stats.TURNStunAddresses = len(r.turnStunAddresses)
	}
	return stats
}

// DiscoveryStats captures discovery system metrics.
type DiscoveryStats struct {
	Timestamp               time.Time
	HostID                  string
	ConnectedPeers          int
	RoutingTableSize        int
	MDNSDiscovered          int
	MDNSBootstrapDiscovered int
	MDNSConnectedBootstrap  int
	MDNSLastDiscovery       time.Time
	TURNRelayAddresses      int
	TURNStunAddresses       int
}

// ServiceDiscoveryManager orchestrates health checks and discovery monitors.
type ServiceDiscoveryManager struct {
	registry *nativeRegistry
	ctx      context.Context
	cancel   context.CancelFunc
}

// NewServiceDiscoveryManager creates a discovery manager.
func NewServiceDiscoveryManager(ctx context.Context, registry *nativeRegistry) *ServiceDiscoveryManager {
	ctx, cancel := context.WithCancel(ctx)
	return &ServiceDiscoveryManager{registry: registry, ctx: ctx, cancel: cancel}
}

// Start begins periodic checks and monitoring.
func (sdm *ServiceDiscoveryManager) Start() error {
	if sdm.registry == nil {
		return errors.New("registry not initialized")
	}
	hc := sdm.periodicHealthCheck
	go hc()

	msd := sdm.monitorServiceDiscovery
	go msd()
	logger.Infof(sdm.ctx, "Service discovery manager started")
	return nil
}

// Stop cancels background routines.
func (sdm *ServiceDiscoveryManager) Stop() error {
	sdm.cancel()
	logger.Infof(sdm.ctx, "Service discovery manager stopped")
	return nil
}

func (sdm *ServiceDiscoveryManager) periodicHealthCheck() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-sdm.ctx.Done():
			return
		case <-ticker.C:
			if err := sdm.registry.HealthCheck(sdm.ctx); err != nil {
				logger.Errorf(sdm.ctx, "[ServiceDiscoveryManager] health check failed: %v", err)
			} else {
				logger.Debugf(sdm.ctx, "[ServiceDiscoveryManager] health check passed")
			}
		}
	}
}

func (sdm *ServiceDiscoveryManager) monitorServiceDiscovery() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-sdm.ctx.Done():
			return
		case <-ticker.C:
			stats := sdm.registry.GetDiscoveryStats()
			logger.Infof(sdm.ctx, "[ServiceDiscoveryManager] Discovery Stats: %+v", stats)
		}
	}
}

// GetServiceHealth summarizes discovery health state.
func (sdm *ServiceDiscoveryManager) GetServiceHealth() (bool, string) {
	if sdm.registry == nil {
		return false, "registry not initialized"
	}
	if sdm.registry.host == nil {
		return false, "host not initialized"
	}
	if sdm.registry.dht == nil {
		return false, "DHT not initialized"
	}
	connectedPeers := len(sdm.registry.host.Network().Peers())
	routingTableSize := sdm.registry.dht.RoutingTable().Size()
	if connectedPeers == 0 && routingTableSize == 0 {
		return false, "no peers connected and routing table empty"
	}
	if connectedPeers == 0 {
		return false, "no peers connected"
	}
	if routingTableSize == 0 {
		return false, "routing table empty"
	}
	return true, fmt.Sprintf("healthy - %d connected peers, %d routing table entries", connectedPeers, routingTableSize)
}
