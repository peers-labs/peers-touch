# Native Client Plugin

This package provides a libp2p-based client implementation for the peers-touch-go framework with extended node discovery capabilities.

## Features

- **Basic Client Interface**: Implements the standard `client.Client` interface with `Call`, `Stream`, and `Publish` methods
- **Extended Node Discovery**: Provides `NodeClient` interface with additional methods for retrieving active node information
- **libp2p Integration**: Built on top of libp2p for peer-to-peer networking
- **DHT Support**: Integrates with libp2p Kademlia DHT for peer discovery
- **Registry Integration**: Works with the peers-touch-go registry system

## Usage

### Basic Client

```go
import "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/client"

// Create a basic client
client := client.NewClient()
err := client.Init()
if err != nil {
    // handle error
}
```

### NodeClient with Extended Features

```go
import (
    "context"
    "github.com/dirty-bro-tech/peers-touch-go/core/plugin/native/client"
)

// Create a NodeClient with DHT and Registry
client := client.NewNodeClient(
    client.WithDHT(dhtInstance),
    client.WithRegistry(registryInstance),
)

err := client.Init()
if err != nil {
    // handle error
}

// Get active nodes in the network
ctx := context.Background()
nodes, err := client.GetActiveNodes(ctx)
if err != nil {
    // handle error
}

// Get information about a specific node
nodeInfo, err := client.GetNodeInfo(ctx, "peer-id")
if err != nil {
    // handle error
}

// List peers from registry
peers, err := client.ListPeers(ctx)
if err != nil {
    // handle error
}
```

## NodeClient Interface

The `NodeClient` interface extends the basic `client.Client` with the following methods:

- `GetActiveNodes(ctx context.Context) ([]*NodeInfo, error)`: Returns information about active nodes in the network
- `GetNodeInfo(ctx context.Context, peerID string) (*NodeInfo, error)`: Returns information about a specific node
- `ListPeers(ctx context.Context) ([]*registry.Peer, error)`: Returns a list of peers from the registry

## Data Structures

### NodeInfo

```go
type NodeInfo struct {
    PeerID     string          `json:"peer_id"`
    Addresses  []string        `json:"addresses"`
    Connection *ConnectionInfo `json:"connection,omitempty"`
    IsActive   bool            `json:"is_active"`
}
```

### ConnectionInfo

```go
type ConnectionInfo struct {
    Direction  string        `json:"direction"`
    Opened     time.Time     `json:"opened"`
    NumStreams int           `json:"num_streams"`
    Latency    time.Duration `json:"latency"`
}
```

## Configuration Options

- `WithDHT(dht *dht.IpfsDHT)`: Sets the DHT instance for peer discovery
- `WithRegistry(reg registry.Registry)`: Sets the registry instance for peer management

## Plugin Registration

The native client plugin is automatically registered and can be used through the plugin system:

```go
// Get the plugin
plugin := &nativeClientPlugin{}

// Create a basic client
client := plugin.New()

// Create a NodeClient with extended features
nodeClient := plugin.NewNodeClient(
    client.WithDHT(dhtInstance),
    client.WithRegistry(registryInstance),
)
```