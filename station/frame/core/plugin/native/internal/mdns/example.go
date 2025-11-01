package mdns

import (
	"context"
	"time"

	"github.com/peers-touch/peers-touch/station/frame/core/logger"
	"github.com/peers-touch/peers-touch/station/frame/core/types"
)

// Example demonstrates basic mDNS usage with hashicorp/mdns integration
func Example() {
	ctx := context.Background()

	// Extract logger from context
	log := logger.Extract(ctx)

	// Create mDNS service with custom namespace
	service, err := NewMDNSService(ctx,
		WithNamespace("my-bootstrap-service"),
		WithService("_bootstrap._tcp"),
		WithDomain("local."),
	)
	if err != nil {
		log.Errorf("Failed to create service: %v", err)
		return
	}

	// Set up discovery callback
	service.Watch(func(peer *types.Peer) {
		log.Infof("Discovered peer: %s (ID: %s)", peer.Name, peer.ID)
		if len(peer.Nodes) > 0 {
			for _, node := range peer.Nodes {
				log.Infof("  Node: %s (type: %s, port: %d)", node.Name, node.Type, node.Port)
			}
		}
	})

	// Start the service
	if err := service.Start(); err != nil {
		log.Errorf("Failed to start service: %v", err)
		return
	}
	defer service.Stop()

	// Create and advertise a node
	node := &types.Node{
		ID:   "bootstrap-node-1",
		Type: "bootstrap",
		Name: "My Bootstrap Node",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("bootstrap12345678901234567890"),
		},
		Addresses: []string{"/ip4/192.168.1.100/tcp/4001"},
		Metadata:  make(map[string]interface{}),
	}

	if err := service.AdvertiseNode(node); err != nil {
		log.Errorf("Failed to advertise node: %v", err)
		return
	}

	log.Infof("mDNS service started successfully")

	// In a real application, you would keep the service running
	// time.Sleep(30 * time.Second)

	log.Infof("mDNS service stopped")
}

// ExampleBootstrapService demonstrates creating a bootstrap service
func ExampleBootstrapService() {
	ctx := context.Background()

	// Extract logger from context
	log := logger.Extract(ctx)

	// Create bootstrap mDNS service
	service, err := NewMDNSService(ctx,
		WithNamespace("bootstrap-service"),
		WithService("_bootstrap._tcp"),
		WithDomain("local."),
	)
	if err != nil {
		log.Fatal(err)
	}

	// Set up discovery callback
	service.Watch(func(peer *types.Peer) {
		// Check if this peer has bootstrap nodes
		hasBootstrap := false
		for _, node := range peer.Nodes {
			if node.Type == "bootstrap" {
				hasBootstrap = true
				break
			}
		}
		if hasBootstrap {
			log.Infof("Discovered bootstrap peer: %s", peer.Name)
		}
	})

	// Start the service
	if err := service.Start(); err != nil {
		log.Fatal(err)
	}
	defer service.Stop()

	// Create bootstrap node
	node := &types.Node{
		ID:   "bootstrap-primary",
		Type: "bootstrap",
		Name: "Primary Bootstrap Node",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("bootstrap-primary-hash"),
		},
		Addresses: []string{"/ip4/0.0.0.0/tcp/4001"},
		Metadata:  make(map[string]interface{}),
	}

	// Advertise the node
	if err := service.AdvertiseNode(node); err != nil {
		log.Fatal(err)
	}

	log.Infof("Bootstrap service is running and advertising")
}

// ExampleRegistryService demonstrates creating a registry service
func ExampleRegistryService() {
	ctx := context.Background()

	// Extract logger from context
	log := logger.Extract(ctx)

	// Create registry mDNS service
	service, err := NewMDNSService(ctx,
		WithNamespace("registry-service"),
		WithService("_registry._tcp"),
		WithDomain("local."),
	)
	if err != nil {
		log.Fatal(err)
	}

	// Set up discovery callback
	service.Watch(func(peer *types.Peer) {
		// Check if this peer has registry nodes
		hasRegistry := false
		for _, node := range peer.Nodes {
			if node.Type == "registry" {
				hasRegistry = true
				break
			}
		}
		if hasRegistry {
			log.Infof("Discovered registry peer: %s", peer.Name)
		}
	})

	// Start the service
	if err := service.Start(); err != nil {
		log.Fatal(err)
	}
	defer service.Stop()

	// Create registry node
	node := &types.Node{
		ID:   "registry-primary",
		Type: "registry",
		Name: "Primary Registry Node",
		Port: 8080,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("registry-primary-hash"),
		},
		Addresses: []string{"/ip4/0.0.0.0/tcp/8080"},
		Metadata:  make(map[string]interface{}),
	}

	// Advertise the node
	if err := service.AdvertiseNode(node); err != nil {
		log.Fatal(err)
	}

	log.Infof("Registry service is running and advertising")
}

// ExampleRealWorldScenario demonstrates a real-world usage scenario
func ExampleRealWorldScenario() {
	ctx := context.Background()

	// Extract logger from context
	log := logger.Extract(ctx)

	log.Infof("🚀 Real mDNS Demo - hashicorp/mdns Integration")

	// Create bootstrap service
	log.Infof("📡 Creating Bootstrap Service...")
	bootstrapService, err := NewMDNSService(ctx,
		WithNamespace("demo-bootstrap"),
		WithService("_bootstrap._tcp"),
		WithDomain("local."),
		WithDiscoveryInterval(5*time.Second),
	)
	if err != nil {
		log.Fatalf("Failed to create bootstrap service: %v", err)
	}

	// Set up discovery for bootstrap service
	bootstrapService.Watch(func(peer *types.Peer) {
		log.Infof("🔍 Bootstrap service discovered: %s (ID: %s)", peer.Name, peer.ID)
		if len(peer.Nodes) > 0 {
			for _, node := range peer.Nodes {
				log.Infof("  📍 Node: %s (type: %s, port: %d)", node.Name, node.Type, node.Port)
			}
		}
	})

	// Start the service
	if err := bootstrapService.Start(); err != nil {
		log.Fatalf("Failed to start bootstrap service: %v", err)
	}
	defer bootstrapService.Stop()

	log.Infof("✅ Bootstrap service started")

	// Create and advertise a bootstrap node
	log.Infof("📢 Advertising Bootstrap Node...")
	bootstrapNode := &types.Node{
		ID:   "demo-bootstrap-1",
		Type: "bootstrap",
		Name: "Demo Bootstrap Node",
		Port: 4001,
		NetworkID: &types.NetworkID{
			Version: types.Version1,
			Type:    types.TypeNode,
			Hash:    []byte("demo-bootstrap-hash123456789012"),
		},
		Addresses: []string{"/ip4/192.168.1.100/tcp/4001", "/ip6/::1/tcp/4001"},
		Metadata:  make(map[string]interface{}),
	}

	if err := bootstrapService.AdvertiseNode(bootstrapNode); err != nil {
		log.Fatalf("Failed to advertise bootstrap node: %v", err)
	}

	log.Infof("✅ Bootstrap node advertised: %s", bootstrapNode.Name)

	// Simulate running for a while
	log.Infof("⏳ Running for 10 seconds to demonstrate discovery...")
	time.Sleep(10 * time.Second)

	log.Infof("\n🎉 Demo completed successfully!")
	log.Infof("\nKey Features Demonstrated:")
	log.Infof("  ✅ Real mDNS service advertisement using hashicorp/mdns")
	log.Infof("  ✅ Peer discovery with callback notifications")
	log.Infof("  ✅ TXT record encoding/decoding of node information")
	log.Infof("  ✅ Support for both IPv4 and IPv6 addresses")
	log.Infof("  ✅ Automatic TXT record size limiting")
}
