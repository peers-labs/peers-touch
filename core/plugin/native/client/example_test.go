package client

import (
	"context"
	"testing"
	"time"

	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
	"github.com/libp2p/go-libp2p-kad-dht"
)

// TestNodeClientInterface demonstrates the NodeClient interface implementation
func TestNodeClientInterface(t *testing.T) {
	// Test that libp2pClient implements NodeClient interface
	c := &libp2pClient{}
	var _ NodeClient = c
	t.Log("libp2pClient successfully implements NodeClient interface")

	// Test NodeInfo and ConnectionInfo struct creation
	nodeInfo := &NodeInfo{
		PeerID:    "test-peer-id",
		Addresses: []string{"/ip4/127.0.0.1/tcp/4001"},
		IsActive:  true,
		Connection: &ConnectionInfo{
			Direction:  "outbound",
			Opened:     time.Now(),
			NumStreams: 1,
			Latency:    time.Millisecond * 100,
		},
	}

	if nodeInfo.PeerID != "test-peer-id" {
		t.Errorf("Expected PeerID to be 'test-peer-id', got %s", nodeInfo.PeerID)
	}

	if len(nodeInfo.Addresses) != 1 {
		t.Errorf("Expected 1 address, got %d", len(nodeInfo.Addresses))
	}

	t.Log("NodeInfo and ConnectionInfo structs work correctly")
}

// ExampleNodeClientWithDHTAndRegistry demonstrates how to create a NodeClient with DHT and Registry
func ExampleNodeClientWithDHTAndRegistry() {
	// This is a conceptual example - in practice, you would have actual DHT and Registry instances
	var dht *dht.IpfsDHT      // This would be initialized with actual DHT
	var reg registry.Registry // This would be initialized with actual Registry

	// Create NodeClient with DHT and Registry
	client := NewNodeClient(
		WithDHT(dht),
		WithRegistry(reg),
	)

	// Initialize the client
	err := client.Init()
	if err != nil {
		// Handle error
		return
	}

	// Now you can use the client to get active nodes and peer information
	ctx := context.Background()
	nodes, _ := client.GetActiveNodes(ctx)
	peers, _ := client.ListPeers(ctx)

	// Use the nodes and peers data
	_ = nodes
	_ = peers
}
