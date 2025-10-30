# mDNS Service

A simple mDNS (Multicast DNS) service for peer discovery and advertisement in the peers-touch network.

## Features

- **Service Advertisement**: Advertise your node services via mDNS
- **Peer Discovery**: Discover other peers on the local network
- **Simple API**: Easy-to-use option-based configuration
- **Watch Callbacks**: Get notified when new peers are discovered

## Quick Start

```go
import (
    "context"
    "log"
    
    "github.com/peers-touch/peers-touch-go/core/internal/mdns"
    "github.com/peers-touch/peers-touch-go/core/types"
)

func main() {
    ctx := context.Background()
    
    // Create mDNS service
    service, err := mdns.NewMDNSService(ctx,
        mdns.WithNamespace("my-service"),
        mdns.WithService("_bootstrap._tcp"),
    )
    if err != nil {
        log.Fatal(err)
    }
    
    // Set up discovery callback
    service.Watch(func(peer *types.Peer) {
        log.Printf("Discovered peer: %s (ID: %s)", peer.Name, peer.ID)
    })
    
    // Start the service
    if err := service.Start(); err != nil {
        log.Fatal(err)
    }
    defer service.Stop()
    
    // Create and advertise a node
    node := &types.Node{
        ID:   "my-node-1",
        Type: "bootstrap",
        Name: "My Bootstrap Node",
        Port: 4001,
        NetworkID: &types.NetworkID{
            Version: types.Version1,
            Type:    types.TypeNode,
            Hash:    []byte("mynode12345678901234567890"),
        },
        Addresses: []string{"/ip4/192.168.1.100/tcp/4001"},
    }
    
    if err := service.AdvertiseNode(node); err != nil {
        log.Fatal(err)
    }
    
    // Keep running...
    select {}
}
```

## Configuration Options

### Basic Options

- `WithNamespace(name)` - Set the service namespace (required)
- `WithService(service)` - Set the mDNS service type (default: `_peers-touch._tcp`)
- `WithDomain(domain)` - Set the mDNS domain (default: `local.`)
- `WithPort(port)` - Set the mDNS port (default: 0 for random available port)
- `WithDiscoveryInterval(interval)` - Set discovery interval (default: 30s)

### Dynamic Domain Generation

The service intelligently generates domains based on namespace:

```go
// Standard namespaces use standard local domain for compatibility
service1, _ := mdns.NewMDNSService(ctx, 
    mdns.WithNamespace("peers-touch"),  // Uses "local."
)

// Custom namespaces get concise subdomains for isolation
service2, _ := mdns.NewMDNSService(ctx,
    mdns.WithNamespace("testsvc"),        // Uses "testsv.local."
)

service3, _ := mdns.NewMDNSService(ctx,
    mdns.WithNamespace("myapp123"),         // Uses "myapp1.local." (truncated)
)
```

**Benefits**:
- ✅ **Smart isolation**: Custom namespaces get subdomains, standard ones use local
- ✅ **Concise naming**: Maximum 6 characters to keep domain names short
- ✅ **DNS-safe**: Only alphanumeric characters, no special chars
- ✅ **Backward compatible**: Standard namespaces use traditional "local." domain
- ✅ **Automatic**: No manual configuration needed for most cases

### Node Information

- `WithNode(node)` - Set the node to advertise

## TXT Record Size Limits

The mDNS service automatically handles DNS TXT record size limitations:

- **Individual records**: Maximum 255 characters per TXT record string (DNS protocol limit)
- **Total size**: Recommended ~400 bytes total for all TXT records (UDP packet limit)
- **Automatic limiting**: The `addresses` field is limited to ~200 bytes to leave room for essential fields
- **Size warnings**: Logs warnings when total TXT record size approaches limits

When size limits are exceeded:
- Addresses are truncated to fit within limits
- Essential fields (node_id, node_type, etc.) are always preserved
- Less critical fields may be limited or omitted

## API Reference

### Service Creation

```go
service, err := mdns.NewMDNSService(ctx, opts ...Option) (*Service, error)
```

### Service Management

```go
// Start the service
err := service.Start()

// Stop the service
err := service.Stop()
```

### Node Advertisement

```go
// Advertise a node
err := service.AdvertiseNode(node *types.Node)
```

### Peer Discovery

```go
// Set up discovery callback
service.Watch(func(peer *types.Peer) {
    // Handle discovered peer
})
```

## Node Structure

When advertising a node, the following information is encoded in mDNS TXT records:

- `node_id` - Node identifier
- `node_type` - Node service type (bootstrap, registry, turn, etc.)
- `node_name` - Node display name
- `node_port` - Service port number
- `network_id` - Network identifier
- `addresses` - List of network addresses

## Service Types

Common service types used in peers-touch:

- `_bootstrap._tcp` - Bootstrap node discovery
- `_registry._tcp` - Registry service discovery
- `_turn._tcp` - TURN server discovery
- `_peers-touch._tcp` - General peer discovery

## Implementation Notes

This is a simplified implementation that provides the basic framework for mDNS functionality. The actual mDNS protocol implementation would integrate with the `github.com/hashicorp/mdns` library for:

1. **Service Registration**: Registering services for advertisement
2. **Service Discovery**: Querying for services on the network
3. **TXT Record Parsing**: Extracting node information from TXT records

The current implementation provides:
- Service lifecycle management (Start/Stop)
- Node advertisement preparation
- Discovery callback framework
- Configuration management

## Testing

Run the tests:

```bash
go test ./core/internal/mdns/... -v
```

## Examples

See `example.go` for complete usage examples including:
- Basic service setup
- Bootstrap service
- Registry service
- Custom service types
