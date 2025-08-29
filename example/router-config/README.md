# Router Configuration Example

This example demonstrates how to enable or disable specific routers in the peers-touch-go application using configuration files.

## Overview

The router configuration system allows you to control which routers are enabled or disabled at runtime. This is useful for:

- Creating lightweight nodes that only need specific functionality
- Disabling unused features to reduce resource consumption
- Customizing deployments for different use cases

## Available Routers

The following routers can be configured:

- **Management** (`management`): Administrative endpoints and management interface
- **ActivityPub** (`activitypub`): ActivityPub protocol endpoints for federation
- **WellKnown** (`wellknown`): .well-known endpoints for discovery
- **User** (`user`): User management and authentication endpoints
- **Peer** (`peer`): Peer-to-peer networking endpoints

## Configuration

### Configuration File

Add the `routers` section to your `peers.yml` configuration file:

```yaml
peers:
  # ... other configuration ...
  
  # Router configuration - control which routers are enabled
  routers:
    management: true    # Enable management router (default: true)
    activitypub: false  # Disable ActivityPub router (default: true)
    wellknown: true     # Enable .well-known router (default: true)
    user: true          # Enable user router (default: true)
    peer: false         # Disable peer router (default: true)
```

### Default Behavior

If no router configuration is provided, all routers are enabled by default.

### Environment Variables

You can also control routers through environment variables (if implemented):

```bash
export PEERS_ROUTERS_MANAGEMENT=true
export PEERS_ROUTERS_ACTIVITYPUB=false
export PEERS_ROUTERS_WELLKNOWN=true
export PEERS_ROUTERS_USER=true
export PEERS_ROUTERS_PEER=false
```

## Running the Example

1. Navigate to this directory:
   ```bash
   cd example/router-config
   ```

2. Run the example:
   ```bash
   go run main.go
   ```

3. The application will start and print which routers are enabled based on the configuration in `conf/peers.yml`.

## Use Cases

### Lightweight API Server

For a lightweight API server that only needs user management:

```yaml
peers:
  routers:
    management: true
    activitypub: false
    wellknown: false
    user: true
    peer: false
```

### ActivityPub Federation Node

For a node focused on ActivityPub federation:

```yaml
peers:
  routers:
    management: false
    activitypub: true
    wellknown: true
    user: true
    peer: false
```

### P2P Network Node

For a pure peer-to-peer networking node:

```yaml
peers:
  routers:
    management: false
    activitypub: false
    wellknown: false
    user: false
    peer: true
```

## Implementation Details

The router configuration system works by:

1. Reading configuration from `peers.yml` during application startup
2. Using the `config.GetRouterConfig()` function to retrieve router settings
3. Conditionally registering routers in the `touch.Handlers()` function based on configuration
4. Providing sensible defaults (all routers enabled) when no configuration is specified

This approach ensures backward compatibility while providing flexibility for customized deployments.