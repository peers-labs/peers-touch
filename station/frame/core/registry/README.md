# Registry V2 - New Minimalist Design

## 🎯 Core Features

Registry V2 is a completely redesigned registry system with minimalist philosophy and modern API design.

### ✨ Key Improvements

1. **Unified Interface**: One `Query` method replaces the original `GetPeer` + `ListPeers`
2. **Fire-and-forget Watch**: No need to manage Watcher lifecycle
3. **Multi-namespace Support**: Hierarchical namespace design support
4. **Option Pattern**: Flexible configuration with backward compatibility
5. **Clean API**: Direct calls to `registry.Register()` and other shortcut methods

## 📋 API Design

### Core Interface
```go
type Registry interface {
    // Basic lifecycle
    Init(ctx context.Context, opts ...option.Option) error
    Options() Options
    String() string
    
    // Registration operations
    Register(ctx context.Context, registration *Registration, opts ...RegisterOption) error
    Deregister(ctx context.Context, id string, opts ...DeregisterOption) error
    
    // Query operations - unified interface
    Query(ctx context.Context, opts ...QueryOption) ([]*Registration, error)
    
    // Watch operations - fire-and-forget
    Watch(ctx context.Context, callback WatchCallback, opts ...WatchOption) error
}
```

### Data Structures
```go
type Registration struct {
    ID          string                 // Unique identifier
    Name        string                 // Display name
    Type        string                 // Type: bootstrap, registry, turn, peer
    Namespaces  []string               // Multi-namespace registration support
    Addresses   []string               // Network addresses
    Metadata    map[string]interface{} // Extended metadata
    TTL         time.Duration          // Time to live
    CreatedAt   interface{}            // Creation time
    UpdatedAt   interface{}            // Update time
}

type WatchEvent struct {
    Type         WatchEventType // Event type: ADD, UPDATE, DELETE
    Registration *Registration  // Registration information
    Timestamp    interface{}    // Timestamp
    Namespace    string         // Namespace that triggered the event
}
```

## 🌍 Standard Namespaces

```go
const (
    // Basic namespaces
    NamespaceGlobal   = "global"
    NamespaceLocal    = "local"
    NamespaceInternal = "internal"
    
    // Versioned namespaces
    NamespaceV1Prefix  = "pt1"
    NamespaceV1Global  = "pt1/global"
    NamespaceV1Local   = "pt1/local"
    NamespaceV1Prod    = "pt1/prod"
    NamespaceV1Staging = "pt1/staging"
    NamespaceV1Test    = "pt1/test"
    
    // Component namespaces
    NamespaceV1Bootstrap = "pt1/bootstrap"
    NamespaceV1Registry  = "pt1/registry"
    NamespaceV1Turn      = "pt1/turn"
    
    // Backward compatibility
    DefaultPeersNetworkNamespace = "pst"
)
```

## 🚀 Usage Examples

### 1. Set Default Registry and Register Component
```go
// Set default registry
registry.SetDefaultRegistry(myRegistry)

// Register to multiple namespaces
err := registry.Register(ctx, &registry.Registration{
    ID:         host.ID().String(),
    Name:       "bootstrap-service",
    Type:       "bootstrap",
    Namespaces: []string{"pt1/prod/bootstrap", "pt1/staging/bootstrap", "global"},
    Addresses:  []string{"/ip4/192.168.1.100/tcp/4001"},
    Metadata:   map[string]interface{}{"version": "1.0.0"},
}, registry.WithTTL(30*time.Minute))
```

### 2. Query Components
```go
// Query by ID (replaces the original Get)
results, err := registry.Query(ctx, registry.WithID("node-123"))

// Query specific namespace
results, err := registry.Query(ctx,
    registry.WithNamespaces("pt1/prod/bootstrap"),
    registry.WithTypes("bootstrap"),
    registry.WithActiveOnly(true),
)

// Recursively query multiple namespaces
results, err := registry.Query(ctx,
    registry.WithNamespaces("pt1/prod", "pt1/staging"),
    registry.WithRecursive(true),
    registry.WithTypes("bootstrap", "registry"),
)
```

### 3. Watch Component Changes
```go
err := registry.Watch(ctx, func(event registry.WatchEvent) {
    switch event.Type {
    case registry.WatchEventAdd:
        fmt.Printf("Component added: %s\n", event.Registration.Name)
    case registry.WatchEventUpdate:
        fmt.Printf("Component updated: %s\n", event.Registration.Name)
    case registry.WatchEventDelete:
        fmt.Printf("Component deleted: %s\n", event.Registration.Name)
    }
},
    registry.WithWatchNamespaces("pt1/prod/bootstrap"),
    registry.WithWatchTypes("bootstrap"),
    registry.WithWatchActiveOnly(true),
)
```

### 4. Deregister Component
```go
err := registry.Deregister(ctx, "node-123")
```

## 🎯 Option Functions

### Registration Options
- `WithNamespaces(namespaces ...string)` - Set multiple namespaces
- `WithType(typeStr string)` - Set type
- `WithName(name string)` - Set name
- `WithMetadata(metadata map[string]interface{})` - Set metadata
- `WithTTL(ttl time.Duration)` - Set TTL
- `WithInterval(interval time.Duration)` - Set interval
- `WithNamespace(namespace string)` - Set single namespace (backward compatible)

### Query Options
- `WithID(id string)` - Query by ID
- `WithNamespaces(namespaces ...string)` - Query multiple namespaces
- `WithTypes(types ...string)` - Type filtering
- `WithRecursive(recursive bool)` - Recursive query
- `WithActiveOnly(active bool)` - Query only active components
- `WithMaxResults(max int)` - Maximum results
- `WithNameIsPeerID()` - Name is PeerID (backward compatible)
- `WithQueryName(name string)` - Query by name (backward compatible)
- `GetMe()` - Query self (backward compatible)

### Watch Options
- `WithWatchNamespaces(namespaces ...string)` - Watch namespaces
- `WithWatchTypes(types ...string)` - Watch types
- `WithWatchActiveOnly(active bool)` - Watch only active components
- `WithWatchRecursive(recursive bool)` - Recursive watch

## 🚀 Shortcut Methods

Registry V2 provides clean shortcut methods without complex global manager:

```go
// Set default registry
registry.SetDefaultRegistry(myRegistry)

// Register component
err := registry.Register(ctx, &registry.Registration{
    ID:         host.ID().String(),
    Name:       "bootstrap-service",
    Type:       "bootstrap",
    Namespaces: []string{"pt1/prod/bootstrap", "global"},
    Addresses:  []string{"/ip4/192.168.1.100/tcp/4001"},
}, registry.WithTTL(30*time.Minute))

// Query components
results, err := registry.Query(ctx, registry.WithID("node-123"))

// Watch changes
err := registry.Watch(ctx, func(event registry.WatchEvent) {
    fmt.Printf("Event: %s, Component: %s\n", event.Type, event.Registration.Name)
})

// Deregister component
err := registry.Deregister(ctx, "node-123")
```

## 🔧 Implementation Guide

Registry V2 only defines interface specifications, specific implementations are completed by different backend adapters:

### Possible Implementations
- **local**: Local memory implementation
- **mdns**: mDNS service discovery
- **consul**: Consul integration
- **etcd**: etcd integration
- **mixed**: Mixed implementation (local + mDNS + DHT)

### Implementation Example
```go
type MyRegistry struct {
    // Implementation fields
}

func (r *MyRegistry) Init(ctx context.Context, opts ...option.Option) error {
    // Initialization logic
}

func (r *MyRegistry) Register(ctx context.Context, registration *Registration, opts ...RegisterOption) error {
    // Registration logic
}

func (r *MyRegistry) Query(ctx context.Context, opts ...QueryOption) ([]*Registration, error) {
    // Query logic
}

func (r *MyRegistry) Watch(ctx context.Context, callback WatchCallback, opts ...WatchOption) error {
    // Watch logic
}

func (r *MyRegistry) Deregister(ctx context.Context, id string, opts ...DeregisterOption) error {
    // Deregistration logic
}

func (r *MyRegistry) Options() Options {
    return r.options
}

func (r *MyRegistry) String() string {
    return "my-registry"
}
```

## 📁 File Structure

```
registry/
├── README.md      # This documentation
├── registry.go    # Core interface and shortcut methods
├── types.go       # V2 core type definitions
├── options.go     # Option function definitions
├── config.go      # Configuration related types (TURN, etc.)
├── errors.go      # Error definitions
└── selector/      # Selector (retained)
```

## 🎉 Summary

Registry V2 is a modern, minimalist registry system with the following advantages:

1. **Unified API**: One Query method handles all query scenarios
2. **Simple to Use**: Fire-and-forget Watch mechanism
3. **Powerful Features**: Multi-namespace and hierarchical support
4. **Excellent Extensibility**: Option pattern for flexible configuration
5. **Easy Management**: Clean shortcut methods
6. **Implementation Decoupling**: Complete separation of interface and implementation

This design maintains backward compatibility while providing powerful new features, laying a solid foundation for the future development of the peers-touch project.