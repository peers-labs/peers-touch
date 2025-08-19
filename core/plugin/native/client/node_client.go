package client

import (
	"context"

	"github.com/dirty-bro-tech/peers-touch-go/core/client"
	"github.com/dirty-bro-tech/peers-touch-go/core/registry"
)

// NodeClient extends the basic client interface with node discovery capabilities
type NodeClient interface {
	client.Client

	// GetActiveNodes returns information about active nodes in the network
	GetActiveNodes(ctx context.Context) ([]*NodeInfo, error)

	// GetNodeInfo returns information about a specific node
	GetNodeInfo(ctx context.Context, peerID string) (*NodeInfo, error)

	// ListPeers returns a list of peers from the registry
	ListPeers(ctx context.Context) ([]*registry.Peer, error)
}

// Ensure libp2pClient implements NodeClient interface
var _ NodeClient = (*libp2pClient)(nil)